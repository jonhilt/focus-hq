import { describe, expect, it } from 'vitest';
import { qaAtBriefing } from './crew';

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
