// Z-fighting check: starts the office in demo mode on a free port, scans the 3D scene for faces from different meshes
// that share a plane (client/src/world/zfight.ts) and exits non-zero listing each fighting pair.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { FightingPair } from '../client/src/world/zfight';
import { CheckFailed, freePort, launchBrowser, openScene, startDemo, stopDemo, waitForServer } from './demoOffice';

/** Overlaps that are fine as they are. Each pattern matches one mesh's identity, in either order. */
const ALLOWED: { a: RegExp; b: RegExp; reason: string }[] = [];

const allowed = (p: FightingPair) =>
  ALLOWED.some(({ a, b }) => (a.test(p.a) && b.test(p.b)) || (a.test(p.b) && b.test(p.a)));

async function scan(browser: Browser, url: string): Promise<{ pairs: FightingPair[]; meshes: number; padds: number }> {
  const page = await openScene(browser, url);
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
  // the decks' meshes as built, not merged (merge.ts), so what's found is named as in Blender
  console.log(`Z-fighting scan: demo office on ${url}`);
  const server = startDemo(port, dataDir);
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    browser = await launchBrowser();
    const { pairs, meshes, padds } = await scan(browser, `${url}?merge=0`);
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
