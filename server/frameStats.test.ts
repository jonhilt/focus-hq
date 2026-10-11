import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendFrameStats, sessionFile, statLines } from './frameStats';

describe('sessionFile', () => {
  it('names a session’s file after its id', () => {
    expect(sessionFile('2026-10-11T20-01-02-123Z-ab12')).toBe('2026-10-11T20-01-02-123Z-ab12.jsonl');
  });

  it('refuses an id that could reach outside the folder, or isn’t one', () => {
    expect(sessionFile('../state')).toBeNull();
    expect(sessionFile('a/b')).toBeNull();
    expect(sessionFile('')).toBeNull();
    expect(sessionFile(42)).toBeNull();
  });
});

describe('statLines', () => {
  it('keeps each object as a line of JSON and drops anything else', () => {
    expect(statLines([{ kind: 'sample', t: 1 }, 'text', null, [1], 3, { kind: 'hitch' }])).toEqual(['{"kind":"sample","t":1}', '{"kind":"hitch"}']);
    expect(statLines('not a list')).toEqual([]);
  });

  it('drops a line too long to be a sample', () => {
    expect(statLines([{ big: 'x'.repeat(5000) }])).toEqual([]);
  });
});

describe('appendFrameStats', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('appends each post to its session’s file, making the folder the first time', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-frame-stats-')), 'frame-stats');
    dirs.push(path.dirname(dir));
    await appendFrameStats(dir, 'run-1', [{ kind: 'session' }]);
    const { file } = await appendFrameStats(dir, 'run-1', [{ kind: 'sample', t: 1 }, { kind: 'sample', t: 2 }]);
    expect(file).toBe(path.join(dir, 'run-1.jsonl'));
    expect(fs.readFileSync(file, 'utf8')).toBe('{"kind":"session"}\n{"kind":"sample","t":1}\n{"kind":"sample","t":2}\n');
  });

  it('refuses a session id that isn’t a plain name', async () => {
    await expect(appendFrameStats(os.tmpdir(), '../x', [{}])).rejects.toThrow(/letters, digits/);
  });
});
