import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/scripts.md is where an agent looks up what a script does, so it lists every script package.json has and none it
// doesn't: a script added or renamed without its line fails here, not in an agent's session.
const ROOT = path.resolve(import.meta.dirname, '..');
const scripts = Object.keys((JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts);
const named = (text: string) => new Set([...text.matchAll(/`pnpm (?:run )?([\w:-]+)/g)].map((m) => m[1]));
const doc = named(readFileSync(path.join(ROOT, 'docs', 'scripts.md'), 'utf8'));
const claudeMd = named(readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'));
// pnpm's own commands, which scripts.md names beside the scripts
const PNPM = new Set(['install', 'exec', 'start', 'test']);

describe('docs/scripts.md', () => {
  it('names every script in package.json (or CLAUDE.md does)', () => {
    expect(scripts.filter((s) => !doc.has(s) && !claudeMd.has(s))).toEqual([]);
  });

  it('names no script package.json lacks', () => {
    expect([...doc].filter((s) => !scripts.includes(s) && !PNPM.has(s))).toEqual([]);
  });
});
