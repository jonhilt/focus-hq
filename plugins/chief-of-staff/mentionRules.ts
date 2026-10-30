import type { Agent, Attention, GoalArtifact, PullRequest, QaReview } from '../../plugin-api/shared';
import type { Mention } from './shared';

// What a decision mentions (README.md#the-watch): the things the user may want open beside it to decide, as typed
// references the inbox item carries, so Comms, the phone and a bot draw the same ones rather than each working them
// out. Pure, so it's tested (mentionRules.test.ts).

/** How many of the slice's exhibits a decision mentions at most: the newest. */
export const MAX_EXHIBIT_MENTIONS = 3;

/** How many of the lead's pull requests a decision mentions at most: the ones most worth a look. */
export const MAX_PR_MENTIONS = 3;

/**
 * Whether an artifact is a pull request's system recap, which Ops shows under `system-recap` and its number: the pull
 * request's card reads the recap typed, so it's neither mentioned nor counted among the exhibits.
 */
export const isRecap = (id: string): boolean => id === 'system-recap' || id.startsWith('system-recap-');

type LeadPr = NonNullable<Agent['lead']>['prs'][number];

/** How worth a look a pull request is by QA's word on it: passed, then under way or not tested, then failed. */
function qaRank(review: Pick<QaReview, 'status'> | undefined): number {
  if (review?.status === 'passed') return 0;
  if (review?.status === 'failed' || review?.status === 'error') return 2;
  return 1;
}

/** An open pull request a newer one from the lead on the same repo and branch took the place of: an earlier attempt. */
const superseded = (pr: LeadPr, open: readonly LeadPr[]): boolean =>
  pr.branch !== undefined && open.some((o) => o.repo === pr.repo && o.branch === pr.branch && o.number > pr.number);

/** Whether the decision's words name this pull request: `repo#n`, or `#n` with its repo's short name or none. */
const named = (pr: Pick<LeadPr, 'repo' | 'number'>, words: string): boolean =>
  [...words.matchAll(/([\w./-]*)#(\d+)/g)].some(([, repo, n]) => Number(n) === pr.number && (!repo || repo === pr.repo || repo === pr.repo.split('/')[1]));

/**
 * The lead's open pull requests worth mentioning, `MAX_PR_MENTIONS` at most: an earlier attempt superseded by a newer
 * one left out, then the one the decision names first, then by QA's word (passed, under way or untested, failed),
 * newest first within each.
 */
export function prMentions(prs: readonly LeadPr[], reviews: (pr: LeadPr) => Pick<QaReview, 'status'> | undefined, words = ''): Mention[] {
  const open = prs.filter((p) => !p.outcome);
  const rank = (p: LeadPr) => (named(p, words) ? -1 : qaRank(reviews(p)));
  return open
    .filter((p) => !superseded(p, open))
    .sort((a, b) => rank(a) - rank(b) || b.number - a.number)
    .slice(0, MAX_PR_MENTIONS)
    .map(prMention);
}

export const prMention = (pr: Pick<PullRequest, 'repo' | 'number'>): Extract<Mention, { kind: 'pr' }> =>
  ({ kind: 'pr', id: `${pr.repo}#${pr.number}`, repo: pr.repo, number: pr.number });

/** The slice's exhibits, newest first, `MAX_EXHIBIT_MENTIONS` at most, without the recaps. */
function exhibitMentions(artifacts: readonly Pick<GoalArtifact, 'id' | 'slice' | 'at'>[], slice: number): Mention[] {
  return artifacts
    .filter((x) => x.slice === slice && !isRecap(x.id))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_EXHIBIT_MENTIONS)
    .map((x) => ({ kind: 'artifact', id: x.id }));
}

/**
 * What an item mentions: a pull request's QA verdict or conflict, that pull request; a lead's turn, goal ready to close
 * or question, their open pull requests most worth a look (`prMentions`, by QA's word in `reviews` and what the
 * decision's `words` name), the exhibits of the slice they're on (newest first) and their open question. A raised hand
 * or an error mentions nothing: what's asked is the request or the error itself.
 */
export function mentionsOf(
  kind: Attention['kind'],
  about: {
    pr?: Pick<PullRequest, 'repo' | 'number'>;
    lead?: Pick<NonNullable<Agent['lead']>, 'slice' | 'prs' | 'artifacts'>;
    question?: { id: string };
    reviews?: (pr: Pick<PullRequest, 'repo' | 'number'>) => Pick<QaReview, 'status'> | undefined;
    words?: string;
  },
): Mention[] {
  switch (kind) {
    case 'qa':
    case 'conflicts':
      return about.pr ? [prMention(about.pr)] : [];
    case 'hand':
    case 'error':
      return [];
    case 'turn':
    case 'wrap-up':
    case 'question': {
      const { lead, question } = about;
      const prs = prMentions(lead?.prs ?? [], about.reviews ?? (() => undefined), about.words);
      const exhibits = lead ? exhibitMentions(lead.artifacts ?? [], lead.slice) : [];
      return [...prs, ...exhibits, ...(question ? [{ kind: 'question' as const, id: question.id }] : [])];
    }
  }
}
