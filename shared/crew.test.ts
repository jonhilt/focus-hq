import { describe, expect, it } from 'vitest';
import { chiefEngineer, crewVoice } from './crew';

describe('chiefEngineer', () => {
  it('is the same operations officer on every call', () => {
    expect(chiefEngineer()).toEqual(chiefEngineer());
    expect(chiefEngineer().avatar.division).toBe('operations');
  });
});

describe('crewVoice', () => {
  const projects = Array.from({ length: 30 }, (_, i) => `p${i}`);

  it('gives the officer, QA and the engineer different voices in every project', () => {
    for (const p of projects) {
      const voices = new Set([crewVoice('officer', p), crewVoice('qa', p), crewVoice('engineer', p)].map((v) => v.kokoro));
      expect(voices.size).toBe(3);
      expect(new Set([crewVoice('officer', p), crewVoice('qa', p), crewVoice('engineer', p)].map((v) => v.pitch)).size).toBe(3);
    }
  });

  it('is the same voice for the same crew member every time', () => {
    expect(crewVoice('officer', 'p1')).toEqual(crewVoice('officer', 'p1'));
    expect(crewVoice('engineer', 'p1')).toEqual(crewVoice('engineer', 'p2'));
    expect(crewVoice('number-one', 'p1')).toEqual(crewVoice('number-one', 'p2'));
  });

  it('gives Number One a pitch of their own, so they never sound like a room’s crew', () => {
    for (const p of projects) {
      expect([crewVoice('officer', p), crewVoice('qa', p), crewVoice('engineer', p)].map((v) => v.pitch)).not.toContain(crewVoice('number-one', p).pitch);
    }
  });

  it('matches the browser voice’s accent to Kokoro’s', () => {
    for (const p of projects) {
      const v = crewVoice('officer', p);
      expect(v.lang).toBe(v.kokoro.startsWith('b') ? 'en-GB' : 'en-US');
    }
  });
});
