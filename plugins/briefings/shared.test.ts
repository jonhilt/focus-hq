import { describe, expect, it } from 'vitest';
import { firstChangedBeat, writerPatch, writerRun, writtenHow } from './shared';

describe('firstChangedBeat', () => {
  const v1 = { lines: ['Save.', 'Pass it on.', 'It waits.'], titles: ['Save', 'Pass', 'Outage'] };

  it('finds the first beat whose line changed', () => {
    expect(firstChangedBeat(v1, { ...v1, lines: ['Save.', 'Pass it on.', 'It retries three times, then says so.'] })).toBe(2);
  });

  it('counts a changed title, or a beat added on the end', () => {
    expect(firstChangedBeat(v1, { ...v1, titles: ['Save', 'Hand over', 'Outage'] })).toBe(1);
    expect(firstChangedBeat(v1, { lines: [...v1.lines, 'And then?'], titles: [...v1.titles, 'After'] })).toBe(3);
  });

  it('has none when every beat reads the same, or there was no earlier version', () => {
    expect(firstChangedBeat(v1, { ...v1 })).toBe(-1);
    expect(firstChangedBeat(undefined, v1)).toBe(-1);
  });
});

describe('the briefing writer', () => {
  const settings = { model: 'claude-sonnet-5-5', leadEffort: 'high' } as const;

  it('runs on the leads’ model and effort unless the captain picked others, and fast only where the model has it', () => {
    expect(writerRun({ model: '', effort: '', fast: true }, settings)).toEqual({ model: 'claude-sonnet-5-5', effort: 'high', fast: false });
    expect(writerRun({ model: 'claude-opus-5-5', effort: 'low', fast: true }, settings)).toEqual({ model: 'claude-opus-5-5', effort: 'low', fast: true });
  });

  it('takes a change the browser sends only when it names a model and effort there are', () => {
    expect(writerPatch({ model: 'claude-opus-5-5', fast: true })).toEqual({ model: 'claude-opus-5-5', fast: true });
    expect(writerPatch({ effort: '' })).toEqual({ effort: '' });
    expect(writerPatch({ model: 'gpt-5' })).toBe("there's no writer model gpt-5");
    expect(writerPatch({ effort: 'huge' })).toBe("there's no effort huge");
    expect(writerPatch({ fast: 'yes' })).toBe('fast is on or off');
  });

  it('says how a brief was written up, by the model’s name', () => {
    expect(writtenHow({ model: 'claude-opus-5-5', effort: 'low', fast: true, seconds: 69.7, costUsd: 0.2988 })).toBe('Opus 5.5 on fast mode at low effort, 70 s, $0.30');
    expect(writtenHow({ model: 'opus', effort: 'high', fast: false, seconds: 100 })).toBe('opus at high effort, 100 s');
  });
});
