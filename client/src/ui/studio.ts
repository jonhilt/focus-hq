import * as THREE from 'three';
import { cueMet, type Cue, helperTag, modelLabel, type Shot } from '../../../shared/studio';
import type { Agent } from '../../../shared/types';
import { state } from '../net/state';
import type { Player } from '../player';
import type { World } from '../world/office';
import type { StationSeat, TeamStation } from '../world/teamStation';
import { h } from './dom';
import type { Hud } from './hud';

/** Seated, a crew member's head is about this high off the floor. */
const SEATED_HEAD = 1.15;
/** How high over the floor a tag floats over someone seated. */
const TAG_HEIGHT = 1.75;

/**
 * The TV studio's director (?studio=1, docs/studio.md): the recorder (scripts/studio.ts) calls it beat by beat through
 * `focusHQ.studio` to move the camera, put a caption up and tell when a cue has come. Without the flag none of it exists.
 * While it films, the HUD's hidden and everyone at the goal's team station wears a tag saying what they are.
 */
export class Studio {
  private readonly caption = h('div', { class: 'studio-caption' });
  private readonly tags = h('div', { class: 'studio-tags' });
  private readonly tagFor = new Map<string, HTMLElement>();
  private glide: { from: THREE.Vector3; fromLook: THREE.Vector3; to: THREE.Vector3; toLook: THREE.Vector3; start: number; seconds: number } | null = null;
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly hud: Hud,
  ) {
    document.body.classList.add('studio');
    document.body.append(this.tags, this.caption);
  }

  /** The goal's lead the studio films: the only one in its office. */
  lead(): Agent | undefined {
    return [...state.agents.values()].find((a) => a.task === 'lead');
  }

  /** Whether a beat's cue has come. */
  cue(cue: Cue): boolean {
    return cueMet(cue, this.lead());
  }

  /** Puts a caption up, or takes it down without one. */
  say(title?: string, text?: string): void {
    this.caption.replaceChildren(...(title ? [h('div', { class: 'studio-title' }, title), h('div', { class: 'studio-text' }, text ?? '')] : []));
    this.caption.classList.toggle('up', !!title);
  }

  /** Moves the camera to a shot: a cut through a blackout, or a glide over `glide` seconds. Resolves once it's there. */
  shot(name: Shot, glide?: number): Promise<void> {
    const to = this.frame(name);
    if (!to) return Promise.reject(new Error(`There's no ${name} shot yet`));
    const camera = this.player.camera;
    if (glide) {
      camera.getWorldDirection(this.look);
      this.glide = { from: camera.position.clone(), fromLook: camera.position.clone().add(this.look.multiplyScalar(4)), to: to.position, toLook: to.lookAt, start: performance.now(), seconds: glide };
      return new Promise((resolve) => setTimeout(resolve, glide * 1000));
    }
    this.glide = null;
    return new Promise((resolve) =>
      this.hud.blackout(() => {
        camera.position.copy(to.position);
        camera.lookAt(to.lookAt);
        resolve();
      }),
    );
  }

  /** Where a shot puts the camera (eye) and what it looks at, in the world. */
  private frame(name: Shot): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    const places = this.world.places();
    if (name === 'bridge') {
      const place = places.find((p) => /bridge/i.test(p.label)) ?? places[0];
      return place ? { position: place.position.clone().setY(1.6), lookAt: place.lookAt.clone() } : null;
    }
    const lead = this.lead();
    if (name === 'holodeck') {
      const place = places.find((p) => p.projectId && p.projectId === lead?.projectId);
      return place ? { position: place.position.clone().setY(1.6), lookAt: place.lookAt.clone() } : null;
    }
    const station = lead && this.world.room(lead.projectId)?.stationOf(lead.id);
    if (!station) return null;
    const view = station.viewpoint();
    const captain = view.position.clone().setY(1.6);
    const seat = (s: StationSeat) => s.seat.getWorldPosition(new THREE.Vector3()).setY(SEATED_HEAD);
    // the way someone in a seat faces (a seat turned for its Character, which faces +X): toward the screen
    const facing = (s: StationSeat) => new THREE.Vector3().setFromMatrixColumn(s.seat.matrixWorld, 0).setY(0).normalize();
    const mean = (vs: THREE.Vector3[]) => vs.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(vs.length);
    // the helpers' seats that are taken, or the first two while nobody's in them
    const taken = station.helpers.filter((s) => s.id);
    const helpers = taken.length ? taken : station.helpers.slice(0, 2);
    switch (name) {
      case 'station':
        return { position: captain, lookAt: view.lookAt };
      case 'lead': {
        // in front of the lead, a little to the side of it: three-quarters on, from the screen's side
        const ahead = facing(station.lead);
        const side = new THREE.Vector3(-ahead.z, 0, ahead.x);
        return { position: seat(station.lead).addScaledVector(ahead, 1.6).addScaledVector(side, -0.6).setY(1.45), lookAt: seat(station.lead).setY(1.05) };
      }
      case 'helpers': {
        // over the lead's and reviewer's heads from the screen's side, looking down on the helpers at their consoles
        const at = mean(helpers.map(seat));
        return { position: at.clone().addScaledVector(mean(helpers.map(facing)).normalize(), 3.3).setY(2.5), lookAt: at.setY(0.9) };
      }
      case 'crew': {
        // high in a corner by the screen, everyone in it
        const all = mean([station.lead, ...helpers, station.reviewer].map(seat));
        return { position: view.lookAt.clone().lerp(captain, 0.25).setY(2.3), lookAt: all };
      }
    }
  }

  /** Each frame, before it's drawn: the camera's glide, and the tags over the crew's heads. */
  update(now: number): void {
    const camera = this.player.camera;
    if (this.glide) {
      const g = this.glide;
      const k = Math.min(1, (now - g.start) / (g.seconds * 1000));
      const e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(g.from, g.to, e);
      camera.lookAt(this.look.lerpVectors(g.fromLook, g.toLook, e));
      if (k >= 1) this.glide = null;
    }
    this.placeTags(camera);
  }

  private placeTags(camera: THREE.PerspectiveCamera): void {
    const lead = this.lead();
    const station = lead && this.world.room(lead.projectId)?.stationOf(lead.id);
    const shown = new Set<string>();
    if (lead && station?.inside(camera.position)) {
      for (const [seat, text] of this.cast(lead, station)) {
        if (!seat.id || !seat.character) continue;
        const at = seat.character.group.getWorldPosition(this.tmp).setY(TAG_HEIGHT).project(camera);
        if (at.z > 1 || Math.abs(at.x) > 1.1 || Math.abs(at.y) > 1.1) continue;
        shown.add(seat.id);
        let tag = this.tagFor.get(seat.id);
        if (!tag) this.tags.append((tag = h('div', { class: 'studio-tag' })));
        this.tagFor.set(seat.id, tag);
        tag.textContent = text;
        // kept clear of the screen's edges, however near one its wearer sits
        const x = Math.min(innerWidth - tag.offsetWidth / 2 - 16, Math.max(tag.offsetWidth / 2 + 16, ((at.x + 1) / 2) * innerWidth));
        tag.style.transform = `translate(${x}px, ${((1 - at.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, tag] of this.tagFor) {
      if (shown.has(id)) continue;
      tag.remove();
      this.tagFor.delete(id);
    }
  }

  /** Who's at the station, and what their tag says. */
  private cast(lead: Agent, station: TeamStation): [StationSeat, string][] {
    const helpers = lead.helpers ?? [];
    return [
      [station.lead, ['Lead', modelLabel(lead.model), lead.effort && `${lead.effort} effort`].filter(Boolean).join(' · ')],
      ...station.helpers.map((s): [StationSeat, string] => {
        const helper = helpers.find((x) => x.id === s.id);
        return [s, helper ? helperTag(helper) : 'subagent'];
      }),
      [station.reviewer, 'QA reviewer'],
    ];
  }
}
