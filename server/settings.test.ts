import { describe, expect, it } from 'vitest';
import type { Settings } from '../shared/types';
import { changeSettings, LEAD_COMPACT_MIN } from './settings';

const settings: Settings = {
  maxConcurrent: 4,
  autonomy: 'ask',
  model: '',
  conflictsModel: '',
  conflictsEffort: 'low',
  qaModel: '',
  mergeMethod: 'squash',
  attribution: true,
  userClaudeMd: true,
  leadEffort: 'high',
  leadCompactAt: 200_000,
};

describe('changeSettings', () => {
  it('takes each field the change gets right, trimming models', () => {
    const changed = changeSettings(settings, {
      maxConcurrent: 8,
      autonomy: 'full',
      model: ' claude-opus-5-5 ',
      conflictsModel: ' claude-haiku-4-5 ',
      conflictsEffort: 'max',
      qaModel: ' claude-sonnet-5-5\n',
      mergeMethod: 'rebase',
      attribution: false,
      userClaudeMd: false,
      leadEffort: 'xhigh',
      leadCompactAt: 150_000,
    });
    expect(changed).toEqual({
      maxConcurrent: 8,
      autonomy: 'full',
      model: 'claude-opus-5-5',
      conflictsModel: 'claude-haiku-4-5',
      conflictsEffort: 'max',
      qaModel: 'claude-sonnet-5-5',
      mergeMethod: 'rebase',
      attribution: false,
      userClaudeMd: false,
      leadEffort: 'xhigh',
      leadCompactAt: 150_000,
    });
  });

  it('leaves what the change doesn’t mention, and the settings it was given, as they were', () => {
    const before = { ...settings };
    expect(changeSettings(settings, { autonomy: 'auto' })).toEqual({ ...settings, autonomy: 'auto' });
    expect(changeSettings(settings, {})).toEqual(settings);
    expect(settings).toEqual(before);
  });

  it('keeps the limit on agents at once a whole number from 1 to 32', () => {
    expect(changeSettings(settings, { maxConcurrent: 0 }).maxConcurrent).toBe(1);
    expect(changeSettings(settings, { maxConcurrent: -3 }).maxConcurrent).toBe(1);
    expect(changeSettings(settings, { maxConcurrent: 99 }).maxConcurrent).toBe(32);
    expect(changeSettings(settings, { maxConcurrent: 6.6 }).maxConcurrent).toBe(7);
  });

  it('ignores a limit that isn’t a number, rather than lifting it', () => {
    for (const maxConcurrent of ['lots', '6', null, Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
      expect(changeSettings(settings, { maxConcurrent }).maxConcurrent).toBe(4);
    }
  });

  it('ignores a field of the wrong kind instead of failing the whole change', () => {
    const wrong = { model: 5, conflictsModel: ['x'], qaModel: null, autonomy: 'yolo', mergeMethod: 'octopus', attribution: 'no', userClaudeMd: 1, leadEffort: 'huge', leadCompactAt: '150000' };
    expect(changeSettings(settings, wrong)).toEqual(settings);
    expect(changeSettings(settings, { ...wrong, autonomy: 'auto' })).toEqual({ ...settings, autonomy: 'auto' });
  });

  it('keeps a lead’s compaction threshold off at 0, or a whole number of tokens from the minimum to a million', () => {
    expect(changeSettings(settings, { leadCompactAt: 0 }).leadCompactAt).toBe(0);
    expect(changeSettings(settings, { leadCompactAt: -5 }).leadCompactAt).toBe(0);
    expect(changeSettings(settings, { leadCompactAt: 10_000 }).leadCompactAt).toBe(LEAD_COMPACT_MIN);
    expect(changeSettings(settings, { leadCompactAt: 5_000_000 }).leadCompactAt).toBe(1_000_000);
    expect(changeSettings(settings, { leadCompactAt: 250_000.4 }).leadCompactAt).toBe(250_000);
    expect(changeSettings(settings, { leadCompactAt: Number.NaN }).leadCompactAt).toBe(200_000);
  });

  it('puts an empty or unknown effort for conflict-resolving agents back to the model’s default', () => {
    expect(changeSettings(settings, { conflictsEffort: '' }).conflictsEffort).toBeUndefined();
    expect(changeSettings(settings, { conflictsEffort: 'huge' }).conflictsEffort).toBeUndefined();
    expect(changeSettings(settings, { model: 'x' }).conflictsEffort).toBe('low');
  });

  it('changes nothing for a body that isn’t an object', () => {
    for (const patch of [undefined, null, 'full', 3, true]) expect(changeSettings(settings, patch)).toEqual(settings);
  });
});
