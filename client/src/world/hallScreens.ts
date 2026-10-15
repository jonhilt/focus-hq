// The plugins' screens in a project's holodeck (plugins.ts `hall`): holograms round the wall either side of the
// entrance, one per screen, each drawn on a canvas of its own as the board is (at most every DISPLAY_EVERY, a draw slot
// at a time), and opened up close with E.
import * as THREE from 'three';
import type { HallScreen } from '../plugins';
import { interactive } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { HALL_SCREEN, hallScreenSpots } from './hallLayout';
import { FloorGlow, Hologram, hover } from './hologram';
import { DISPLAY_EVERY, redrawDue, type ScreenView, screenTest, takeDraw } from './screenRedraw';

/** The canvas a plugin's screen is drawn on. */
export const HALL_SCREEN_PX = { w: 1280, h: 800 } as const;

interface Hung {
  plugin: string;
  screen: HallScreen;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  hologram: Hologram;
  mesh: THREE.Mesh;
  glow: FloorGlow;
  y: number;
  /** The version last drawn, and when; undefined until it's first drawn. */
  drawn?: string;
  at: number;
  drawing: boolean;
}

export class HallScreens {
  /** Added to the room's group after its furniture's merged, since what's on it changes. */
  readonly group = new THREE.Group();
  private hung: Hung[] = [];

  constructor(private projectId: string) {}

  /** The screens the plugins hang here now: hung again when which they are changes, drawn again when one's version does. */
  sync(screens: { plugin: string; screen: HallScreen }[]): void {
    const spots = hallScreenSpots(screens.length);
    const fits = screens.slice(0, spots.length);
    const same = fits.length === this.hung.length && fits.every((s, i) => s.plugin === this.hung[i].plugin && s.screen.key === this.hung[i].screen.key);
    if (same) {
      fits.forEach((s, i) => (this.hung[i].screen = s.screen));
      return;
    }
    this.clear();
    this.hung = fits.map((s, i) => this.hang(s.plugin, s.screen, spots[i]));
  }

  /** The screen of `plugin` with `key`, for E on it. */
  find(plugin: string, key: string): HallScreen | undefined {
    return this.hung.find((h) => h.plugin === plugin && h.screen.key === key)?.screen;
  }

  private hang(plugin: string, screen: HallScreen, spot: { at: THREE.Vector3; yaw: number }): Hung {
    const { canvas, ctx } = makeCanvas(HALL_SCREEN_PX.w, HALL_SCREEN_PX.h);
    const texture = canvasTexture(canvas);
    const hologram = new Hologram(texture, HALL_SCREEN_PX.w / HALL_SCREEN_PX.h);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(HALL_SCREEN.width, HALL_SCREEN.width / HALL_SCREEN.aspect), hologram.material);
    mesh.position.copy(spot.at);
    mesh.rotation.y = spot.yaw;
    // drawn over the outlines (frame.ts), like the board
    mesh.layers.set(OVERLAY_LAYER);
    mesh.userData.aim = (on: boolean) => (hologram.aimed = on);
    const hung: Hung = { plugin, screen, canvas, ctx, texture, hologram, mesh, glow: FloorGlow.flat(HALL_SCREEN.width, 1.4, hologram.tint), y: spot.at.y, at: -Infinity, drawing: false };
    interactive(mesh, { kind: 'hall-screen', projectId: this.projectId, plugin, key: screen.key }, () => `Look at ${hung.screen.title}`);
    // its glow on the floor below, out from the wall towards the middle
    hung.glow.mesh.position.set(spot.at.x * 0.95, 0, spot.at.z * 0.95);
    hung.glow.mesh.rotation.y = spot.yaw;
    this.group.add(mesh, hung.glow.mesh);
    return hung;
  }

  update(t: number, dt: number, now: number, view: ScreenView): void {
    this.hung.forEach((h, i) => {
      hover(h.mesh, h.y, t, i + 1);
      h.glow.update(t, i + 1);
      h.hologram.update(dt);
      const changed = h.drawn !== h.screen.version;
      if (!changed || h.drawing || (screenTest.still && h.drawn !== undefined)) return;
      if (!redrawDue({ changed, blinking: false, at: h.at, cursor: false }, view, now, DISPLAY_EVERY) || !takeDraw()) return;
      void this.draw(h, now);
    });
  }

  private async draw(h: Hung, now: number): Promise<void> {
    const version = h.screen.version;
    h.drawing = true;
    h.at = now;
    try {
      h.ctx.clearRect(0, 0, h.canvas.width, h.canvas.height);
      await h.screen.draw(h.ctx, h.canvas.width, h.canvas.height);
      h.texture.needsUpdate = true;
    } catch (err) {
      console.error(`${h.plugin}'s hall screen ${h.screen.key}:`, err);
    } finally {
      // a failed draw isn't tried again until the screen changes
      h.drawn = version;
      h.drawing = false;
    }
  }

  private clear(): void {
    for (const h of this.hung) {
      this.group.remove(h.mesh, h.glow.mesh);
      h.mesh.geometry.dispose();
      h.hologram.dispose();
      h.texture.dispose();
      h.glow.dispose();
    }
    this.hung = [];
  }

  dispose(): void {
    this.clear();
  }
}
