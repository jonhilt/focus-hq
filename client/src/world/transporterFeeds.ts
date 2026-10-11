import * as THREE from 'three';
import { Frame } from './frame';
import type { TeamStation } from './teamStation';

// The live feeds from a team station's transporter rooms, on the monitors down its briefing room's port wall: each
// room seen from its camera up over the door (TransporterRoom.camera), drawn as the screen draws the ship (frame.ts:
// the outlines and the speech bubbles too) into a small picture of its own. Only while the captain's in that briefing
// room, only the rooms with a workflow in them, and a few times a second, one feed a frame at most.

/** A feed's picture, in pixels: the monitors' 16:9. */
export const FEED_SIZE = new THREE.Vector2(512, 288);
/** How often each feed is drawn, a second. */
const FEED_FPS = 12;

/** What the feeds need of the world: the briefing room the camera's in, and drawing only the part of the ship at a point. */
export interface FeedWorld {
  stationAt(p: THREE.Vector3): TeamStation | undefined;
  stations(): TeamStation[];
  reveal(at: THREE.Vector3 | null): void;
}

export class TransporterFeeds {
  private readonly frame: Frame;
  private readonly camera = new THREE.PerspectiveCamera(50, FEED_SIZE.x / FEED_SIZE.y, 0.05, 60);
  /** Each station's pictures, made the first time the captain stands in its briefing room. */
  private readonly targets = new Map<TeamStation, THREE.WebGLRenderTarget[]>();
  private readonly drawn: number[] = [];
  private next = 0;
  private station: TeamStation | undefined;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.frame = new Frame(renderer, false, FEED_SIZE);
  }

  /**
   * Draws the next feed due, if the camera's in a briefing room: before the frame, which then reveals the camera's own
   * part of the ship again (World.reveal).
   */
  render(scene: THREE.Scene, world: FeedWorld, eye: THREE.Vector3, now: number): void {
    const station = world.stationAt(eye);
    if (station !== this.station) {
      this.station = station;
      if (station) this.watch(station, world);
    }
    if (!station) return;
    const rooms = station.transporterRooms;
    for (let k = 0; k < rooms.length; k++) {
      const i = (this.next + k) % rooms.length;
      if (!station.feedLive(i) || now - (this.drawn[i] ?? 0) < 1000 / FEED_FPS) continue;
      this.drawn[i] = now;
      this.next = (i + 1) % rooms.length;
      const room = rooms[i];
      const cam = this.camera;
      cam.fov = room.camera.fov;
      cam.updateProjectionMatrix();
      cam.position.copy(room.camera.at);
      cam.lookAt(room.camera.lookAt);
      cam.updateMatrixWorld();
      world.reveal(room.camera.at);
      this.frame.render(scene, cam, this.targets.get(station)![i]);
      this.renderer.setRenderTarget(null);
      return;
    }
  }

  /** Gives `station`'s monitors pictures to show, and lets go of any from stations no longer aboard. */
  private watch(station: TeamStation, world: FeedWorld): void {
    const aboard = new Set(world.stations());
    for (const [s, targets] of this.targets) {
      if (aboard.has(s)) continue;
      for (const t of targets) t.dispose();
      this.targets.delete(s);
    }
    let targets = this.targets.get(station);
    if (!targets) {
      // linear colours, in half floats, as a doorway's far side is (PortalView): a material shows them as they are
      targets = station.transporterRooms.map(() => new THREE.WebGLRenderTarget(FEED_SIZE.x, FEED_SIZE.y, { type: THREE.HalfFloatType, depthBuffer: false }));
      this.targets.set(station, targets);
      station.showFeeds(targets.map((t) => t.texture));
    }
    this.drawn.length = 0;
  }
}
