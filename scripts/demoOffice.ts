// Shared by the Playwright scripts (smoke, zfight): a demo office on a free port and a headless browser to drive it.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright';

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

export function startDemo(port: number, dataDir: string): ChildProcess {
  // Own process group so stopping it also stops whatever tsx and Vite spawn underneath.
  const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts', '--dev', '--demo'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FOCUS_DATA_DIR: dataDir },
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
export async function launchBrowser(): Promise<Browser> {
  const attempts: LaunchOptions[] = [];
  if (process.env.FOCUS_BROWSER_PATH) attempts.push({ executablePath: process.env.FOCUS_BROWSER_PATH });
  attempts.push({}, { channel: 'chrome' }, { channel: 'msedge' });
  let lastError: unknown;
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch (err) {
      lastError = err;
    }
  }
  throw new CheckFailed(`a browser launches (${String(lastError).slice(0, 200)}). Run "npx playwright install chromium" or set FOCUS_BROWSER_PATH`);
}
