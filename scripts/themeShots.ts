// Screenshots of the office's interface (the splash, HUD, panels and the screens round the ship) from a running demo
// office, to compare its look before and after a change: `tsx scripts/themeShots.ts <url> <out dir> [a.css,b.css]`,
// laying the stylesheets (if any) over the page in order, to try a look out before building it.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { launchBrowser } from './demoOffice';

const [url = 'http://127.0.0.1:5173/', out = 'smoke-shots/theme', css = ''] = process.argv.slice(2);

type Hooks = { ui: Record<string, (...a: unknown[]) => unknown> & { places(): { label: string }[]; panels: { close(): void } }; state: { projects: { id: string }[]; agents: Map<string, { id: string; task: string }> } };
declare const window: { focusHQ: Hooks };

async function shot(page: Page, name: string, act: string): Promise<void> {
  await page.evaluate(`(() => { const { ui, state } = window.focusHQ; ui.panels.close(); ${act} })()`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`  ${name}`);
}

// going somewhere drops the pointer lock, which pauses the office, so the pause panel is closed once it's up
const settle = 'setTimeout(() => ui.panels.close(), 600);';
const place = (label: string) => `ui.goTo(ui.places().find((p) => p.label.includes(${JSON.stringify(label)}))); ${settle}`;
const lead = `[...state.agents.values()].find((a) => a.task === 'lead').id`;

mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
  await page.waitForFunction(() => 'focusHQ' in window, null, { timeout: 90_000 });
  for (const file of css.split(',').filter(Boolean)) await page.addStyleTag({ content: readFileSync(file, 'utf8') });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, 'splash.png') });
  await page.locator('.splash button.big-button').click();
  await shot(page, 'bridge', place('Bridge'));
  await shot(page, 'agent-panel', `ui.openAgent(${lead})`);
  await shot(page, 'comms', 'ui.openComms()');
  await shot(page, 'goals', 'ui.openGoals(state.projects[0].id)');
  await shot(page, 'board', 'ui.openBoard(state.projects[0].id)');
  await shot(page, 'chart', `ui.openChart(${lead})`);
  await shot(page, 'teleport', 'ui.openTeleport()');
  await shot(page, 'pause', 'ui.goTo(ui.places()[0])' /* the pointer lock lost pauses the office */);
  await shot(page, 'engineering-panel', 'ui.openEngineering()');
  await shot(page, 'engineering', place('Engineering'));
  await shot(page, 'ready-room', place('Ready room'));
  await shot(page, 'holodeck', `ui.goTo(ui.places().find((p) => p.projectId)); ${settle}`);
  await shot(page, 'team-station', `ui.goToAgent(${lead}); ${settle}`);
  await shot(page, 'transporter', place('Transporter room 1'));
} finally {
  await browser.close();
}
