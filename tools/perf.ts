// How the 3D view runs as the captain walks round a busy office: starts the office in demo mode on a free port, sets
// agents and leads working in its first project, then walks from the bridge through a holodeck's door into its hall
// and on into a briefing room, twice, on the GPU in headless Chromium. For each step it prints the frames' times, how
// long each kept the main thread busy, and what the GPU was handed: shader programs linked, textures sent (and how
// many MB). The first walk shows what walking in for the first time costs, the second what it costs every time.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { CheckFailed, freePort, launchBrowser, startDemo, stopDemo, waitForServer } from './demoOffice';

const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])];

/** Counts what the page hands WebGL, and times each frame, under the step it's on (`__perf.step`). */
const INSTRUMENT = `(() => {
  const perf = (window.__perf = { step: null, frames: [] });
  let frame = { links: 0, uploads: 0, bytes: 0 };
  const P = WebGL2RenderingContext.prototype;
  const linkProgram = P.linkProgram;
  P.linkProgram = function (...a) { frame.links++; return linkProgram.apply(this, a); };
  const pixels = (a) => { const o = a.find((x) => x && typeof x === 'object' && 'width' in x && !ArrayBuffer.isView(x)); return o ? o.width * o.height * 4 : 0; };
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const f = P[name];
    P[name] = function (...a) { const b = pixels(a); if (b) { frame.uploads++; frame.bytes += b; } return f.apply(this, a); };
  }
  const raf = window.requestAnimationFrame.bind(window);
  let busy = 0;
  window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); busy += performance.now() - s; });
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (perf.step) perf.frames.push({ step: perf.step, ms: now - last, busy, ...frame });
    frame = { links: 0, uploads: 0, bytes: 0 };
    busy = 0;
    last = now;
    raf(tick);
  };
  raf(tick);
})();`;

/** Helpers in the page: hold still, or stand in front of a doorway and walk on through it. */
const HELPERS = `(() => {
  const hq = window.focusHQ;
  const V = hq.player.camera.position.constructor;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  window.__walk = {
    async hold(step, ms) {
      window.__perf.step = step;
      for (const end = performance.now() + ms; performance.now() < end; ) await frame();
      window.__perf.step = null;
    },
    async through(step, doorway, back, ms) {
      const at = new V().setFromMatrixPosition(doorway);
      const into = new V().setFromMatrixColumn(doorway, 2).setY(0).normalize();
      hq.player.teleport(at.clone().addScaledVector(into, -back), at.clone().addScaledVector(into, 10).setY(1.6));
      window.__perf.step = step;
      let t = performance.now();
      for (const end = t + ms; performance.now() < end; ) {
        await frame();
        const now = performance.now();
        const ahead = new V();
        hq.player.camera.getWorldDirection(ahead);
        hq.player.camera.position.addScaledVector(ahead.setY(0).normalize(), (3 * Math.min(50, now - t)) / 1000);
        t = now;
      }
      window.__perf.step = null;
    },
  };
})();`;

interface Frame {
  step: string;
  ms: number;
  busy: number;
  links: number;
  uploads: number;
  bytes: number;
}

/** Sets the first project's developers and leads working, as a busy office has them. */
async function busy(url: string): Promise<void> {
  const api = (p: string, body?: unknown) =>
    fetch(`${url}api${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined).then((r) => r.json() as Promise<unknown>);
  const state = (await api('/state')) as { projects: { id: string }[]; agents: { id: string; task: string; projectId: string }[]; boards: { projectId: string; issues: { repo: string; number: number; title: string }[] }[] };
  const project = state.projects[0];
  if (!project) throw new CheckFailed('the demo office has a project');
  const issues = state.boards.find((b) => b.projectId === project.id)?.issues ?? [];
  for (const issue of issues.slice(0, 2)) await api('/agents', { projectId: project.id, repo: issue.repo, number: issue.number, title: issue.title });
  for (const lead of state.agents.filter((a) => a.task === 'lead' && a.projectId === project.id)) await api(`/agents/${lead.id}/message`, { text: 'Carry on with the next slice' });
}

async function walk(page: Page): Promise<void> {
  await page.evaluate(HELPERS);
  await page.evaluate(`window.__walk.hold('bridge', 3000)`);
  for (const pass of ['first', 'again']) {
    await page.evaluate(`(async () => {
      const hq = window.focusHQ, walk = window.__walk;
      const room = hq.world.room(hq.state.projects[0].id);
      await walk.through('corridor → hall (${pass})', room.entrance.ends[0].doorway.matrix, 6, 3500);
      await walk.hold('in the hall (${pass})', 2000);
      const station = room.stations[0];
      await walk.through('hall → briefing room (${pass})', station.portal.ends[0].doorway.matrix, 6, 3500);
      const seat = station.viewpoint();
      hq.player.teleport(seat.position, seat.lookAt);
      await walk.hold('briefing room, lead working (${pass})', 6000);
      hq.ui.goTo(hq.ui.places()[0]);
      await walk.hold('back on the bridge (${pass})', 2000);
    })()`);
  }
}

function report(frames: Frame[]): void {
  const steps = [...new Set(frames.map((f) => f.step))];
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  const cols = ['step', 'frames', 'ms med', 'ms max', 'busy med', 'busy max', 'links', 'uploads', 'MB', 'MB/s'];
  const rows = steps.map((step) => {
    const fs = frames.filter((f) => f.step === step);
    const secs = fs.reduce((s, f) => s + f.ms, 0) / 1000;
    const mb = fs.reduce((s, f) => s + f.bytes, 0) / 1e6;
    return [step, fs.length, median(fs.map((f) => f.ms)).toFixed(1), Math.max(...fs.map((f) => f.ms)).toFixed(0), median(fs.map((f) => f.busy)).toFixed(1), Math.max(...fs.map((f) => f.busy)).toFixed(0), fs.reduce((s, f) => s + f.links, 0), fs.reduce((s, f) => s + f.uploads, 0), mb.toFixed(1), (mb / secs).toFixed(1)].map(String);
  });
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((v, i) => (i ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('  ');
  console.log(line(cols));
  for (const r of rows) console.log(line(r));
}

async function main(): Promise<number> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-perf-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  // slowed down, so everyone set working is still at it by the time the walk reaches them
  const server = startDemo(port, dataDir, { env: { FOCUS_DEMO_SPEED: '0.3' } });
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    await busy(url);
    browser = await launchBrowser(GPU);
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.addInitScript(INSTRUMENT);
    // ?adapt=0 holds the pixel ratio, so every step's drawn at the same size
    await page.goto(`${url}?adapt=0`);
    const built = await page.waitForFunction('window.focusHQ?.world.rooms.size > 0', null, { timeout: 30_000 }).then(() => true, () => false);
    if (!built) throw new CheckFailed('the office is built within 30s');
    console.log(`GPU: ${await page.evaluate<string>(`(() => { const gl = document.querySelector('canvas.world').getContext('webgl2'); const i = gl.getExtension('WEBGL_debug_renderer_info'); return String(i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); })()`)}`);
    await walk(page);
    report(await page.evaluate<Frame[]>('window.__perf.frames'));
    return 0;
  } catch (err) {
    console.error(err instanceof CheckFailed ? `Perf run FAILED: ${err.message}` : err);
    return 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
