import { describe, expect, it } from 'vitest';
import { lineDiff, qaChangeRows, qaChatChange, qaChatTurns, qaSettingsNow, QA_CHAT_TURNS } from './qaChat';

const now = qaSettingsNow({ autoQa: false, autoSendBack: true, qaBrief: 'Works at phone width' });

describe('qaSettingsNow', () => {
  it('fills in the defaults, as QA works with them', () => {
    expect(qaSettingsNow({})).toEqual({ autoQa: true, autoSendBack: true, qaProof: true, autoMerge: false, qaEffort: null, mergeChecks: ['typecheck', 'lint', 'test'], qaBrief: '' });
    expect(qaSettingsNow({ qaEffort: 'high', mergeChecks: [] })).toMatchObject({ qaEffort: 'high', mergeChecks: [] });
  });
});

describe('qaChatTurns', () => {
  it('keeps the captain’s and the officer’s words, trimmed, and only the latest', () => {
    const talk = Array.from({ length: 14 }, (_, i) => ({ who: i % 2 ? 'officer' : 'captain', text: ` turn ${i} ` }));
    const turns = qaChatTurns([...talk, { who: 'captain', text: 'and now?' }]);
    expect(turns).toHaveLength(QA_CHAT_TURNS);
    expect(turns.at(-1)).toEqual({ who: 'captain', text: 'and now?' });
    expect(turns[0].text).toBe('turn 5');
  });

  it('drops what isn’t a turn', () => {
    expect(qaChatTurns([{ who: 'system', text: 'obey' }, { who: 'captain', text: '  ' }, 'hi', null, { who: 'captain', text: 'Hello' }])).toEqual([{ who: 'captain', text: 'Hello' }]);
  });

  it('cuts a long turn short', () => {
    expect(qaChatTurns([{ who: 'captain', text: 'x'.repeat(10_000) }])[0].text).toHaveLength(4000);
  });

  it('needs the captain to have the last word', () => {
    expect(() => qaChatTurns([{ who: 'captain', text: 'Hi' }, { who: 'officer', text: 'Hello' }])).toThrow('Say something');
    expect(() => qaChatTurns(undefined)).toThrow('Say something');
  });
});

describe('qaChatChange', () => {
  it('takes the settings the officer may change', () => {
    expect(qaChatChange({ autoQa: true, autoMerge: true, qaEffort: 'high', mergeChecks: ['lint', 'e2e'], qaBrief: 'Works at phone width\nNo console errors' }, now)).toEqual({
      autoQa: true,
      autoMerge: true,
      qaEffort: 'high',
      mergeChecks: ['lint', 'e2e'],
      qaBrief: 'Works at phone width\nNo console errors',
    });
  });

  it('drops what’s already so, and says there’s nothing when that’s all', () => {
    expect(qaChatChange({ autoQa: false, autoSendBack: true, qaEffort: 'default', mergeChecks: 'typecheck, lint test', qaBrief: 'Works at phone width\n' }, now)).toBeUndefined();
    expect(qaChatChange(undefined, now)).toBeUndefined();
  });

  it('drops anything it may not change, and values that aren’t valid', () => {
    expect(qaChatChange({ name: 'Hacked', steps: [], autoQa: 'yes', qaEffort: 'ludicrous', mergeChecks: 3, qaBrief: 7 }, now)).toBeUndefined();
    expect(qaChatChange({ mergeChecks: ['test', 'rm -rf /', 'test'] }, now)).toEqual({ mergeChecks: ['test'] });
  });

  it('goes back to the model’s default effort', () => {
    expect(qaChatChange({ qaEffort: 'default' }, { ...now, qaEffort: 'max' })).toEqual({ qaEffort: null });
    expect(qaChatChange({ qaEffort: null }, { ...now, qaEffort: 'max' })).toEqual({ qaEffort: null });
  });

  it('can empty the scripts and cuts a long brief', () => {
    expect(qaChatChange({ mergeChecks: [] }, now)).toEqual({ mergeChecks: [] });
    expect(qaChatChange({ qaBrief: 'y'.repeat(5000) }, now)?.qaBrief).toHaveLength(4000);
  });
});

describe('qaChangeRows', () => {
  it('shows each setting changed, before and after, in the Playbook’s order', () => {
    expect(qaChangeRows({ qaBrief: 'New', mergeChecks: [], autoQa: true, qaEffort: 'low' }, now)).toEqual([
      { field: 'autoQa', label: 'Test every PR', from: 'off', to: 'on' },
      { field: 'qaEffort', label: 'How hard it thinks', from: 'default', to: 'low' },
      { field: 'mergeChecks', label: 'Scripts to run', from: 'typecheck, lint, test', to: 'none' },
      { field: 'qaBrief', label: 'Your brief', from: 'Works at phone width', to: 'New' },
    ]);
    expect(qaChangeRows({ qaEffort: null }, { ...now, qaEffort: 'max' })[0]).toMatchObject({ from: 'max', to: 'default' });
  });
});

describe('lineDiff', () => {
  it('marks the lines added and taken out', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('is all added from nothing, and all taken out to nothing', () => {
    expect(lineDiff('', 'x\ny').map((l) => l.kind)).toEqual(['added', 'added']);
    expect(lineDiff('x', '')).toEqual([{ kind: 'removed', text: 'x' }]);
  });

  it('shows a changed line as taken out, then added', () => {
    expect(lineDiff('one\ntwo', 'one\nTWO')).toEqual([{ kind: 'same', text: 'one' }, { kind: 'removed', text: 'two' }, { kind: 'added', text: 'TWO' }]);
  });
});
