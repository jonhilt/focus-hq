import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The Tricorder is the light client for phones: it must never pull in three.js or the 3D world.

const IMPORT = /^(?:import|export)\s[^'"]*?from\s+'([^']+)'|^import\s+'([^']+)'/gm;

function imports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) {
      seen.add(spec);
      continue;
    }
    const base = path.resolve(path.dirname(file), spec);
    const resolved = [base, `${base}.ts`].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (resolved?.endsWith('.ts')) imports(resolved, seen);
  }
  return seen;
}

const threeOrWorld = (all: string[]) => all.filter((f) => f === 'three' || f.startsWith('three/') || f.includes(`${path.sep}world${path.sep}`));

describe('the Tricorder bundle', () => {
  it('imports nothing from three.js or client/src/world/', () => {
    const all = [...imports(path.resolve(__dirname, 'main.ts'))];
    expect(all.some((f) => f.endsWith('net/state.ts'))).toBe(true);
    expect(threeOrWorld(all)).toEqual([]);
  });

  it('nor does any plugin’s part of it (its phone.ts, found as the Tricorder’s built)', () => {
    const plugins = path.resolve(__dirname, '../../../plugins');
    const phones = fs.existsSync(plugins) ? fs.readdirSync(plugins).map((d) => path.join(plugins, d, 'phone.ts')).filter((f) => fs.existsSync(f)) : [];
    for (const phone of phones) expect(threeOrWorld([...imports(phone)]), phone).toEqual([]);
  });
});
