import * as THREE from 'three';
import type { FrameStatsLine } from '../../../shared/types';
import { HITCH, HITCHES_PER_SAMPLE, SAMPLE_EVERY, SEND_EVERY, sessionId, spread } from '../frameSamples';
import { api } from '../net/api';
import { GpuTimer, timePasses } from '../world/gpuTimer';
import { h } from './dom';
import { benchUploads } from './uploadBench';

/** How long (ms) after the page opens the canvas uploads are timed (uploadBench.ts). */
const BENCH_AFTER = 4000;

/** What a frame did, kept until the next shows how long it took. */
interface Drawn {
  busy: number;
  door: boolean;
  programs: number;
  textures: number;
  uploads: number;
  /** Bytes of geometry sent to the GPU. */
  buffers: number;
  /** The pictures it sent, by size. */
  pictures: string[];
}

/**
 * How the 3D view is running, shown with `?stats=1`: frame rate and time, the pixel ratio it's drawn at
 * (resolution.ts), draw calls and the GPU. So anyone can say how it runs on their
 * machine: the GPU's name is what makes a report from someone else's machine useful. It's logged too: a sample a
 * second, and each hitch with what came with it, sent to the office, which keeps them in its data folder
 * (frame-stats/<session>.jsonl, server/frameStats.ts), so a run on a laptop elsewhere can be read where the office is.
 */
export class FrameStats {
  /** Where the camera is (World.locationOf), for the log. */
  where = '';
  private readonly el = h('div', { class: 'frame-stats' });
  private readonly opened = performance.now();
  private readonly session = sessionId(new Date(), Math.random().toString(36).slice(2, 6));
  private readonly gpu: string;
  private readonly timer: GpuTimer | null;
  private readonly size = new THREE.Vector2();
  /** Frames since the overlay was last updated, and since the last sample. */
  private readonly shown: number[] = [];
  private window: { ms: number; busy: number; door: boolean }[] = [];
  private hitches = 0;
  /** Long tasks logged this sample. */
  private longTasks = 0;
  private draws = 0;
  private gpuMs: number | null = null;
  private last: Drawn | null = null;
  /** The programs, textures and uploads counted after the last frame, to tell what each frame added. */
  private counted = { programs: 0, textures: 0, uploads: 0, buffers: 0 };
  private uploads = 0;
  private uploadBytes = 0;
  private bufferBytes = 0;
  /** The sizes of the pictures sent since the last frame ended. */
  private sent: string[] = [];
  private lastShown = 0;
  private lastSample = 0;
  private lastSend = 0;
  private lines: FrameStatsLine[] = [];
  private log = 'logging…';

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.timer = GpuTimer.for(gl);
    timePasses(this.timer);
    this.watchLongTasks();
    this.countUploads(gl);
    // counted across every render of a frame (the doorway's, the screen's), not reset at each
    renderer.info.autoReset = false;
    document.body.append(this.el);
    this.lines.push({
      kind: 'session',
      at: new Date().toISOString(),
      gpu: this.gpu,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      screen: [screen.width, screen.height],
      window: [window.innerWidth, window.innerHeight],
      search: location.search,
      parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
      gpuTimer: !!this.timer,
    });
    addEventListener('pagehide', () => this.send());
    // once the office is built and warmed up, while the splash screen's still up
    setTimeout(() => this.lines.push(benchUploads(renderer)), BENCH_AFTER);
  }

  /** Before a frame is drawn. */
  begin(): void {
    this.renderer.info.reset();
  }

  /**
   * After it's drawn, with how long since the last one started (ms), how long this one kept the main thread busy (ms)
   * and whether it drew an open doorway's far side.
   */
  end(interval: number, now: number, busy: number, door: boolean): void {
    this.timer?.frameDone();
    const { info } = this.renderer;
    // a frame that slow is the previous one's doing: what it drew, and the GPU catching up with it
    if (interval > HITCH && this.last && this.hitches < HITCHES_PER_SAMPLE && document.visibilityState === 'visible') {
      this.hitches++;
      this.lines.push({ kind: 'hitch', t: this.seconds(now), where: this.where, ms: Math.round(interval), busy: Math.round(this.last.busy), programs: this.last.programs, textures: this.last.textures, uploads: this.last.uploads, bufferKB: Math.round(this.last.buffers / 1e3), pictures: this.last.pictures, door: this.last.door });
    }
    const programs = info.programs?.length ?? 0;
    const textures = info.memory.textures;
    this.last = { busy, door, programs: programs - this.counted.programs, textures: textures - this.counted.textures, uploads: this.uploads - this.counted.uploads, buffers: this.bufferBytes - this.counted.buffers, pictures: this.sent.slice(0, 8) };
    this.sent = [];
    this.counted = { programs, textures, uploads: this.uploads, buffers: this.bufferBytes };
    this.shown.push(interval);
    // a frame that long is the tab hidden, not how fast frames go
    if (interval < 1000) this.window.push({ ms: interval, busy, door });
    this.draws = info.render.calls;
    if (now - this.lastSample >= SAMPLE_EVERY) this.sample(now);
    if (now - this.lastSend >= SEND_EVERY) this.send(now);
    if (now - this.lastShown >= 500 && this.shown.length) this.show(now);
  }

  private seconds(now: number): number {
    return Math.round(now - this.opened) / 1000;
  }

  private sample(now: number): void {
    const { info } = this.renderer;
    const frames = this.window;
    this.window = [];
    this.hitches = 0;
    this.longTasks = 0;
    this.lastSample = now;
    const gpu = this.timer?.take();
    this.gpuMs = gpu ? Object.values(gpu).reduce((a, b) => a + b, 0) : null;
    if (!frames.length) return;
    const size = this.renderer.getDrawingBufferSize(this.size);
    this.lines.push({
      kind: 'sample',
      t: this.seconds(now),
      where: this.where,
      frames: frames.length,
      ms: spread(frames.map((f) => f.ms)),
      busy: spread(frames.map((f) => f.busy)),
      ratio: this.renderer.getPixelRatio(),
      size: [size.x, size.y],
      draws: info.render.calls,
      triangles: info.render.triangles,
      door: frames.filter((f) => f.door).length,
      programs: info.programs?.length ?? 0,
      textures: info.memory.textures,
      uploads: this.uploads,
      uploadMB: Math.round(this.uploadBytes / 1e5) / 10,
      bufferMB: Math.round(this.bufferBytes / 1e5) / 10,
      ...(heapMB() !== undefined && { heapMB: heapMB() }),
      ...(gpu && { gpu }),
    });
    this.uploads = 0;
    this.uploadBytes = 0;
    this.bufferBytes = 0;
    this.counted.uploads = 0;
    this.counted.buffers = 0;
  }

  /** Sends the lines so far to the office: every few seconds, and as the page closes. */
  private send(now = performance.now()): void {
    this.lastSend = now;
    const lines = this.lines;
    if (!lines.length) return;
    this.lines = [];
    api.logFrameStats(this.session, lines).then(
      ({ file }) => (this.log = `log ${file}`),
      (err: Error) => (this.log = `log failed: ${err.message}`),
    );
  }

  private show(now: number): void {
    this.lastShown = now;
    const sorted = [...this.shown].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.shown.length = 0;
    const size = this.renderer.getDrawingBufferSize(this.size);
    const ratio = this.renderer.getPixelRatio();
    this.el.textContent = [
      `${Math.round(1000 / median)} fps · ${median.toFixed(1)} ms${this.gpuMs !== null ? ` · GPU ${this.gpuMs.toFixed(1)} ms` : ''}`,
      `pixel ratio ${ratio} (${size.x}×${size.y})`,
      `${this.draws} draws`,
      this.gpu,
      this.log,
    ].join('\n');
  }

  /**
   * Logs each task that kept the main thread busy over 50 ms (a long task): one of the frames, or work between them
   * that `busy` doesn't see, like handling a burst of the office's messages, or the garbage collector.
   */
  private watchLongTasks(): void {
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    new PerformanceObserver((list) => {
      for (const task of list.getEntries()) {
        if (this.longTasks++ >= HITCHES_PER_SAMPLE) continue;
        this.lines.push({ kind: 'longtask', t: this.seconds(task.startTime), where: this.where, ms: Math.round(task.duration) });
      }
    }).observe({ type: 'longtask' });
  }

  /** Counts the pictures (canvases and images) sent to the GPU, and their size, and the bytes of geometry. */
  private countUploads(gl: WebGL2RenderingContext): void {
    const methods = gl as unknown as Record<'texImage2D' | 'texSubImage2D', (...args: unknown[]) => void>;
    for (const name of ['texImage2D', 'texSubImage2D'] as const) {
      const upload = methods[name].bind(gl);
      methods[name] = (...args: unknown[]) => {
        const picture = args.find((a): a is { width: number; height: number } => !!a && typeof a === 'object' && 'width' in a && !ArrayBuffer.isView(a));
        if (picture) {
          this.sent.push(`${picture.width}x${picture.height}`);
          this.uploads++;
          this.uploadBytes += picture.width * picture.height * 4;
        }
        upload(...args);
      };
    }
    const buffers = gl as unknown as { bufferData: (...args: unknown[]) => void };
    const bufferData = buffers.bufferData.bind(gl);
    buffers.bufferData = (...args: unknown[]) => {
      const data = args[1];
      if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) this.bufferBytes += data.byteLength;
      bufferData(...args);
    };
  }
}

/** How much the page's JavaScript holds (MB), where the browser says (Chrome): a drop is the garbage collector at work. */
function heapMB(): number | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory && Math.round(memory.usedJSHeapSize / 1e5) / 10;
}
