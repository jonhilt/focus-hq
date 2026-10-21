import { describe, expect, it } from 'vitest';
import { processesIn, reviewEnv } from './replayRules';

describe('a replayed review’s environment', () => {
  it('gives the old build a port and data folder of its own, never the live Focus’s', () => {
    const env = reviewEnv({ PATH: '/bin', PORT: '4477', FOCUS_DATA_DIR: '/Users/x/.focus' }, 51234, '/tmp/clone/.replay-data');
    expect(env).toMatchObject({ PATH: '/bin', PORT: '51234', HOST: '127.0.0.1', FOCUS_DATA_DIR: '/tmp/clone/.replay-data', FOCUS_AUTO_UPDATE: '0' });
  });
});

describe('what a review left running', () => {
  const lsof = ['p100', 'fcwd', 'n/private/var/tmp/r/abc-1', 'p101', 'fcwd', 'n/private/var/tmp/r/abc-1/client', 'p102', 'fcwd', 'n/private/var/tmp/r/abc-10', 'p103', 'fcwd', 'n/Users/x/focus', 'p7', 'fcwd', 'n/private/var/tmp/r/abc-1'].join('\n');

  it('is every process working in the clone or below it, not in a clone whose name starts the same', () => {
    expect(processesIn(lsof, '/private/var/tmp/r/abc-1', 7)).toEqual([100, 101]);
  });

  it('is nothing when nothing works there', () => {
    expect(processesIn(lsof, '/private/var/tmp/r/zzz', 7)).toEqual([]);
  });
});
