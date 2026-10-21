import { afterEach, describe, expect, it, vi } from 'vitest';
import { chiefEngineer, crewVoice, hiredName, leadFor, plannerFor, qaOfficerFor, randomAvatar } from './crew';

describe('chiefEngineer', () => {
  it('is the same operations officer on every call', () => {
    expect(chiefEngineer()).toEqual(chiefEngineer());
    expect(chiefEngineer().avatar.division).toBe('operations');
  });
});

describe('randomAvatar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hires an ensign from any division, the first to the last', () => {
    const division = (roll: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      return randomAvatar();
    };
    expect(division(0)).toMatchObject({ division: 'command', rank: 'ensign' });
    expect(division(0.5).division).toBe('operations');
    expect(division(0.99).division).toBe('sciences');
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
  });

  it('matches the browser voice’s accent to Kokoro’s', () => {
    for (const p of projects) {
      const v = crewVoice('officer', p);
      expect(v.lang).toBe(v.kokoro.startsWith('b') ? 'en-GB' : 'en-US');
    }
  });
});

describe('hiredName', () => {
  const rolls = Array.from({ length: 100 }, (_, i) => i / 100);
  const surname = (name: string) => name.split(' ').at(-1);
  const officers = [plannerFor('p1').name, qaOfficerFor('p1').name].map(surname);

  it('is an ensign with a surname from the crew list', () => {
    expect(hiredName('p1', 'ensign', [], 0.5)).toMatch(/^Ensign [A-Z][a-z]+$/);
    expect(hiredName('p1', 'lieutenant', [], 0.5)).toMatch(/^Lt\. [A-Z][a-z]+$/);
  });

  it('never shares a surname with the room’s officers', () => {
    for (const roll of rolls) expect(officers).not.toContain(surname(hiredName('p1', 'ensign', [], roll)));
  });

  it('never shares a surname with anyone already aboard', () => {
    const taken = ['Ensign Okafor', 'Ensign Varga', 'Lt. Moreau', 'Ensign Tanaka'];
    for (const roll of rolls) expect(taken.map(surname)).not.toContain(surname(hiredName('p1', 'ensign', taken, roll)));
  });

  it('hires a whole ship of different names, then numbers them once every surname is taken', () => {
    const taken: string[] = [];
    for (const roll of rolls.slice(0, 60)) {
      const name = hiredName('p1', 'ensign', taken, roll);
      expect(taken).not.toContain(name);
      expect(officers).not.toContain(surname(name.replace(/ \d+$/, '')));
      taken.push(name);
    }
    // 20 surnames less the two officers': 18 plain names, then numbered ones
    expect(taken.filter((n) => /^Ensign [A-Z][a-z]+$/.test(n))).toHaveLength(18);
    expect(taken.at(-1)).toMatch(/^Ensign [A-Z][a-z]+ \d+$/);
  });
});
