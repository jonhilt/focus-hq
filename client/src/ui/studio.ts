import * as THREE from 'three';
import { cueMet, type Cue, helperTag, modelLabel, type Shot } from '../../../shared/studio';
import type { Agent } from '../../../shared/types';
import { state } from '../net/state';
import type { Player } from '../player';
import type { World } from '../world/office';
import type { StationSeat, TeamStation } from '../world/teamStation';
import { h } from './dom';
import { frameShot } from './shots';
import { compilePlan, readPlan } from '../../../shared/stagePlan';
import { HoloStage } from './stage/player';
import type { Hud } from './hud';

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

  /** The holodeck stage (`?stage=`), built once its plan has loaded and there's a vacant holodeck to stage it in. */
  private stage: HoloStage | null = null;
  private plan: ReturnType<typeof compilePlan> | null = null;

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly hud: Hud,
    private readonly stageName: string | null = null,
  ) {
    document.body.classList.add('studio');
    document.body.append(this.tags, this.caption);
    if (stageName) void this.loadPlan(stageName);
  }

  /** Fetches the stage's shot plan (scenes/<name>.plan.yaml, served by a --studio office) and compiles it. */
  private async loadPlan(name: string): Promise<void> {
    try {
      const res = await fetch(`/studio/plans/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(await res.text());
      const { parse } = await import('yaml');
      this.plan = compilePlan(readPlan(parse(await res.text())));
    } catch (err) {
      this.say('The plan', `couldn't be played: ${err instanceof Error ? err.message : String(err)}`);
      console.error(err);
    }
  }

  /** What the plan asked of the stage that it can't do yet. */
  stageReport(): string[] {
    return [...(this.stage?.unsupported ?? [])];
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
    const to = frameShot(this.world, name, this.lead());
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

  /** Plays the holodeck stage from the top (or `from` seconds in): how long it runs (seconds), or 0 when there's none yet. */
  playStage(from = 0): number {
    return this.stage?.play(from) ?? 0;
  }

  /** Each frame, before it's drawn: the stage, or the camera's glide and the tags over the crew's heads. */
  update(now: number): void {
    const camera = this.player.camera;
    if (this.stageName) {
      const hall = this.world.vacantHalls()[0];
      if (!this.stage && hall && this.plan) this.stage = new HoloStage(hall, camera, this.plan);
      this.stage?.update(now);
      return;
    }
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
