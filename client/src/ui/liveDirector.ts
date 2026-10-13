import * as THREE from 'three';
import { captainsMove, type LiveBeat, liveStatus, liveStep, liveTick } from '../../../shared/liveDirector';
import { cueMet, type Scene } from '../../../shared/studio';
import type { Agent } from '../../../shared/types';
import { state } from '../net/state';
import type { Player } from '../player';
import type { World } from '../world/office';
import { h } from './dom';
import type { Hud } from './hud';
import { frameShot } from './shots';

/** Keys that walk: pressing one takes the camera back from the director. */
const WALKING = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * The director over live play (docs/studio.md): once the training console has readied a scene's goal, its beats'
 * captions go up over the ship as the captain plays it, each beat's shot takes the camera (and holds it until the
 * captain walks), a beat the recorder would act out says what the captain does instead, and the beats move on by
 * their cues or by `]` and `[`. `O` hides the lot, captions and camera moves alike, while the beats keep count.
 */
export class LiveDirector {
  private scene: Scene | null = null;
  private projectId: string | undefined;
  private at: LiveBeat = { index: 0 };
  private shown = true;
  /** The beat whose shot is still to be taken: a station's shots wait for its lead to sit down. */
  private pendingShot: number | null = null;
  /** Whether the director has the camera: until the captain walks, a shot holds it where it put it. */
  holding = false;
  private glide: { from: THREE.Vector3; fromLook: THREE.Vector3; to: THREE.Vector3; toLook: THREE.Vector3; start: number; seconds: number } | null = null;
  private readonly look = new THREE.Vector3();
  private readonly caption = h('div', { class: 'studio-caption live-caption' });
  private readonly status = h('div', { class: 'live-status' });

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly hud: Hud,
  ) {
    document.body.append(this.caption, this.status);
  }

  /** Starts directing a scene from its first beat, over `projectId`'s goal. */
  play(scene: Scene, projectId: string | undefined): void {
    this.scene = scene;
    this.projectId = projectId;
    this.shown = true;
    this.enter({ index: 0 });
  }

  /** The director's own keys (`]`, `[`, `O`), and walking, which hands the camera back: whether it took the key. */
  key(code: string): boolean {
    if (WALKING.has(code)) this.release();
    if (!this.scene) return false;
    if (code === 'BracketRight' || code === 'BracketLeft') {
      const next = liveStep(this.scene.beats, this.at, code === 'BracketRight' ? 1 : -1);
      if (next !== this.at) this.enter(next);
      return true;
    }
    if (code === 'KeyO') {
      this.shown = !this.shown;
      if (!this.shown) this.release();
      this.draw();
      return true;
    }
    return false;
  }

  /** Gives the camera back to the captain. */
  release(): void {
    this.holding = false;
    this.glide = null;
  }

  /** The goal's lead, once the captain has started the goal. */
  private lead(): Agent | undefined {
    return [...state.agents.values()].find((a) => a.task === 'lead' && (!this.projectId || a.projectId === this.projectId));
  }

  private enter(at: LiveBeat): void {
    this.at = at;
    this.pendingShot = this.scene?.beats[at.index]?.shot ? at.index : null;
    this.draw();
  }

  private draw(): void {
    const beat = this.scene?.beats[this.at.index];
    const up = !!beat && this.shown;
    // what the captain does, until they've done it (the beat's cue has come)
    const move = beat && this.at.cuedAt === undefined ? (captainsMove(beat) ?? (beat.insert ? 'Cut-away: the scene’s explainer plays here in the film' : undefined)) : undefined;
    this.caption.replaceChildren(
      ...(beat ? [h('div', { class: 'studio-title' }, beat.title), h('div', { class: 'studio-text' }, beat.caption)] : []),
      ...(move ? [h('div', { class: 'live-move' }, move)] : []),
    );
    this.caption.classList.toggle('up', up);
    this.status.textContent = this.scene ? liveStatus(this.scene.beats, this.at) : '';
    this.status.classList.toggle('up', up);
  }

  /** Each frame: the beats' cues, the shot still to take, and the camera's glide while the director holds it. */
  update(now: number): void {
    if (!this.scene) return;
    const beat = this.scene.beats[this.at.index];
    const next = liveTick(this.scene.beats, this.at, !!beat?.until && cueMet(beat.until, this.lead()), now);
    if (next !== this.at) {
      if (next.index === this.at.index) {
        this.at = next;
        this.draw();
      } else this.enter(next);
    }
    if (this.pendingShot === this.at.index && this.shown) this.takeShot(now);
    if (this.holding && this.glide) {
      const g = this.glide;
      const k = Math.min(1, (now - g.start) / (g.seconds * 1000));
      const e = k * k * (3 - 2 * k);
      this.player.camera.position.lerpVectors(g.from, g.to, e);
      this.player.camera.lookAt(this.look.lerpVectors(g.fromLook, g.toLook, e));
      if (k >= 1) this.glide = null;
    }
  }

  private takeShot(now: number): void {
    const beat = this.scene?.beats[this.at.index];
    const to = beat?.shot && frameShot(this.world, beat.shot, this.lead(), this.projectId);
    if (!beat || !to) return;
    this.pendingShot = null;
    const camera = this.player.camera;
    this.holding = true;
    if (beat.glide) {
      const look = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4).add(camera.position);
      this.glide = { from: camera.position.clone(), fromLook: look, to: to.position, toLook: to.lookAt, start: now, seconds: beat.glide };
      return;
    }
    this.glide = null;
    this.hud.blackout(() => {
      camera.position.copy(to.position);
      camera.lookAt(to.lookAt);
    });
  }
}
