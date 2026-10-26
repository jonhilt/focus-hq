import { describe, expect, it } from 'vitest';
import type { Agent, PullRequest } from '../../plugin-api/shared';
import { mergePress, openPrsOf } from './mergingRules';

const pr = (number: number, more: Partial<PullRequest> = {}): PullRequest => ({
  repo: 'acme/shop', number, title: `PR ${number}`, url: '', branch: 'b', baseBranch: 'main',
  isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '2026-10-01', ...more,
});
const lead = (prs: { repo: string; number: number; outcome?: 'merged' | 'closed' }[]): Pick<Agent, 'projectId' | 'lead'> => ({
  projectId: 'p',
  lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: prs.map((p) => ({ ...p, url: '' })) },
});

describe('the pull requests a lead’s card can merge', () => {
  it('is their open ones, as the board has them', () => {
    const board = [{ projectId: 'p', pr: pr(7) }, { projectId: 'p', pr: pr(8) }, { projectId: 'q', pr: pr(9) }];
    expect(openPrsOf(lead([{ repo: 'acme/shop', number: 7 }, { repo: 'acme/shop', number: 8, outcome: 'merged' }]), board)).toEqual([board[0]]);
  });

  it('leaves out one the board doesn’t show, and another project’s with the same number', () => {
    expect(openPrsOf(lead([{ repo: 'acme/shop', number: 9 }]), [{ projectId: 'q', pr: pr(9) }])).toEqual([]);
  });
});

describe('a card’s merge button', () => {
  it('merges a PR QA passed with one press, the merge check guarding it', () => {
    expect(mergePress({ kind: 'merge' }, pr(7), 'squash')).toEqual({ label: 'squash & merge shop#7', title: expect.any(String), does: { merge: { override: false } }, act: 'merge' });
  });

  it('asks first when QA hasn’t passed its head, saying why', () => {
    const press = mergePress({ kind: 'merge', confirm: 'QA failed it' }, pr(7), 'squash');
    expect(press.does).toEqual({ merge: { override: false, confirm: expect.stringMatching(/^QA failed it\.\n\nMerge shop#7 “PR 7” anyway\?$/) } });
  });

  it('merges past a refused check only on purpose', () => {
    const press = mergePress({ kind: 'merge', confirm: 'Its merge check refused it', override: true }, pr(7), 'squash');
    expect(press.label).toBe('Merge shop#7 anyway');
    expect(press.does).toEqual({ merge: { override: true, confirm: expect.any(String) } });
  });

  it('merges once QA passes while QA is testing it, and cancels that', () => {
    expect(mergePress({ kind: 'when-passed' }, pr(7), 'squash').does).toEqual({ whenPassed: true });
    expect(mergePress({ kind: 'requested' }, pr(7), 'squash').does).toEqual({ whenPassed: false });
  });

  it('does nothing while its merge is queued or checking, or while it’s a draft or conflicts', () => {
    expect(mergePress({ kind: 'queued', behind: 6 }, pr(7), 'squash')).toEqual({ label: 'shop#7 queued behind #6', title: expect.any(String) });
    expect(mergePress({ kind: 'checking' }, pr(7), 'squash').does).toBeUndefined();
    expect(mergePress({ kind: 'merge' }, pr(7, { isDraft: true }), 'squash')).toEqual({ label: 'squash & merge shop#7', title: 'It’s a draft' });
    expect(mergePress({ kind: 'when-passed' }, pr(7, { mergeable: 'CONFLICTING' }), 'squash').does).toBeUndefined();
  });
});
