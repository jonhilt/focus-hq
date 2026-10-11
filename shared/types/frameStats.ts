// How the 3D view ran in a browser opened with ?stats=1: it sends the office a line a second, and the office keeps them
// in its data folder (frame-stats/<session>.jsonl), so a run on someone else's machine can be read where the office is.

/** The first line: the machine, and how the page was opened. */
export interface FrameStatsSession {
  kind: 'session';
  /** When the page opened (ISO). */
  at: string;
  /** The GPU, as WebGL names it. */
  gpu: string;
  userAgent: string;
  devicePixelRatio: number;
  /** The screen's and the window's size, in CSS pixels. */
  screen: [number, number];
  window: [number, number];
  /** The page's query string (?stats=1&adapt=0…). */
  search: string;
  /** Whether shaders compile off the main thread (KHR_parallel_shader_compile). */
  parallelCompile: boolean;
  /** Whether each pass's GPU time is measured (EXT_disjoint_timer_query_webgl2): `gpu` in the samples. */
  gpuTimer: boolean;
}

/** Frame times (ms): the typical one, the slowest but one in twenty, and the slowest. */
export interface Spread {
  median: number;
  p95: number;
  max: number;
}

/** A second or so of frames. */
export interface FrameStatsSample {
  kind: 'sample';
  /** Seconds since the page opened. */
  t: number;
  /** Where the camera was at the end of it (World.locationOf). */
  where: string;
  frames: number;
  /** How long between frames (ms). */
  ms: Spread;
  /** How long each frame kept the main thread busy (ms): its JavaScript and draw calls, not waiting on the GPU. */
  busy: Spread;
  /** The pixel ratio, and the size drawn at (resolution.ts). */
  ratio: number;
  size: [number, number];
  /** Draw calls and triangles in the last frame, every pass of it. */
  draws: number;
  triangles: number;
  /** How many of the frames drew an open doorway's far side as well (portal.ts). */
  door: number;
  /** Shader programs and textures on the GPU at the end of it. */
  programs: number;
  textures: number;
  /** Pictures sent to the GPU over the second (canvases and images), and how many MB. */
  uploads: number;
  uploadMB: number;
  /** GPU time per frame (ms) by pass, as `<frame>.<pass>`: the screen's, an open doorway's far side, a transporter feed. */
  gpu?: Record<string, number>;
}

/** A frame far slower than it should be, and what came with it. */
export interface FrameStatsHitch {
  kind: 'hitch';
  t: number;
  where: string;
  /** How long the frame took, and how much of that the main thread was busy (ms). */
  ms: number;
  busy: number;
  /** Shader programs and textures new in it, and pictures sent to the GPU. */
  programs: number;
  textures: number;
  uploads: number;
  /** Whether it drew an open doorway's far side as well. */
  door: boolean;
}

export type FrameStatsLine = FrameStatsSession | FrameStatsSample | FrameStatsHitch;
