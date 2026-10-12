import { describe, expect, it } from 'vitest';
import { chiefEngineer, crewVoice, leadFor, plannerFor, qaOfficerFor } from './crew';

describe('chiefEngineer', () => {
  it('is the same operations officer on every call', () => {
    expect(chiefEngineer()).toEqual(chiefEngineer());
    expect(chiefEngineer().avatar.division).toBe('operations');
  });
});

describe('leadFor', () => {
  const goals = Array.from({ length: 200 }, (_, i) => `g${i}`);
  const surname = (name: string) => name.split(' ').at(-1);

  it('never shares a surname with the room’s officers or its other leads', () => {
    const others = ['Lt. Okafor', 'Lt. Haddad'];
    const officers = [plannerFor('p1').name, qaOfficerFor('p1').name, ...others].map(surname);
    for (const g of goals) expect(officers).not.toContain(surname(leadFor('p1', g, others).name));
  });

  it('keeps clear of the closed goals’ leads, so one reopened gets their own name back', () => {
    const closed = ['Lt. Varga', 'Lt. Moreau', 'Lt. Tanaka'];
    for (const g of goals) expect(closed.map(surname)).not.toContain(surname(leadFor('p1', g, [], closed).name));
  });

  it('takes a closed goal’s lead’s surname only when there’s no other', () => {
    const everyone = Array.from(new Set(goals.map((g) => leadFor('p1', g).name)));
    const [last, ...rest] = everyone;
    expect(leadFor('p1', 'g0', rest, [last]).name).toBe(last);
  });

  it('is the same lead for the same goal', () => {
    expect(leadFor('p1', 'g1', ['Lt. Okafor'])).toEqual(leadFor('p1', 'g1', ['Lt. Okafor']));
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
