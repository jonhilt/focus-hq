// The TV studio (docs/studio.md): plays a scene script (scenes/*.yaml) against a demo office, films it at 1080p,
// splices in its explainer and writes a rough cut and a beat sheet to studio-out/<scene>/. With --voice, mixes a
// voiceover recorded against that rough cut into final.mp4 instead (it doesn't film again).
//
//   pnpm run studio scenes/subagents.yaml
//   pnpm run studio scenes/subagents.yaml --voice ~/vo.m4a
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { parse } from 'yaml';
import { beatSheet, CUE_TIMEOUT_S, readScene, type Scene, type SceneBeat, type Timing } from '../shared/studio';
import type { Agent } from '../shared/types';
import { explainerPage } from '../server/agents/explainer';
import { CheckFailed, freePort, launchBrowser, root, startDemo, stopDemo, waitForServer } from './demoOffice';

const SIZE = { width: 1920, height: 1080 };
const FPS = 30;
/** Headless Chromium draws WebGL on the GPU with these, rather than in software. */
const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])];
/** The explainer's player is laid out at 1280 × 800: scaled to fill 1080 high. */
const EXPLAINER_ZOOM = SIZE.height / 800;

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

function ffmpeg(args: string[]): void {
  const done = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (done.error) throw new CheckFailed(`ffmpeg runs (${done.error.message}): install it, e.g. "brew install ffmpeg"`);
  if (done.status !== 0) throw new CheckFailed(`ffmpeg ${args.join(' ')} exited with ${done.status}`);
}

/** A recording's page with a clock that started with its video: Playwright films a page from when it opens. */
async function filming(browser: Browser, dir: string): Promise<{ page: Page; at: () => number; stop: () => Promise<string> }> {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir, size: SIZE } });
  const page = await context.newPage();
  const opened = Date.now();
  return {
    page,
    at: () => (Date.now() - opened) / 1000,
    stop: async () => {
      await context.close();
      const video = await page.video()?.path();
      if (!video) throw new CheckFailed('Playwright saves the video');
      return video;
    },
  };
}

/** The explainer, played once from the top: its video, and when the playing starts and stops in it. */
async function filmExplainer(browser: Browser, scene: Scene, dir: string): Promise<{ video: string; from: number; to: number }> {
  const built = explainerPage({ id: 'insert', ...scene.explainer! });
  if ('error' in built) throw new CheckFailed(`the explainer builds (${built.error})`);
  const film = await filming(browser, dir);
  await film.page.setContent(built.html, { waitUntil: 'networkidle' });
  await film.page.addStyleTag({ content: `html { zoom: ${EXPLAINER_ZOOM}; background: #000; } body { margin: 0 ${(SIZE.width / EXPLAINER_ZOOM - 1280) / 2}px; }` });
  await film.page.evaluate('document.fonts.ready');
  await sleep(0.5);
  const from = film.at();
  await film.page.evaluate('window.kitPlay()');
  await film.page.waitForFunction('window.kitDone === true', null, { timeout: 120_000 });
  await sleep(1.5);
  const to = film.at();
  return { video: await film.stop(), from, to };
}

/** Plays the scene against the office at `url`, beat by beat: the video, and when each beat started and ended in it. */
async function filmShip(browser: Browser, scene: Scene, url: string, dir: string): Promise<{ video: string; marks: { start: number; end: number }[] }> {
  const film = await filming(browser, dir);
  const { page } = film;
  const errors: string[] = [];
  // pointer lock is refused headlessly, which the studio doesn't need
  page.on('pageerror', (err) => !/pointer ?lock/i.test(err.message) && errors.push(err.message));
  await page.goto(`${url}?studio=1`);
  await page.locator('.splash button.big-button').click({ timeout: 60_000 });
  await page.waitForFunction('!!window.focusHQ?.studio && window.focusHQ.world.rooms.size > 0', null, { timeout: 30_000 });
  const studio = (expr: string) => page.evaluate(`window.focusHQ.studio.${expr}`);
  const lead = () => studio('lead()') as Promise<Agent | undefined>;
  const api = async (route: string, body: unknown) => {
    const res = await fetch(`${url}api${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new CheckFailed(`POST ${route} (${res.status}: ${await res.text()})`);
  };
  // the captain says yes to whatever the lead asks permission for, as soon as it asks
  const approving = setInterval(() => {
    void lead().then((l) => l?.permission && api(`/agents/${l.id}/permission`, { requestId: l.permission.id, allow: true })).catch(() => undefined);
  }, 500);

  const act = async (beat: SceneBeat) => {
    if (beat.do === 'start-goal') {
      const state = (await (await fetch(`${url}api/state`)).json()) as { projects: { id: string; name: string }[] };
      const project = state.projects.find((p) => p.name === scene.project);
      if (!project) throw new CheckFailed(`the demo office has a project called ${scene.project}`);
      return api(`/projects/${project.id}/goals`, { text: scene.goal });
    }
    const l = await lead();
    if (!l) throw new CheckFailed(`there's a lead to ${beat.do}`);
    if (beat.do === 'reply') return api(`/agents/${l.id}/message`, { text: beat.say });
    const open = l.lead?.questions?.findLast((q) => !q.answer);
    if (!open) throw new CheckFailed(`the lead has asked something to answer by "${beat.title}"`);
    return api(`/agents/${l.id}/answer`, { question: open.id, option: open.options[0].id });
  };
  // a shot of the station waits for its lead to sit down
  const shoot = async (beat: SceneBeat) => {
    for (const deadline = Date.now() + 30_000; ; await sleep(0.25)) {
      try {
        return await studio(`shot(${JSON.stringify(beat.shot)}, ${beat.glide ?? 0})`);
      } catch (err) {
        if (Date.now() > deadline) throw new CheckFailed(`the ${beat.shot} shot for "${beat.title}" (${String(err)})`);
      }
    }
  };

  const marks: { start: number; end: number }[] = [];
  try {
    for (const beat of scene.beats) {
      const start = film.at();
      console.log(`  ${start.toFixed(1).padStart(6)}s  ${beat.title}`);
      if (beat.insert) {
        marks.push({ start, end: start });
        continue;
      }
      if (beat.do) await act(beat);
      // a cut goes black first, so the caption comes up on the new shot; a glide carries it along
      const shot = beat.shot ? shoot(beat) : Promise.resolve();
      if (!beat.glide) await shot;
      await studio(`say(${JSON.stringify(beat.title)}, ${JSON.stringify(beat.caption)})`);
      await shot;
      if (beat.until) {
        const cue = JSON.stringify(beat.until);
        const met = await page.waitForFunction(`window.focusHQ.studio.cue(${cue})`, null, { timeout: CUE_TIMEOUT_S * 1000, polling: 250 }).then(() => true, () => false);
        if (!met) throw new CheckFailed(`"${beat.title}" waits for ${beat.until} within ${CUE_TIMEOUT_S}s`);
      }
      await sleep(beat.hold);
      marks.push({ start, end: film.at() });
    }
    await studio('say()');
    await sleep(1);
  } finally {
    clearInterval(approving);
  }
  if (errors.length) console.warn(`  page errors while filming: ${errors.join(' | ')}`);
  return { video: await film.stop(), marks };
}

/**
 * Splices the cut: the ship from its first beat to its last, with the explainer let in where its beat is. Each beat's
 * time in the cut comes back, for the beat sheet.
 */
function cut(scene: Scene, ship: { video: string; marks: { start: number; end: number }[] }, insert: { video: string; from: number; to: number } | null, out: string): Timing[] {
  const begin = ship.marks[0].start;
  const end = ship.marks.at(-1)!.end;
  const at = scene.beats.findIndex((b) => b.insert);
  const splice = insert && at >= 0 ? ship.marks[at].start : null;
  const extra = insert && splice !== null ? insert.to - insert.from : 0;
  const ends = ship.marks.map((m, i) => ship.marks[i + 1]?.start ?? m.end);
  const timings = ship.marks.map((m, i): Timing => {
    if (i === at && splice !== null) return { start: splice - begin, length: extra };
    const shift = splice !== null && m.start >= splice && i > at ? extra : 0;
    return { start: m.start - begin + shift, length: ends[i] - m.start };
  });
  const v = (input: number, from: number, to: number, label: string) => `[${input}:v]trim=start=${from.toFixed(3)}:end=${to.toFixed(3)},setpts=PTS-STARTPTS,scale=${SIZE.width}:${SIZE.height},fps=${FPS}[${label}]`;
  const parts = splice !== null && insert ? [v(0, begin, splice, 'a'), v(1, insert.from, insert.to, 'b'), v(0, splice, end, 'c')] : [v(0, begin, end, 'a')];
  const labels = parts.map((p) => p.slice(p.lastIndexOf('[')));
  ffmpeg([
    '-i', ship.video,
    ...(insert ? ['-i', insert.video] : []),
    '-filter_complex', `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=1:a=0[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out,
  ]);
  return timings;
}

async function record(scene: Scene, outDir: string): Promise<void> {
  const raw = path.join(outDir, 'raw');
  mkdirSync(raw, { recursive: true });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-studio-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Studio: filming "${scene.title}" against a demo office on ${url}`);
  const server = startDemo(port, dataDir, { args: ['--studio'], env: { FOCUS_DEMO_SPEED: String(scene.speed), FOCUS_DEMO_SEED: String(scene.seed) } });
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    browser = await launchBrowser(GPU);
    const insert = scene.explainer && scene.beats.some((b) => b.insert) ? await filmExplainer(browser, scene, raw) : null;
    if (insert) console.log(`  explainer: ${(insert.to - insert.from).toFixed(1)}s`);
    const ship = await filmShip(browser, scene, url, raw);
    renameSync(ship.video, path.join(raw, 'ship.webm'));
    ship.video = path.join(raw, 'ship.webm');
    if (insert) {
      renameSync(insert.video, path.join(raw, 'explainer.webm'));
      insert.video = path.join(raw, 'explainer.webm');
    }
    console.log('  cutting');
    const timings = cut(scene, ship, insert, path.join(outDir, 'rough-cut.mp4'));
    writeFileSync(path.join(outDir, 'beats.md'), beatSheet(scene, timings));
    writeFileSync(path.join(outDir, 'beats.json'), `${JSON.stringify(scene.beats.map((b, i) => ({ title: b.title, caption: b.caption, ...timings[i] })), null, 2)}\n`);
    console.log(`Studio: ${path.relative(root, outDir)}/rough-cut.mp4 and beats.md`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/** The voiceover over the rough cut: the picture as it is, the voice as the only sound, as long as the longer of them. */
function voice(outDir: string, file: string): void {
  const rough = path.join(outDir, 'rough-cut.mp4');
  if (!existsSync(rough)) throw new CheckFailed(`there's a rough cut to put the voice over (${path.relative(root, rough)}): film it first, without --voice`);
  if (!existsSync(file)) throw new CheckFailed(`the voiceover ${file} exists`);
  ffmpeg(['-i', rough, '-i', file, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(outDir, 'final.mp4')]);
  console.log(`Studio: ${path.relative(root, outDir)}/final.mp4`);
}

/** Films a shot plan (scenes/<name>.plan.yaml) on the holodeck stage (client/src/ui/stage/) once from the top, into studio-out/stage-<name>/clip.mp4. */
async function filmStage(name: string): Promise<void> {
  const outDir = path.join(root, 'studio-out', `stage-${name}`);
  const raw = path.join(outDir, 'raw');
  mkdirSync(raw, { recursive: true });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-studio-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Studio: filming the ${name} stage on ${url}`);
  const server = startDemo(port, dataDir, { args: ['--studio'] });
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    browser = await launchBrowser(GPU);
    const film = await filming(browser, raw);
    await film.page.goto(`${url}?studio=1&stage=${encodeURIComponent(name)}`);
    await film.page.locator('.splash button.big-button').click({ timeout: 60_000 });
    // the stage is built once the office has a vacant holodeck to put it in
    await film.page.waitForFunction('(window.focusHQ?.studio?.playStage?.() ?? 0) > 0', null, { timeout: 30_000, polling: 250 });
    const from = film.at();
    const seconds = Number(await film.page.evaluate('window.focusHQ.studio.playStage()'));
    await sleep(seconds + 0.5);
    const to = film.at();
    const missing = await film.page.evaluate<string[]>('window.focusHQ.studio.stageReport()');
    if (missing.length) console.log(`  the plan asked for what the stage can't do yet:\n    ${missing.join('\n    ')}`);
    const video = await film.stop();
    ffmpeg(['-i', video, '-vf', `trim=start=${from.toFixed(3)}:end=${to.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'clip.mp4')]);
    console.log(`Studio: ${path.relative(root, outDir)}/clip.mp4 (${(to - from).toFixed(1)}s)`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const staged = args.indexOf('--stage');
  if (staged >= 0) {
    try {
      await filmStage(args[staged + 1] ?? 'delegation');
      return 0;
    } catch (err) {
      console.error(err instanceof CheckFailed ? `Studio FAILED: ${err.message}` : err);
      return 1;
    }
  }
  const voiced = args.indexOf('--voice');
  const voiceFile = voiced >= 0 ? args[voiced + 1] : undefined;
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--voice');
  if (!file || (voiced >= 0 && !voiceFile)) {
    console.error('Usage: pnpm run studio scenes/<name>.yaml [--voice <voiceover audio>], or pnpm run studio --stage delegation');
    return 2;
  }
  try {
    const scene = readScene(parse(readFileSync(file, 'utf8')));
    const outDir = path.join(root, 'studio-out', path.basename(file, path.extname(file)));
    if (voiceFile) voice(outDir, path.resolve(voiceFile));
    else await record(scene, outDir);
    return 0;
  } catch (err) {
    console.error(err instanceof CheckFailed ? `Studio FAILED: ${err.message}` : err);
    return 1;
  }
}

process.exitCode = await main();
