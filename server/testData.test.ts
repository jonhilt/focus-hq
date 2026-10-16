import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from './config';

describe('the tests’ data folder', () => {
  it('is never the captain’s own (~/.focus): vitest.setup.ts gives each test file an empty one', () => {
    expect(config.dataDir).not.toBe(path.resolve(os.homedir(), '.focus'));
    expect(config.dataDir.startsWith(path.resolve(os.tmpdir()))).toBe(true);
  });
});
