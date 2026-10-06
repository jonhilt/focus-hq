// Z-fighting check: starts the office in demo mode on a free port, scans the 3D scene for faces from different meshes
// that share a plane (client/src/world/zfight.ts) and exits non-zero listing each fighting pair.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { FightingPair } from '../client/src/world/zfight';
import { CheckFailed, freePort, launchBrowser, startDemo, stopDemo, waitForServer } from './demoOffice';

/** Overlaps that are fine as they are. Each pattern matches one mesh's identity, in either order. */
const ALLOWED: { a: RegExp; b: RegExp; reason: string }[] = [];

const allowed = (p: FightingPair) =>
  ALLOWED.some(({ a, b }) => (a.test(p.a) && b.test(p.b)) || (a.test(p.b) && b.test(p.a)));

async function scan(browser: Browser, url: string): Promise<{ pairs: FightingPair[]; meshes: number; padds: number }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
  // the world is built once the first snapshot arrives
  const built = await page
    .waitForFunction(() => {
      const hq = (window as { focusHQ?: { world: { rooms: Map<string, unknown>; lounge: unknown } } }).focusHQ;
      return !!hq && hq.world.rooms.size > 0 && !!hq.world.lounge;
    }, null, { timeout: 30_000 })
    .then(() => true, () => false);
  if (!built) throw new CheckFailed('the office is built within 30s');
  // the lounge crew, PADDs in hand, only take their seats for a briefing
  const called = await page.evaluate(async () => {
    const { state } = (window as unknown as { focusHQ: { state: { projects: { id: string }[] } } }).focusHQ;
    const res = await fetch('/api/briefing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: state.projects[0]?.id, idea: 'Check the ship for z-fighting' }),
    });
    return res.ok ? '' : await res.text();
  });
  if (called) throw new CheckFailed(`a briefing starts in the lounge (${called})`);
  const seated = await page
    .waitForFunction(() => {
      const world = (window as unknown as { focusHQ: { world: { root: import('three').Object3D } } }).focusHQ.world;
      return !!world.root.getObjectByName('padd');
    }, null, { timeout: 15_000 })
    .then(() => true, () => false);
  if (!seated) throw new CheckFailed('the briefing officer sits down with a PADD within 15s');
  // they only move while someone's near, so join them and give a few frames to raise their PADDs
  await page.evaluate(() => (window as unknown as { focusHQ: { ui: { goToLounge(): void } } }).focusHQ.ui.goToLounge());
  await page.waitForTimeout(1000);
  // a module path in a variable, so tsc doesn't try to resolve Vite's URL
  const modulePath = '/src/world/zfight.ts';
  return page.evaluate(async (modulePath) => {
    const { findZFighting } = (await import(modulePath)) as typeof import('../client/src/world/zfight');
    const world = (window as unknown as { focusHQ: { world: { root: import('three').Object3D } } }).focusHQ.world;
    const scene = world.root.parent ?? world.root;
    let meshes = 0;
    let padds = 0;
    scene.traverse((o) => {
      if ((o as import('three').Mesh).isMesh) meshes++;
      if (o.name === 'padd') padds++;
    });
    return { pairs: findZFighting(scene), meshes, padds };
  }, modulePath);
}

async function main(): Promise<number> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-zfight-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Z-fighting scan: demo office on ${url}`);
  const server = startDemo(port, dataDir);
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    browser = await launchBrowser();
    const { pairs, meshes, padds } = await scan(browser, url);
    const fighting = pairs.filter((p) => !allowed(p));
    console.log(`Scanned ${meshes} meshes (${padds} PADDs); ${pairs.length - fighting.length} allowed overlaps skipped.`);
    if (!fighting.length) {
      console.log('No z-fighting found.');
      return 0;
    }
    console.error(`Found ${fighting.length} pair(s) of faces less than 0.002 apart:`);
    for (const p of fighting) {
      console.error(`  • ${p.a}\n    ${p.b}\n    at (${p.at.join(', ')}), overlapping ${p.area.toFixed(4)} m²`);
    }
    return 1;
  } catch (err) {
    console.error(err instanceof CheckFailed ? `Z-fighting scan FAILED: ${err.message}` : err);
    return 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
