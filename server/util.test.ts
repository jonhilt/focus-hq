import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileIn } from './util';

describe('fileIn', () => {
  it('is a plain file name’s file in the folder', () => {
    expect(fileIn('/data/logs', 'agent_1.jsonl')).toBe(path.join('/data/logs', 'agent_1.jsonl'));
    expect(fileIn('/data/logs', '...jsonl')).toBe(path.join('/data/logs', '...jsonl'));
  });

  it('refuses a name that would step out of the folder, or isn’t a name at all', () => {
    for (const name of ['../x.jsonl', 'a/b.jsonl', '/etc/passwd', '..\\x.jsonl', '..', '.', '']) expect(() => fileIn('/data/logs', name)).toThrow(/Not a file name/);
  });
});
