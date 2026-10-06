import { describe, expect, it } from 'vitest';
import { chiefEngineer, engineerAtBriefing, qaAtBriefing } from './crew';
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
