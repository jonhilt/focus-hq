import { describe, expect, it } from 'vitest';
import { EMPTY_BRIEF } from '../../shared/types';
import { briefingPrompt, briefingSystemPrompt, mergeBrief } from './briefing';

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

  it('asks for diagrams on complex changes only: Today, one per option, then the chosen one', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toMatch(/complex changes only/);
    expect(prompt).toContain('"Today"');
    expect(prompt).toContain('"Option A: …"');
    expect(prompt).toContain('"Chosen: …"');
    expect(prompt).toMatch(/choose in the conversation/);
  });

  it('limits diagrams to types that parse, with quoted labels', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toContain('flowchart, classDiagram or sequenceDiagram');
    expect(prompt).toMatch(/label in double quotes/);
  });
});

describe('briefingPrompt', () => {
  const turn = (kind: Parameters<typeof briefingPrompt>[0]['kind']) =>
    briefingPrompt({ kind, idea: 'a wishlist', brief: EMPTY_BRIEF, messages: [{ from: 'manager', text: 'a wishlist', at: 0 }], resumeSessionId: 's1' });

  it('asks the wrap-up for an Approach section with a mermaid block only when an option was chosen', () => {
    const prompt = turn('wrap-up');
    expect(prompt).toContain('## Approach');
    expect(prompt).toContain('```mermaid');
    expect(prompt).toMatch(/If no option was chosen, leave that section out/);
  });

  it('leaves Approach out of the other turns', () => {
    expect(turn('open')).not.toContain('Approach');
    expect(turn('reply')).not.toContain('Approach');
  });
});

describe('mergeBrief', () => {
  const today = { title: 'Today', mermaid: 'flowchart LR\n  A["Panel"] --> B["Store"]' };
  const option = { title: 'Option A: a cache', mermaid: 'flowchart LR\n  A["Panel"] --> C["Cache"]' };
  const withDiagrams = { ...EMPTY_BRIEF, diagrams: [today] };

  it('replaces the whole list when diagrams are passed', () => {
    expect(mergeBrief(withDiagrams, { diagrams: [option] }).diagrams).toEqual([option]);
  });

  it('keeps the current diagrams when the field is left out', () => {
    expect(mergeBrief(withDiagrams, { summary: 'A wishlist' }).diagrams).toEqual([today]);
  });

  it('trims titles and sources, and drops diagrams with no source', () => {
    const merged = mergeBrief(EMPTY_BRIEF, { diagrams: [{ title: '  Today ', mermaid: `\n${today.mermaid}\n  ` }, { title: 'Option B', mermaid: '   ' }] });
    expect(merged.diagrams).toEqual([today]);
  });

  it('keeps at most four diagrams', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `Option ${i}`, mermaid: 'flowchart LR\n  A --> B' }));
    expect(mergeBrief(EMPTY_BRIEF, { diagrams: many }).diagrams.map((d) => d.title)).toEqual(['Option 0', 'Option 1', 'Option 2', 'Option 3']);
  });

  it('clears the list when passed an empty one', () => {
    expect(mergeBrief(withDiagrams, { diagrams: [] }).diagrams).toEqual([]);
  });
});
