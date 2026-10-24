import { readdirSync } from 'node:fs';
import os from 'node:os';
import { afterAll, expect, it } from 'vitest';
import { run } from '../util';
import { BrowserPool } from './browserTool';

// The recorder for real: the agents' shared Chromium records a page while "QA" acts on it, and the machine's ffmpeg
// edits it down. Skipped, saying why, on a machine without a browser for agents or without ffmpeg.

const pool = new BrowserPool();
afterAll(() => pool.shutdown());

/** A page that keeps changing (the screencast sends frames only then) and turns green when its button is pressed. */
const PAGE = `<style>@keyframes spin { to { transform: rotate(360deg) } } i { display: inline-block; width: 40px; height: 40px;
  background: #fa0; animation: spin 1s linear infinite }</style><i></i><button onclick="document.body.style.background='#0a0'">Go</button>`;

const missing = async (): Promise<string | null> => {
  const ffmpeg = await run('ffmpeg', ['-version']).then(() => true, () => false);
  if (!ffmpeg) return 'no ffmpeg on this machine';
  return pool.tab('probe').then(() => pool.close('probe')).then(() => null, () => 'no browser for agents on this machine');
};
const recordings = () => readdirSync(os.tmpdir()).filter((f) => f.startsWith('focus-recording-')).length;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('records an agent’s browser across a closed tab and edits it into an MP4 and a GIF, fast-forwarding the wait', async (ctx) => {
  const why = await missing();
  if (why) return ctx.skip(why);
  const before = recordings();
  await pool.record('qa');
  let { page } = await pool.tab('qa');
  pool.acted('qa');
  await page.setContent(PAGE);
  // past the action's 3 s at real speed, so the wait between the two actions is fast-forwarded
  await wait(7000);
  // the session ends and a new one picks the review up: the recording goes on in the new tab
  await pool.close('qa');
  ({ page } = await pool.tab('qa'));
  await page.setContent(PAGE);
  pool.acted('qa');
  await page.click('button');
  await wait(1500);
  await pool.close('qa');

  const edited = await pool.finishRecording('qa');
  expect(edited).not.toBeNull();
  if (!edited) return;
  expect(edited.actions).toBe(2);
  // the terminal's line says the wait was fast-forwarded, and at what speed
  expect(edited.summary).toMatch(/; fast-forwarded \d+\.\ds–\d+\.\ds at ×\d+/);
  expect(edited.realSeconds).toBeGreaterThan(8);
  expect(edited.shownSeconds).toBeLessThan(edited.realSeconds - 2);
  expect(edited.mp4.subarray(4, 8).toString()).toBe('ftyp');
  expect(edited.gif?.subarray(0, 6).toString()).toBe('GIF89a');
  // the frames are thrown away once edited, and a finished recording isn't there to finish again
  expect(recordings()).toBe(before);
  expect(await pool.finishRecording('qa')).toBeNull();
}, 60_000);

it('has nothing to show for a browser recorded but never acted in, or never recorded', async (ctx) => {
  const why = await missing();
  if (why) return ctx.skip(why);
  await pool.record('idle');
  await pool.tab('idle');
  await wait(300);
  expect(await pool.finishRecording('idle')).toBeNull();
  expect(await pool.finishRecording('never')).toBeNull();
}, 30_000);
