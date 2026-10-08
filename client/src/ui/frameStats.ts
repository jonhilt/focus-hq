import * as THREE from 'three';
import { h } from './dom';

/**
 * How the 3D view is running, shown with `?stats=1`: frame rate and time, the pixel ratio it's drawn at
 * (resolution.ts), draw calls, the GPU and whether ambient occlusion is on. So anyone can say how it runs on their
 * machine: the GPU's name is what makes a report from someone else's machine useful.
 */
export class FrameStats {
  private readonly el = h('div', { class: 'frame-stats' });
  private readonly frames: number[] = [];
  private draws = 0;
  private last = 0;
  private readonly gpu: string;
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly occlusion: boolean,
  ) {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    // counted across every render of a frame (the doorway's, the screen's), not reset at each
    renderer.info.autoReset = false;
    document.body.append(this.el);
  }

  /** Before a frame is drawn. */
  begin(): void {
    this.renderer.info.reset();
  }

  /** After it's drawn, with how long since the last one (ms). */
  end(interval: number, now: number): void {
    this.frames.push(interval);
    this.draws = this.renderer.info.render.calls;
    if (now - this.last < 500 || !this.frames.length) return;
    this.last = now;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frames.length = 0;
    const size = this.renderer.getDrawingBufferSize(this.size);
    const ratio = this.renderer.getPixelRatio();
    this.el.textContent = [
      `${Math.round(1000 / median)} fps · ${median.toFixed(1)} ms`,
      `pixel ratio ${ratio} (${size.x}×${size.y})`,
      `${this.draws} draws · AO ${this.occlusion ? 'on' : 'off'}`,
      this.gpu,
    ].join('\n');
  }
}
