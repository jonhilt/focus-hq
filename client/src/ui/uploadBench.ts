import * as THREE from 'three';
import type { FrameStatsBench } from '../../../shared/types';
import { canvasTexture, makeCanvas, MONO_FONT } from '../world/canvas';

// How long this browser takes to send a canvas to the GPU, measured once with ?stats=1 (frameStats.ts): the way the
// screens send theirs, and the ways that might be cheaper. On a laptop's integrated GPU the screens' canvases cost
// about 7 ms a MB, thirty times an Apple M4's; in a test with canvases drawn in software, not flipping them and leaving
// their alpha premultiplied halved it. This says whether it would there.

/** How many times each way is timed: the middle time counts. */
const TIMES = 5;

const WAYS: Record<string, (t: THREE.CanvasTexture) => void> = {
  asNow: () => undefined,
  unflipped: (t) => (t.flipY = false),
  premultiplied: (t) => (t.premultiplyAlpha = true),
  unflippedPremultiplied: (t) => {
    t.flipY = false;
    t.premultiplyAlpha = true;
  },
  noMipmaps: (t) => {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  },
};

export function benchUploads(renderer: THREE.WebGLRenderer): FrameStatsBench {
  const gl = renderer.getContext();
  const { canvas, ctx } = makeCanvas(1200, 800);
  const draw = (n: number) => {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e6edf3';
    ctx.font = `15px ${MONO_FONT}`;
    for (let row = 0; row < 38; row++) ctx.fillText(`${n + row} the quick brown fox jumps over the lazy dog, the lead writes another line`, 10, 20 + row * 20);
  };
  const mb = (canvas.width * canvas.height * 4) / 1e6;
  const msPerMB: Record<string, number> = {};
  for (const [way, set] of Object.entries(WAYS)) {
    const texture = canvasTexture(canvas);
    set(texture);
    draw(0);
    renderer.initTexture(texture);
    gl.finish();
    const times: number[] = [];
    for (let i = 1; i <= TIMES; i++) {
      draw(i);
      texture.needsUpdate = true;
      const start = performance.now();
      renderer.initTexture(texture);
      gl.finish();
      times.push(performance.now() - start);
    }
    texture.dispose();
    msPerMB[way] = Math.round((times.sort((a, b) => a - b)[TIMES >> 1] / mb) * 100) / 100;
  }
  return { kind: 'bench', canvas: [canvas.width, canvas.height], msPerMB };
}
