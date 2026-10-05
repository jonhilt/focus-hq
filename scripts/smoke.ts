// Smoke test for the opening splash screen: starts the office in demo mode on a free port,
// drives it in headless Chromium and exits non-zero naming the first check that failed.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type LaunchOptions, type Page } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const shotsDir = path.join(root, 'smoke-shots');
const DEMO_TEXT = 'Demo mode – simulated GitHub and agents.';

class CheckFailed extends Error {}

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) throw new CheckFailed(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`  ✓ ${name}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function startDemo(port: number, dataDir: string): ChildProcess {
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

async function stopDemo(child: ChildProcess): Promise<void> {
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

async function waitForServer(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
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
async function launchBrowser(): Promise<Browser> {
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

async function runChecks(page: Page, url: string, errors: string[]): Promise<void> {
  const noErrors = (when: string) => check(`no page or console errors ${when}`, errors.length === 0, errors.join(' | '));

  await page.goto(url);
  const splash = page.locator('.splash');
  check('splash is visible', await splash.isVisible().catch(() => false));
  check('splash shows the FOCUS HQ heading', (await splash.locator('h1').textContent().catch(() => null))?.trim() === 'FOCUS HQ');
  const enter = splash.locator('button.big-button', { hasText: 'Come aboard' });
  check('splash shows the Come aboard button', await enter.isVisible().catch(() => false));

  const status = splash.locator('.card > p.muted');
  const reached = await page
    .waitForFunction((t) => document.querySelector('.splash .card > p.muted')?.textContent?.startsWith(t) ?? false, DEMO_TEXT, { timeout: 15_000 })
    .then(() => true, () => false);
  check('status line reaches the demo-mode text (snapshot arrived over /ws)', reached, `last text: "${await status.textContent().catch(() => '')}"`);

  const hasHQ = await page.waitForFunction(() => 'focusHQ' in window, null, { timeout: 15_000 }).then(() => true, () => false);
  check('window.focusHQ is defined', hasHQ);
  noErrors('during load');
  await page.screenshot({ path: path.join(shotsDir, 'splash.png') });

  // Pointer lock may be refused headlessly; a rejected lock surfaces as a console error we tolerate.
  const before = errors.length;
  await enter.click();
  check('splash is removed after Come aboard', (await page.locator('.splash').count()) === 0);
  await page.waitForTimeout(1000);
  errors.splice(before, errors.length - before, ...errors.slice(before).filter((e) => !/pointer ?lock/i.test(e)));
  noErrors('after entering');
  await page.screenshot({ path: path.join(shotsDir, 'aboard.png') });
}

async function main(): Promise<number> {
  mkdirSync(shotsDir, { recursive: true });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-smoke-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Smoke test: demo office on ${url}`);
  const server = startDemo(port, dataDir);
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await runChecks(page, url, errors);
    console.log(`Smoke test passed. Screenshots in ${path.relative(root, shotsDir)}/`);
    return 0;
  } catch (err) {
    console.error(err instanceof CheckFailed ? `Smoke test FAILED: ${err.message}` : err);
    return 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
