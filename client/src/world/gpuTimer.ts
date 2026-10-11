// How long each pass of a frame keeps the GPU busy, measured with WebGL's timer queries
// (EXT_disjoint_timer_query_webgl2) while ?stats=1 is on (ui/frameStats.ts), and nothing otherwise. The frames mark
// their passes (gpuPass, gpuBegin and gpuEnd round each draw); the answers come back a frame or two later.

interface Open {
  query: WebGLQuery;
  label: string;
}

export class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  /** Which frame is being drawn: the screen's, an open doorway's far side, a transporter feed. */
  frame = 'screen';
  private open: Open | null = null;
  private pending: Open[] = [];
  /** GPU time (ms) by `<frame>.<pass>` since `take`, and how many frames that was over. */
  private totals = new Map<string, number>();
  private frames = 0;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number },
  ) {
    this.ext = ext;
  }

  /** A timer for `gl`, if its GPU can time passes. */
  static for(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(pass: string): void {
    this.end();
    const query = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.open = { query, label: `${this.frame}.${pass}` };
  }

  end(): void {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  /** After each frame: adds up the passes whose times have come back (none, if the GPU's timing was disturbed). */
  frameDone(): void {
    this.frames++;
    const { gl } = this;
    const disjoint = !!gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    this.pending = this.pending.filter(({ query, label }) => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) this.totals.set(label, (this.totals.get(label) ?? 0) + (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
      gl.deleteQuery(query);
      return false;
    });
  }

  /** GPU time per frame (ms) by pass since it was last taken. */
  take(): Record<string, number> {
    const perFrame = Object.fromEntries([...this.totals].map(([label, ms]) => [label, Math.round((ms / Math.max(1, this.frames)) * 100) / 100]));
    this.totals.clear();
    this.frames = 0;
    return perFrame;
  }
}

let timer: GpuTimer | null = null;

/** Starts timing passes (?stats=1), or stops. */
export function timePasses(t: GpuTimer | null): void {
  timer = t;
}

/** Which frame the passes that follow belong to. */
export function gpuFrame(frame: string): void {
  if (timer) timer.frame = frame;
}

/** Times what's drawn from here to `gpuEnd` as `pass` of the current frame. */
export function gpuBegin(pass: string): void {
  timer?.begin(pass);
}

export function gpuEnd(): void {
  timer?.end();
}
