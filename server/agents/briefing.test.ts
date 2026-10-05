import { describe, expect, it } from 'vitest';
import { briefingSystemPrompt } from './briefing';

const req = { planner: { name: 'Ensign Ro' }, projectName: 'Shop', repos: ['acme/shop'] } as Parameters<typeof briefingSystemPrompt>[0];

describe('briefingSystemPrompt', () => {
  it('tells the officer they can search and read the web', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toContain('WebSearch');
    expect(prompt).toContain('WebFetch');
    expect(prompt).toMatch(/source/);
  });

  it('still points them at the code first', () => {
    expect(briefingSystemPrompt(req)).toContain('Read, Glob, Grep');
  });
});
