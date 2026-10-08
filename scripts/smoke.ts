// Smoke test for the opening splash screen: starts the office in demo mode on a free port,
// drives it in headless Chromium and exits non-zero naming the first check that failed.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { CheckFailed, freePort, launchBrowser, root, startDemo, stopDemo, waitForServer } from './demoOffice';

const shotsDir = path.join(root, 'smoke-shots');
const DEMO_TEXT = 'Demo mode – simulated GitHub and agents.';

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) throw new CheckFailed(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`  ✓ ${name}`);
}

async function runChecks(page: Page, url: string, errors: string[]): Promise<void> {
  const noErrors = (when: string) => check(`no page or console errors ${when}`, errors.length === 0, errors.join(' | '));

  await page.goto(url);
  const splash = page.locator('.splash');
  // it's added once the fonts and the ship's GLBs have loaded (main.ts), not with the page
  check('splash is visible', await splash.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false));
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
