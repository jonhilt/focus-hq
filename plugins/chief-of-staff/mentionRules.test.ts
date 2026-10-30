import { describe, expect, it } from 'vitest';
import type { Agent } from '../../plugin-api/shared';
import { isRecap, MAX_EXHIBIT_MENTIONS, MAX_PR_MENTIONS, mentionsOf, prMentions } from './mentionRules';

type Lead = Pick<NonNullable<Agent['lead']>, 'slice' | 'prs' | 'artifacts'>;
const lead = (l: Partial<Lead> = {}): Lead => ({ slice: 2, prs: [], artifacts: [], ...l });
const pr = (number: number, outcome?: 'merged' | 'closed', more: { repo?: string; branch?: string } = {}) => ({ repo: 'acme/shop', number, url: '', ...(outcome && { outcome }), ...more });
const shown = (id: string, slice: number | undefined, at: number) => ({ id, title: id, at, ...(slice !== undefined && { slice }) });

describe('what a decision mentions', () => {
  it('names a lead’s open pull requests, the exhibits of the slice they’re on newest first, and their open question', () => {
    const l = lead({
      prs: [pr(9), pr(8, 'merged'), pr(10)],
      artifacts: [shown('mockup', 2, 5), shown('old', 1, 9), shown('flow', 2, 7), shown('undated', undefined, 8)],
    });
    expect(mentionsOf('turn', { lead: l, question: { id: 'q2' } })).toEqual([
      { kind: 'pr', id: 'acme/shop#10', repo: 'acme/shop', number: 10 },
      { kind: 'pr', id: 'acme/shop#9', repo: 'acme/shop', number: 9 },
      { kind: 'artifact', id: 'flow' },
      { kind: 'artifact', id: 'mockup' },
      { kind: 'question', id: 'q2' },
    ]);
  });

  it('leaves the recaps out, since the pull request reads its own, and keeps the newest exhibits only', () => {
    const many = Array.from({ length: MAX_EXHIBIT_MENTIONS + 2 }, (_, i) => shown(`x${i}`, 2, i));
    const l = lead({ artifacts: [shown('system-recap-9', 2, 99), ...many] });
    const ids = mentionsOf('wrap-up', { lead: l }).map((m) => m.id);
    expect(ids).toHaveLength(MAX_EXHIBIT_MENTIONS);
    expect(ids[0]).toBe(`x${MAX_EXHIBIT_MENTIONS + 1}`);
    expect(ids).not.toContain('system-recap-9');
  });

  it('names the pull request a QA verdict or a conflict is about, and nothing for a raised hand or an error', () => {
    const about = { pr: { repo: 'acme/api', number: 4 }, lead: lead({ prs: [pr(9)] }) };
    expect(mentionsOf('qa', about)).toEqual([{ kind: 'pr', id: 'acme/api#4', repo: 'acme/api', number: 4 }]);
    expect(mentionsOf('conflicts', about).map((m) => m.id)).toEqual(['acme/api#4']);
    expect(mentionsOf('hand', about)).toEqual([]);
    expect(mentionsOf('error', about)).toEqual([]);
    expect(mentionsOf('qa', {})).toEqual([]);
  });
});

describe('which of a lead’s pull requests a decision mentions', () => {
  type Status = 'passed' | 'failed' | 'testing' | 'error';
  const qa = (statuses: Record<number, Status>) => (p: { number: number }) => (statuses[p.number] ? { status: statuses[p.number] } : undefined);
  const numbers = (ms: readonly { id: string }[]) => ms.map((m) => Number(m.id.split('#')[1]));

  it('names a few at most: QA passed first, then under way or untested, then failed, newest first within each', () => {
    const prs = [pr(1), pr(2), pr(3), pr(4), pr(5)];
    expect(numbers(prMentions(prs, qa({ 1: 'failed', 2: 'passed', 3: 'testing', 5: 'error' })))).toEqual([2, 4, 3]);
    expect(MAX_PR_MENTIONS).toBe(3);
  });

  it('puts the pull request the decision names first, by repo#n, its short name or #n alone', () => {
    const prs = [pr(7, undefined, { repo: 'acme/api' }), pr(9), pr(11)];
    const passed = qa({ 9: 'passed', 11: 'passed', 7: 'failed' });
    expect(numbers(prMentions(prs, passed, 'Merge acme/api#7?'))[0]).toBe(7);
    expect(numbers(prMentions(prs, passed, 'Merge api#7 first'))[0]).toBe(7);
    expect(numbers(prMentions(prs, passed, 'Shall #9 go in?'))[0]).toBe(9);
    // #70 isn't #7, and another repo's #7 isn't this one
    expect(numbers(prMentions(prs, passed, 'Merge #70 or other/thing#7?'))[0]).toBe(11);
  });

  it('leaves out an earlier attempt a newer open pull request on the same repo and branch took the place of', () => {
    const prs = [pr(9, undefined, { branch: 'focus/save' }), pr(11, undefined, { branch: 'focus/save' }), pr(12, undefined, { branch: 'focus/other' }), pr(3)];
    expect(numbers(prMentions(prs, qa({ 9: 'passed' })))).toEqual([12, 11, 3]);
    // a merged one doesn't count as the newer one
    expect(numbers(prMentions([pr(9, undefined, { branch: 'b' }), pr(11, 'merged', { branch: 'b' })], qa({})))).toEqual([9]);
  });

  it('reads them so from a lead’s turn, given QA’s word and the decision’s words', () => {
    const l = lead({ prs: [pr(1), pr(2), pr(3), pr(4)] });
    const ms = mentionsOf('turn', { lead: l, reviews: qa({ 4: 'failed', 1: 'passed' }), words: 'Merge #3?' });
    expect(numbers(ms)).toEqual([3, 1, 2]);
  });

  it('knows a recap by its id, with or without its pull request’s number', () => {
    expect(isRecap('system-recap')).toBe(true);
    expect(isRecap('system-recap-11')).toBe(true);
    expect(isRecap('system-recaps')).toBe(false);
    expect(isRecap('mockup')).toBe(false);
  });
});

