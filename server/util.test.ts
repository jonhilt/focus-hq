import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileIn, run } from './util';

describe('fileIn', () => {
  it('is a plain file name’s file in the folder', () => {
    expect(fileIn('/data/logs', 'agent_1.jsonl')).toBe(path.join('/data/logs', 'agent_1.jsonl'));
    expect(fileIn('/data/logs', '...jsonl')).toBe(path.join('/data/logs', '...jsonl'));
  });

  it('refuses a name that would step out of the folder, or isn’t a name at all', () => {
    for (const name of ['../x.jsonl', 'a/b.jsonl', '/etc/passwd', '..\\x.jsonl', '..', '.', '']) expect(() => fileIn('/data/logs', name)).toThrow(/Not a file name/);
  });
});

describe('a command Focus runs', () => {
  it('doesn’t see Focus’s own secrets, though Focus’s environment has them', async () => {
    const before = process.env.FOCUS_BOT_TOKEN;
    process.env.FOCUS_BOT_TOKEN = 'tok';
    try {
      const seen = await run(process.execPath, ['-e', 'console.log(process.env.FOCUS_BOT_TOKEN ?? "none", process.env.PATH ? "path" : "")']);
      expect(seen.trim()).toBe('none path');
    } finally {
      if (before === undefined) delete process.env.FOCUS_BOT_TOKEN;
      else process.env.FOCUS_BOT_TOKEN = before;
    }
  });
});
