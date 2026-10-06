import { describe, expect, it } from 'vitest';
import { dependsOn } from '../../shared/dependencies';
import type { Breakdown } from '../../shared/types';
import { applyEdits, asBreakdown, breakdownSchema, filedBody } from './breakdown';

const repos = ['acme/shop', 'acme/api'];
const sub = (title: string, depends_on: unknown[] = []) => ({ title, body: `## Context\n\n${title}`, depends_on });
const epic = { title: 'Wishlists', body: '## Why\n\nShoppers lose track.' };

describe('asBreakdown', () => {
  it('keys the sub-issues and turns positions into dependencies on earlier ones', () => {
    const b = asBreakdown({ repo: 'acme/api', epic, sub_issues: [sub('API'), sub('Page', [1]), sub('Share', [1, 2])] }, repos);
    expect(b.repo).toBe('acme/api');
    expect(b.subIssues.map((s) => [s.key, s.dependsOn])).toEqual([['s1', []], ['s2', ['s1']], ['s3', ['s1', 's2']]]);
  });

  it('drops dependencies on itself, on later sub-issues and on positions that don’t exist', () => {
    const b = asBreakdown({ repo: 'acme/shop', epic, sub_issues: [sub('API', [1, 2]), sub('Page', [0, 2, 3, 1, 1, 'x'])] }, repos);
    expect(b.subIssues.map((s) => s.dependsOn)).toEqual([[], ['s1']]);
  });

  it('falls back to the first repo, and keeps at most five sub-issues', () => {
    const b = asBreakdown({ repo: 'someone/else', epic, sub_issues: Array.from({ length: 7 }, (_, i) => sub(`Part ${i}`)) }, repos);
    expect(b.repo).toBe('acme/shop');
    expect(b.subIssues).toHaveLength(5);
  });

  it('fails without an epic or with fewer than two sub-issues', () => {
    expect(() => asBreakdown({ repo: 'acme/shop', sub_issues: [sub('A'), sub('B')] }, repos)).toThrow(/epic/);
    expect(() => asBreakdown({ repo: 'acme/shop', epic, sub_issues: [sub('A'), { title: '', body: '' }] }, repos)).toThrow(/1 sub-issue,/);
  });

  it('asks for two to five sub-issues in the schema', () => {
    const items = (breakdownSchema(repos).properties as Record<string, { minItems?: number; maxItems?: number }>).sub_issues;
    expect([items.minItems, items.maxItems]).toEqual([2, 5]);
  });
});

describe('applyEdits', () => {
  const breakdown: Breakdown = {
    repo: 'acme/shop',
    epic: { title: 'Wishlists', body: 'Why' },
    subIssues: [
      { key: 's1', title: 'API', body: 'a', dependsOn: [] },
      { key: 's2', title: 'Page', body: 'b', dependsOn: ['s1'] },
      { key: 's3', title: 'Share', body: 'c', dependsOn: [] },
    ],
  };
  const edits = (keys: string[]) => ({ epic: { title: ' Wishlist ', body: 'Why now' }, subIssues: keys.map((key) => ({ key, title: `${key} edited`, body: 'x' })) });

  it('takes the new titles and bodies, trimmed', () => {
    const next = applyEdits(breakdown, edits(['s1', 's2', 's3']));
    expect(next.epic).toEqual({ title: 'Wishlist', body: 'Why now' });
    expect(next.subIssues.map((s) => s.title)).toEqual(['s1 edited', 's2 edited', 's3 edited']);
  });

  it('drops the sub-issues left out, and any dependency on them', () => {
    const next = applyEdits(breakdown, edits(['s2', 's3']));
    expect(next.subIssues.map((s) => [s.key, s.dependsOn])).toEqual([['s2', []], ['s3', []]]);
  });

  it('ignores sub-issues it doesn’t know, and can’t add any', () => {
    expect(applyEdits(breakdown, edits(['s1', 's9'])).subIssues.map((s) => s.key)).toEqual(['s1']);
  });

  it('leaves anything already filed as it was filed', () => {
    const filed = { ...breakdown, epic: { ...breakdown.epic, number: 40 }, subIssues: [{ ...breakdown.subIssues[0], number: 41 }, ...breakdown.subIssues.slice(1)] };
    const next = applyEdits(filed, edits(['s2']));
    expect(next.epic).toEqual(filed.epic);
    expect(next.subIssues.map((s) => [s.key, s.title, s.dependsOn])).toEqual([['s1', 'API', []], ['s2', 's2 edited', ['s1']]]);
  });

  it('needs a sub-issue and titles', () => {
    expect(() => applyEdits(breakdown, edits([]))).toThrow(/at least one sub-issue/);
    expect(() => applyEdits(breakdown, { ...edits(['s1']), epic: { title: ' ', body: '' } })).toThrow(/epic needs a title/);
  });
});

describe('filedBody', () => {
  it('starts with a Depends on line auto-assign reads, with the real numbers', () => {
    const body = filedBody({ key: 's3', title: 'Share', body: '## Context', dependsOn: ['s1', 's2'] }, new Map([['s1', 41], ['s2', 42]]));
    expect(body).toBe('Depends on #41, #42\n\n## Context');
    expect(dependsOn(body)).toEqual([41, 42]);
  });

  it('is just the body when nothing has to land first', () => {
    expect(filedBody({ key: 's1', title: 'API', body: '## Context', dependsOn: [] }, new Map())).toBe('## Context');
  });
});
