import { describe, expect, it } from 'vitest';
import { atUsageLimit, turnTail } from './turn';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const said = (uuid: string, text: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });
const to = (uuid: string, text: string, isMeta = false) => ({ type: 'user', uuid, isMeta, message: { content: text } });
const tool = (uuid: string) => ({ type: 'user', uuid, message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } });

describe('turnTail', () => {
  it('keeps what the lead said since the last message to it, and names the turn by the last line', () => {
    const t = jsonl([said('a', 'Earlier.'), to('b', 'Grid or list?'), said('c', 'Looking.'), tool('d'), said('e', 'List it is. Ship?'), to('f', 'reminder', true)]);
    expect(turnTail(t)).toEqual({ text: 'Looking.\n\nList it is. Ship?', uuid: 'f' });
  });

  it('starts again after Ops’ messages too, and skips the harness’s own and lines mid-write', () => {
    const t = jsonl([said('a', 'Before.'), to('b', '[Office] Slice 1 merged.'), said('c', 'Next.'), to('d', '<system-reminder>x</system-reminder>')]) + '\n{"type":"assi';
    expect(turnTail(t)).toEqual({ text: 'Next.', uuid: 'd' });
  });

  it('is nothing when the lead said nothing since', () => {
    expect(turnTail(jsonl([said('a', 'Done?'), to('b', 'carry on')]))).toBeUndefined();
    expect(turnTail('')).toBeUndefined();
  });

  it('keeps the last 2,000 characters, marked with how much was cut', () => {
    const text = turnTail(jsonl([said('a', 'x'.repeat(2500))]))?.text;
    expect(text).toBe(`[−500]… ${'x'.repeat(2000)}`);
  });
});

describe('atUsageLimit', () => {
  it('is a turn your plan’s limit stopped', () => {
    expect(atUsageLimit('Working on it.\n\nYou’ve hit your session limit · resets 2pm (Europe/London)')).toBe(true);
    expect(atUsageLimit("You've hit your weekly limit · resets Oct 11 at 3pm (Europe/London)\n")).toBe(true);
    expect(atUsageLimit('You’ve hit your session limit earlier, but carried on. Shall I ship?')).toBe(false);
    expect(atUsageLimit('Shall I start slice 2?')).toBe(false);
  });
});
