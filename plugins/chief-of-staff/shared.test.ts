import { describe, expect, it } from 'vitest';
import { autoSendFor, cosReadOf, freshState, MAX_REPLY_LABEL, MAX_REPLY_TEXT, readOf, repliesOf, verdictOf } from './shared';

const verdict = { route: 2, ask: 'Filters first?', why: 'A pick.', message: 'Filters.' };

describe('its mark on a lead’s turn, read back', () => {
  it('is a read when it has the shape of one, its words’ time only once judged', () => {
    expect(cosReadOf({ at: 5 })).toEqual({ at: 5 });
    expect(cosReadOf({ at: 5, judged: verdict, sendsAt: 9 })).toEqual({ at: 5, judged: verdict, sendsAt: 9 });
    expect(cosReadOf({ at: 5, sendsAt: 9 })).toEqual({ at: 5 });
    expect(cosReadOf({ at: 5, judged: { ...verdict, route: 7 } })).toEqual({ at: 5 });
    for (const not of [undefined, 'reading', {}, { at: '5' }]) expect(cosReadOf(not)).toBeUndefined();
  });

  it('keeps when the captain acknowledged the turn, and drops a countdown once they have', () => {
    expect(cosReadOf({ at: 5, acked: 7 })).toEqual({ at: 5, acked: 7 });
    expect(cosReadOf({ at: 5, judged: verdict, sendsAt: 9, acked: 7 })).toEqual({ at: 5, judged: verdict, acked: 7 });
    expect(cosReadOf({ at: 5, acked: 'yes' })).toEqual({ at: 5 });
  });

  it('reads a verdict’s suggested replies, and one from before it suggested any as suggesting none', () => {
    const replies = [{ label: 'Keep it open', text: 'Keep the goal open.' }, { label: 'Close it', text: 'Close it.' }];
    expect(verdictOf({ ...verdict, replies })).toEqual({ ...verdict, replies });
    expect(verdictOf(verdict)).toEqual(verdict);
    expect(verdictOf({ ...verdict, replies: 'yes' })).toEqual(verdict);
    expect(verdictOf({ ...verdict, replies: [] })).toEqual(verdict);
  });

  it('takes a reply only with a label and words, each label once, three at most', () => {
    expect(repliesOf([{ label: ' Go ', text: ' Yes, go. ' }, { label: 'go', text: 'Again' }, { label: '', text: 'x' }, { label: 'x' }, 'Go', null, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }]))
      .toEqual([{ label: 'Go', text: 'Yes, go.' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }]);
    expect(repliesOf(undefined)).toEqual([]);
  });

  it('drops a reply whose label would run off its button, or whose words are a letter, rather than clip it', () => {
    const label = 'x'.repeat(MAX_REPLY_LABEL);
    const text = 'y'.repeat(MAX_REPLY_TEXT);
    expect(repliesOf([
      { label: 'Keep the goal open and start the settings page slice next', text: 'Keep it open.' },
      { label: 'Close it', text: `${text}y` },
      { label: ` ${label} `, text: ` ${text} ` },
    ])).toEqual([{ label, text }]);
    expect(verdictOf({ ...verdict, replies: [{ label: `${label}x`, text: 'Go.' }] })).toEqual(verdict);
  });

  it('is read from the lead’s marks, under the plugin’s id', () => {
    expect(readOf({ lead: { station: 0, title: 'W', repos: [], slice: 1, prs: [], marks: { 'chief-of-staff': { at: 3 }, other: 'x' } } })).toEqual({ at: 3 });
    expect(readOf({ lead: undefined })).toBeUndefined();
  });
});

describe('sending its words by itself', () => {
  const project = { id: 'p' };

  it('is off until the captain says, and goes by what they said', () => {
    expect(autoSendFor(freshState(), project)).toBe(false);
    expect(autoSendFor({ autoSend: { p: true } }, project)).toBe(true);
    expect(autoSendFor({ autoSend: { p: true } }, undefined)).toBe(false);
  });

  it('carries over what Focus kept on the project before the setting was its own, until the captain says otherwise', () => {
    const before = { ...project, cosAutoSend: true };
    expect(autoSendFor(freshState(), before)).toBe(true);
    expect(autoSendFor({ autoSend: { p: false } }, before)).toBe(false);
    const unsure = { ...project, cosAutoSend: 'yes' };
    expect(autoSendFor(freshState(), unsure)).toBe(false);
  });
});
