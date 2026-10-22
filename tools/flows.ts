// Records a run's flows between the browser and Focus (shared/flows.ts) into .focus/cartography-flows.json, for
// the cartography plugin to draw: a demo ship on a free port with FOCUS_FLOWS set, the captain coming aboard with
// ?flows and opening what they use, while the demo's crew work. `--seconds 90` runs longer (120 by default).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { FLOWS_FILE, FLOWS_PARAM, type FlowRecording } from '../shared/flows';
import { CheckFailed, freePort, launchBrowser, openScene, root, startDemo, stopDemo, waitForServer } from './demoShip';

const seconds = Number(process.argv[process.argv.indexOf('--seconds') + 1]) || 120;
const SPEED = 3;
const RUN = `the demo ship at speed ${SPEED} for ${seconds} s, the captain opening the engineering station, its Maps, the ledger and comms`;

type Hq = { ui: Record<string, (...args: unknown[]) => void> & { panels: { close(): void } }; state: { projects: { id: string }[] } };

/** What the captain does, through Focus's own panels, so each request is made by the file that makes it for real. */
async function captain(page: Page): Promise<void> {
  const step = async (what: string, act: () => Promise<unknown>) => {
    console.log(`  · ${what}`);
    await act();
    await page.waitForTimeout(2500);
    await page.evaluate(() => (window as unknown as { focusHQ: Hq }).focusHQ.ui.panels.close());
  };
  await step('the engineering station', () => page.evaluate(() => (window as unknown as { focusHQ: Hq }).focusHQ.ui.openEngineering()));
  await step('its Maps, and Map again', async () => {
    await page.evaluate(() => (window as unknown as { focusHQ: Hq }).focusHQ.ui.openEngineering());
    await page.getByText('Maps', { exact: true }).first().click().catch(() => undefined);
    await page.getByRole('button', { name: 'Map again' }).first().click().catch(() => undefined);
  });
  await step('the ledger', () => page.evaluate(() => (window as unknown as { focusHQ: Hq }).focusHQ.ui.openLedger()));
}

async function main(): Promise<void> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/?${FLOWS_PARAM}`;
  console.log(`Recording flows: ${RUN}`);
  const server = startDemo(port, mkdtempSync(path.join(os.tmpdir(), 'focus-flows-')), {
    env: { FOCUS_FLOWS: RUN, FOCUS_DEMO_SPEED: String(SPEED), FOCUS_PLUGINS: 'scorecard,cartography' },
  });
  let browser: Browser | undefined;
  try {
    await waitForServer(`http://127.0.0.1:${port}/`, server, 60_000);
    browser = await launchBrowser();
    const page = await openScene(browser, url);
    const started = Date.now();
    await captain(page);
    const left = seconds * 1000 - (Date.now() - started);
    if (left > 0) await page.waitForTimeout(left);
    const res = await fetch(`http://127.0.0.1:${port}/api/flows`);
    if (!res.ok) throw new CheckFailed(`Focus hands over its recording (${res.status})`);
    const { unattributed, ...recording } = (await res.json()) as FlowRecording & { unattributed: { ws: number; http: number } };
    recording.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(path.join(root, FLOWS_FILE), `${JSON.stringify(recording, null, 2)}\n`);
    const total = recording.flows.reduce((n, f) => n + f.count, 0);
    console.log(`${recording.flows.length} flows (${total} messages) in ${FLOWS_FILE}; without a file to put them to: ${unattributed.ws} over /ws, ${unattributed.http} to /api`);
  } finally {
    await browser?.close();
    await stopDemo(server);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof CheckFailed ? `✗ ${err.message}` : err);
  process.exit(1);
});
