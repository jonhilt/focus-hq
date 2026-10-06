import { describe, expect, it } from 'vitest';
import { EMPTY_BRIEF } from '../../shared/types';
import { decodeEngineeringReport, engineerPrompt, engineerSystemPrompt } from './engineering';

const option = (title: string, size = 'one agent') => ({ title: ` ${title} `, approach: 'Do it', touches: ['src/a.ts', ' '], tradeoffs: ['Quick'], risks: [], size });

describe('decodeEngineeringReport', () => {
  it('reads two or three options and the recommendation, trimmed', () => {
    const report = decodeEngineeringReport({ options: [option('A'), option('B', 'several issues')], recommended: 1, why: ' Smaller. ' });
    expect(report.options.map((o) => o.title)).toEqual(['A', 'B']);
    expect(report.options[0].touches).toEqual(['src/a.ts']);
    expect(report.options[1].size).toBe('several issues');
    expect(report.why).toBe('Smaller.');
  });

  it('refuses one option, or four', () => {
    expect(() => decodeEngineeringReport({ options: [option('A')], recommended: 0, why: '' })).toThrow(/1 options/);
    expect(() => decodeEngineeringReport({ options: ['A', 'B', 'C', 'D'].map((t) => option(t)), recommended: 0, why: '' })).toThrow(/4 options/);
  });

  it('refuses a recommendation that isn’t one of the options', () => {
    expect(() => decodeEngineeringReport({ options: [option('A'), option('B')], recommended: 2, why: '' })).toThrow(/isn’t there/);
  });

  it('refuses a size other than one agent or several issues', () => {
    expect(() => decodeEngineeringReport({ options: [option('A'), option('B', 'huge')], recommended: 0, why: '' })).toThrow();
  });
});

describe('engineer prompts', () => {
  const req = { engineer: { name: 'Lt. Brennan' }, planner: { name: 'Ensign Ro' }, projectName: 'Shop', repos: ['acme/shop'] } as Parameters<typeof engineerSystemPrompt>[0];

  it('asks for 2 to 3 options, each with approach, files, trade-offs, risks and size, plus a recommendation', () => {
    const prompt = engineerSystemPrompt(req);
    expect(prompt).toMatch(/Two or three options/);
    for (const part of ['the approach in a few lines', 'files and modules it touches', 'trade-offs', 'risks', '"one agent"', '"several issues"', 'Recommend one']) {
      expect(prompt).toContain(part);
    }
  });

  it('keeps the engineer read-only: no code, no spikes', () => {
    expect(engineerSystemPrompt(req)).toMatch(/can't change anything, and you write no code and no spikes/);
  });

  const messages = [
    { from: 'manager' as const, text: 'a wishlist', at: 0 },
    { from: 'officer' as const, text: 'Who for?', at: 1 },
    { from: 'engineer' as const, text: '2 options on the screen.', at: 2 },
    { from: 'manager' as const, text: 'Shoppers.', at: 3 },
  ];

  it('gives a first ask the whole briefing and the brief', () => {
    const prompt = engineerPrompt({ idea: 'a wishlist', brief: { ...EMPTY_BRIEF, summary: 'Wishlists' }, messages, request: '' });
    expect(prompt).toContain('Operations officer: Who for?');
    expect(prompt).toContain('"summary": "Wishlists"');
    expect(prompt).toMatch(/asking engineering for options/);
  });

  it('sends the last options back with the manager’s note, and only what was said since', () => {
    const previous = { options: [option('A'), option('B')].map((o) => ({ ...o, size: 'one agent' as const })), recommended: 0, why: 'Small.' };
    const prompt = engineerPrompt({ idea: 'a wishlist', brief: EMPTY_BRIEF, messages, request: 'Keep it to one file', previous, resumeSessionId: 'e1' });
    expect(prompt).toContain('Keep it to one file');
    expect(prompt).toContain('Recommended: Option A. Small.');
    expect(prompt).toMatch(/Rework them/);
    expect(prompt).toContain('Manager: Shoppers.');
    expect(prompt).not.toContain('Who for?');
  });
});
