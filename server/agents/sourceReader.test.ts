import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceReader } from './sourceReader';

describe('sourceReader', () => {
  it('reads files inside its roots, and nothing outside them, however the path is written', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'source-reader-'));
    const root = path.join(base, 'planning');
    fs.mkdirSync(path.join(root, 'p1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'p1', 'a.ts'), 'one\ntwo');
    fs.writeFileSync(path.join(base, 'secret.txt'), 'no');
    const read = sourceReader([root, path.join(base, 'not-yet')]);
    expect(read(path.join(root, 'p1', 'a.ts'))).toEqual(['one', 'two']);
    expect(read(path.join(root, 'p1', '..', '..', 'secret.txt'))).toBeUndefined();
    expect(read(path.join(base, 'secret.txt'))).toBeUndefined();
    expect(read('p1/a.ts')).toBeUndefined();
    expect(read(path.join(root, 'p1'))).toBeUndefined();
    expect(read(path.join(root, 'gone.ts'))).toBeUndefined();
  });
});
