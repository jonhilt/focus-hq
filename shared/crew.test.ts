import { describe, expect, it } from 'vitest';
import { chiefEngineer, crewVoice, engineerAtBriefing, qaAtBriefing } from './crew';
import type { EngineeringReport } from './types';

describe('qaAtBriefing', () => {
  const briefing = { projectId: 'p1', status: 'waiting' } as const;

  it('seats QA at the lounge table for a briefing about their project', () => {
    expect(qaAtBriefing('p1', briefing, undefined)).toBe(true);
    expect(qaAtBriefing('p1', briefing, { status: 'done' })).toBe(true);
  });

  it('leaves QA at their station for another project’s briefing, or none', () => {
    expect(qaAtBriefing('p2', briefing, undefined)).toBe(false);
    expect(qaAtBriefing('p1', null, undefined)).toBe(false);
  });

  it('sends QA back once the issue is written up', () => {
    expect(qaAtBriefing('p1', { ...briefing, status: 'done' }, undefined)).toBe(false);
  });

  it('lets QA finish a review before joining', () => {
    expect(qaAtBriefing('p1', briefing, { status: 'testing' })).toBe(false);
    expect(qaAtBriefing('p1', briefing, { status: 'working' })).toBe(false);
  });
});

describe('chiefEngineer', () => {
  it('is the same operations officer on every call', () => {
    expect(chiefEngineer()).toEqual(chiefEngineer());
    expect(chiefEngineer().avatar.division).toBe('operations');
  });
});

describe('engineerAtBriefing', () => {
  const report: EngineeringReport = { options: [], recommended: 0, why: '' };

  it('stays at the engineering station until a briefing asks engineering', () => {
    expect(engineerAtBriefing(null)).toBe(false);
    expect(engineerAtBriefing({ status: 'waiting' })).toBe(false);
  });

  it('comes to the lounge table while working on options, and stays once they are in', () => {
    expect(engineerAtBriefing({ status: 'engineering' })).toBe(true);
    expect(engineerAtBriefing({ status: 'waiting', engineering: report })).toBe(true);
    expect(engineerAtBriefing({ status: 'thinking', engineering: report })).toBe(true);
  });

  it('goes back to the station once the issue is written up', () => {
    expect(engineerAtBriefing({ status: 'done', engineering: report })).toBe(false);
  });
});

describe('crewVoice', () => {
  const projects = Array.from({ length: 30 }, (_, i) => `p${i}`);

  it('gives the officer, QA and the engineer different voices at every briefing', () => {
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
