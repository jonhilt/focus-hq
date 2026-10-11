// Shared by the Playwright scripts (smoke, zfight, gaps): a demo office on a free port and a headless browser to drive it.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type LaunchOptions, type Page } from 'playwright';

export const root = path.resolve(import.meta.dirname, '..');

/** A named check or setup step that failed; scripts print its message rather than a stack. */
export class CheckFailed extends Error {}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** `extra` adds arguments and environment, like the studio's `--studio` and its pacing. */
export function startDemo(port: number, dataDir: string, extra: { args?: string[]; env?: Record<string, string> } = {}): ChildProcess {
  // Own process group so stopping it also stops whatever tsx and Vite spawn underneath.
  const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts', '--dev', '--demo', ...(extra.args ?? [])], {
    cwd: root,
    env: { ...process.env, ...extra.env, PORT: String(port), HOST: '127.0.0.1', FOCUS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let log = '';
  const keep = (b: Buffer) => { log = (log + b.toString()).slice(-4000); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.on('exit', (code) => {
    if (code) console.error(`demo server exited with ${code}:\n${log}`);
  });
  return child;
}

export async function stopDemo(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32' || !child.pid) child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch { /* already gone */ }
  };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

export async function waitForServer(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new CheckFailed('demo server starts (process exited)');
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new CheckFailed(`demo server answers at ${url} within ${timeoutMs / 1000}s`);
}

// Same fallback order as BrowserPool in server/agents/browserTool.ts.
/** `args` go to Chromium, like the studio's to draw on the GPU. */
export async function launchBrowser(args: string[] = []): Promise<Browser> {
  const attempts: LaunchOptions[] = [];
  if (process.env.FOCUS_BROWSER_PATH) attempts.push({ executablePath: process.env.FOCUS_BROWSER_PATH });
  attempts.push({}, { channel: 'chrome' }, { channel: 'msedge' });
  let lastError: unknown;
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, args, ...opts });
    } catch (err) {
      lastError = err;
    }
  }
  throw new CheckFailed(`a browser launches (${String(lastError).slice(0, 200)}). Run "npx playwright install chromium" or set FOCUS_BROWSER_PATH`);
}

/**
 * Opens the office at `url` and readies its whole 3D scene for a scan: built, Number One's PADD raised, and the team
 * stations' briefing rooms shown.
 */
export async function openScene(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
  // the world is built once the first snapshot arrives
  const built = await page
    .waitForFunction(() => {
      const hq = (window as { focusHQ?: { world: { rooms: Map<string, unknown>; numberOne: unknown } } }).focusHQ;
      return !!hq && hq.world.rooms.size > 0 && !!hq.world.numberOne;
    }, null, { timeout: 30_000 })
    .then(() => true, () => false);
  if (!built) throw new CheckFailed('the office is built within 30s');
  // Number One reads a PADD in the ready room, and only moves while someone's near: join them and give a few frames to
  // raise it
  await page.evaluate(() => {
    const { ui } = (window as unknown as { focusHQ: { ui: { places(): { label: string }[]; goTo(place: { label: string }): void } } }).focusHQ;
    const room = ui.places().find((p) => p.label.includes('Ready room'));
    if (room) ui.goTo(room);
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const world = (window as unknown as { focusHQ: { world: { root: import('three').Object3D } } }).focusHQ.world;
    // team stations' briefing rooms are only drawn while you're in one or looking in through its door (teamStation.ts)
    (world.root.parent ?? world.root).traverse((o) => {
      if (o.name === 'briefing_room' && o.parent) o.parent.visible = true;
    });
  });
  return page;
}
