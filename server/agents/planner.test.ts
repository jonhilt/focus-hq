import { describe, expect, it } from 'vitest';
import { draftRefusal, draftSchema, readyDraft } from './planner';

describe('draftSchema', () => {
  it('lets the planner flag an idea as too big, optionally', () => {
    const schema = draftSchema(['acme/shop']);
    expect(Object.keys(schema.properties as object)).toContain('tooBig');
    expect(schema.required).toEqual(['repo', 'title', 'body']);
  });
});

describe('draftRefusal', () => {
  const ask = { project: 'Shop', repos: 1, planner: 'Lt. Ops', drafting: false, idea: 'Show stock levels' };
  const revise = { repo: 'acme/shop', title: 'Show stock', body: '…', notes: 'Mention the API too' };

  it('starts a draft with an idea, or a redraft with notes', () => {
    expect(draftRefusal(ask)).toBeUndefined();
    expect(draftRefusal({ ...ask, idea: '', revise })).toBeUndefined();
  });

  it('refuses a project with no repositories, first', () => {
    expect(draftRefusal({ ...ask, repos: 0, drafting: true, idea: '' })).toBe('Shop has no repositories yet');
  });

  it('refuses a second draft while one is under way', () => {
    expect(draftRefusal({ ...ask, drafting: true })).toBe('Lt. Ops is already drafting an issue for Shop');
  });

  it('asks for an idea, or for what to change on a redraft, when only blanks came', () => {
    expect(draftRefusal({ ...ask, idea: '  \n' })).toBe('Tell Lt. Ops what you have in mind');
    expect(draftRefusal({ ...ask, revise: { ...revise, notes: ' ' } })).toBe('Tell Lt. Ops what to change');
  });
});

describe('readyDraft', () => {
  const result = { repo: 'acme/api', title: '  Show stock levels \n', body: '\n## Context\n…  ', costUsd: 0.4 };

  it('keeps the planner’s repo, trimmed, and when it finished', () => {
    expect(readyDraft(result, ['acme/shop', 'acme/api'], 1000)).toEqual({
      status: 'ready',
      activity: 'Draft ready',
      repo: 'acme/api',
      title: 'Show stock levels',
      body: '## Context\n…',
      tooBig: undefined,
      costUsd: 0.4,
      finishedAt: 1000,
    });
  });

  it('falls back to the project’s first repo when the planner’s is no longer one of them', () => {
    expect(readyDraft(result, ['acme/shop', 'acme/web'], 1000).repo).toBe('acme/shop');
  });

  it('flags it too big only for a reason that says something', () => {
    expect(readyDraft({ ...result, tooBig: ' Three features in one ' }, ['acme/api'], 1000).tooBig).toBe('Three features in one');
    expect(readyDraft({ ...result, tooBig: '  ' }, ['acme/api'], 1000).tooBig).toBeUndefined();
  });
});
