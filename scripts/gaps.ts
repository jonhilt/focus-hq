// Gap check: starts the office in demo mode on a free port, scans the 3D scene for faces from different meshes that
// face each other a little way apart (client/src/world/gaps.ts), like a panel hovering off its wall, and exits non-zero
// listing each pair.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { Gap } from '../client/src/world/gaps';
import { CheckFailed, freePort, launchBrowser, openScene, startDemo, stopDemo, waitForServer } from './demoOffice';

/** Gaps that are meant to be there. Each pattern matches one mesh's identity, in either order. */
const ALLOWED: { a: RegExp; b: RegExp; reason: string }[] = [
  {
    a: /door_turbolift_frame/,
    b: /turbolift_wall/,
    reason: "the frame's back meets the car's curved wall at its corner: the gap is tucked into the corner, out of sight",
  },
];

const allowed = (g: Gap) => ALLOWED.some(({ a, b }) => (a.test(g.a) && b.test(g.b)) || (a.test(g.b) && b.test(g.a)));

async function scan(browser: Browser, url: string): Promise<{ gaps: Gap[]; meshes: number }> {
  const page = await openScene(browser, url);
  // a module path in a variable, so tsc doesn't try to resolve Vite's URL
  const modulePath = '/src/world/gaps.ts';
  return page.evaluate(async (modulePath) => {
    const { findGaps } = (await import(modulePath)) as typeof import('../client/src/world/gaps');
    const world = (window as unknown as { focusHQ: { world: { root: import('three').Object3D } } }).focusHQ.world;
    const scene = world.root.parent ?? world.root;
    let meshes = 0;
    scene.traverse((o) => {
      if ((o as import('three').Mesh).isMesh) meshes++;
    });
    return { gaps: findGaps(scene), meshes };
  }, modulePath);
}

async function main(): Promise<number> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-gaps-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Gap scan: demo office on ${url}`);
  const server = startDemo(port, dataDir);
  let browser: Browser | undefined;
  try {
    await waitForServer(url, server, 60_000);
    browser = await launchBrowser();
    const { gaps, meshes } = await scan(browser, url);
    const found = gaps.filter((g) => !allowed(g));
    console.log(`Scanned ${meshes} meshes; ${gaps.length - found.length} allowed gaps skipped.`);
    if (!found.length) {
      console.log('No gaps found.');
      return 0;
    }
    console.error(`Found ${found.length} pair(s) of faces facing each other 0.002–0.05 apart:`);
    for (const g of found) {
      console.error(`  • ${g.a}\n    ${g.b}\n    ${(g.gap * 1000).toFixed(1)} mm apart at (${g.at.join(', ')}), facing over ${(g.area * 1e4).toFixed(0)} cm²`);
    }
    return 1;
  } catch (err) {
    console.error(err instanceof CheckFailed ? `Gap scan FAILED: ${err.message}` : err);
    return 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
