import { describe, expect, it } from 'vitest';
import { autoSendFor, forLead, jevFor } from './cosRules';
import { freshState } from './shared';

describe('whose its words are', () => {
  it('are the lead’s to carry on or go back with, the captain’s on a card or an interrupt', () => {
    expect(([1, 2, 3, 4] as const).map((route) => forLead({ route }))).toEqual([true, false, false, true]);
  });
});

describe('routing with Jev', () => {
  it('is only where the captain switched it on', () => {
    expect(jevFor({ autoSend: {}, jev: { p: true } }, 'p')).toBe(true);
    expect(jevFor({ autoSend: {}, jev: { p: false } }, 'p')).toBe(false);
    expect(jevFor({ autoSend: {} }, 'p')).toBe(false);
    expect(jevFor({ autoSend: {}, jev: { p: true } }, undefined)).toBe(false);
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
