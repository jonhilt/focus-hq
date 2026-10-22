import { describe, expect, it } from 'vitest';
import { autoSendFor, cosReadOf, freshState, readOf } from './shared';

const verdict = { route: 2, ask: 'Filters first?', why: 'A pick.', message: 'Filters.' };

describe('its mark on a lead’s turn, read back', () => {
  it('is a read when it has the shape of one, its words’ time only once judged', () => {
    expect(cosReadOf({ at: 5 })).toEqual({ at: 5 });
    expect(cosReadOf({ at: 5, judged: verdict, sendsAt: 9 })).toEqual({ at: 5, judged: verdict, sendsAt: 9 });
    expect(cosReadOf({ at: 5, sendsAt: 9 })).toEqual({ at: 5 });
    expect(cosReadOf({ at: 5, judged: { ...verdict, route: 7 } })).toEqual({ at: 5 });
    for (const not of [undefined, 'reading', {}, { at: '5' }]) expect(cosReadOf(not)).toBeUndefined();
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
