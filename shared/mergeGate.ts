import type { Lane } from './mergeLane';
import { prKey, qaBadge, sameCommit } from './qa';
import type { Board, ConflictsOutcome, FailedCheck, MergeMethod, PullRequest, QaReview } from './types';

// When a pull request may merge, and what Ops does next with one that can't yet. Pure, so it's unit tested
// (shared/mergeGate.test.ts); focus.ts follows the steps on each board refresh: for a goal's lead's PRs by their lane,
// on every project; for the rest while the project has auto-merge on.

/** What the merge gate already did about a PR's head commit, so a board refresh doesn't do it again. */
export type GateMark = { sha: string } & ({ kind: 'rerun' } | { kind: 'sent-back' } | { kind: 'resolving' } | { kind: 'refused'; reason: string });

export type MergeStep =
  /** QA passed `sha`, the PR's head; merge exactly that commit. */
  | { kind: 'merge'; sha: string }
  /** Something is under way (checks, QA, a developer): look again next refresh. */
  | { kind: 'wait'; reason: string }
  /** QA hasn't passed the head commit yet. */
  | { kind: 'qa'; reason: string }
  | { kind: 'rerun-checks'; sha: string; runIds: number[] }
  /** Checks still fail after a re-run: back to the developer with the failing checks. */
  | { kind: 'send-back'; sha: string; checks: FailedCheck[] }
  | { kind: 'resolve-conflicts'; sha: string }
  /** Ops won't take it further by itself; the manager can still merge it from the board. */
  | { kind: 'blocked'; reason: string };

/** What Ops knows about a PR beyond GitHub and QA. */
export interface GateOps {
  /** One of our agents opened it. Teammates' PRs never merge by themselves. */
  openedByOffice: boolean;
  /** A goal's lead shipped it, in this lane: Ship and Show merge by themselves, Ask waits (docs/merging.md#lanes-how-a-goals-leads-slice-merges). */
  lane?: Lane;
  /** One of our agents is working on it right now (fixing it, resolving its conflicts). */
  developerBusy: boolean;
  /** The project sends failed PRs back to a developer. */
  autoSendBack: boolean;
  /** Only the captain merges it, whatever QA says: a plugin claimed it (`captainMerges`, docs/plugins.md), like main engineering's climbs. */
  captainMerges?: boolean;
  /** Why a plugin holds it back for now (`mergeHeld`): it's still deciding something about it. */
  held?: string;
  mark?: GateMark;
}

type GatePr = Pick<PullRequest, 'headSha' | 'isDraft' | 'mergeable' | 'checks' | 'failedChecks'>;

export function mergeStep(pr: GatePr, review: QaReview | undefined, ops: GateOps): MergeStep {
  const held = heldBack(pr, ops);
  if (held) return held;
  const head = pr.headSha;
  if (!head) return { kind: 'blocked', reason: 'GitHub didn’t say which commit it’s at' };
  if (ops.developerBusy) return { kind: 'wait', reason: 'a developer is working on it' };
  const mark = ops.mark && sameCommit(ops.mark.sha, head) ? ops.mark : undefined;
  if (pr.mergeable === 'CONFLICTING') {
    return mark?.kind === 'resolving' ? { kind: 'blocked', reason: 'it still conflicts after resolving' } : { kind: 'resolve-conflicts', sha: head };
  }
  const step = qaStep(review, head) ?? checksStep(pr, head, mark, ops);
  // a lead fixes their own slice's checks: no developer sits down on it
  return ops.lane && step.kind === 'send-back' ? { kind: 'blocked', reason: 'checks fail, for its lead to fix' } : step;
}

/** Why Ops leaves the PR alone whatever QA and its checks say: someone else's, a lead's in Ask, the captain's, a plugin's for now, or a draft. */
function heldBack(pr: GatePr, ops: GateOps): MergeStep | undefined {
  if (ops.lane === 'ask') return { kind: 'blocked', reason: 'it’s in Ask, so the captain merges it' };
  if (!ops.lane && !ops.openedByOffice) return { kind: 'blocked', reason: 'a teammate opened it' };
  if (ops.captainMerges) return { kind: 'blocked', reason: 'only the captain merges it' };
  if (ops.held) return { kind: 'wait', reason: ops.held };
  if (pr.isDraft) return { kind: 'blocked', reason: 'it’s a draft' };
  return undefined;
}

/** What QA's review of the PR's head holds it to, or undefined once QA passed this commit with nothing for the captain. */
function qaStep(review: QaReview | undefined, head: string): MergeStep | undefined {
  if (!review) return { kind: 'qa', reason: 'QA hasn’t tested it' };
  switch (review.status) {
    case 'queued':
    case 'testing':
      return { kind: 'wait', reason: 'QA is testing it' };
    case 'error':
      return { kind: 'blocked', reason: 'QA couldn’t finish testing it' };
    case 'failed':
    case 'passed':
      break;
  }
  if (!review.sha) return { kind: 'blocked', reason: 'QA didn’t record which commit it tested' };
  if (!sameCommit(review.sha, head)) return { kind: 'qa', reason: `commits arrived after QA ${review.status} it` };
  if (review.followUp?.kind === 'needs-you') return { kind: 'blocked', reason: review.followUp.reason };
  if (review.status === 'failed') return { kind: 'blocked', reason: 'QA failed it' };
  // QA found problems it couldn't prove: the captain reads its advice before it merges
  if (review.report?.advisory) return { kind: 'blocked', reason: 'QA passed it with advice for the captain to read' };
  return undefined;
}

/** Once QA has passed it: what its checks, and the mark on its head, leave to do before it merges. */
function checksStep(pr: GatePr, head: string, mark: GateMark | undefined, ops: GateOps): MergeStep {
  if (mark?.kind === 'refused') return { kind: 'blocked', reason: `the merge was refused: ${mark.reason}` };
  switch (pr.checks) {
    case 'pending':
      return { kind: 'wait', reason: 'checks are running' };
    case 'failing': {
      const runIds = [...new Set(pr.failedChecks.flatMap((c) => (c.runId ? [c.runId] : [])))];
      if (!mark && runIds.length) return { kind: 'rerun-checks', sha: head, runIds };
      if (mark?.kind === 'sent-back') return { kind: 'blocked', reason: 'checks still fail after it went back to a developer' };
      if (!ops.autoSendBack) return { kind: 'blocked', reason: 'checks fail' };
      return { kind: 'send-back', sha: head, checks: pr.failedChecks };
    }
    case 'passing':
    case 'none':
      break;
  }
  if (pr.mergeable === 'UNKNOWN') return { kind: 'wait', reason: 'GitHub is still working out whether it merges cleanly' };
  return { kind: 'merge', sha: head };
}

/**
 * The gate marks (by prKey) to forget after a board refresh: those of PRs in the project's repos that left the board.
 * A repo GitHub couldn't list this time (named in `board.error`) keeps its marks, so a refused merge isn't tried again.
 */
export function forgottenMarks(keys: Iterable<string>, repos: string[], board: { prs: Pick<PullRequest, 'repo' | 'number'>[]; error?: Board['error'] }): string[] {
  const open = new Set(board.prs.map((p) => prKey(p.repo, p.number)));
  return [...keys].filter((key) => {
    const repo = key.slice(0, key.lastIndexOf('#'));
    return repos.includes(repo) && !board.error?.includes(repo) && !open.has(key);
  });
}

/** The mark a step leaves on the PR's head as Ops takes it, so the next refresh doesn't take it again. */
export function stepMark(step: MergeStep): GateMark | undefined {
  switch (step.kind) {
    case 'rerun-checks':
      return { sha: step.sha, kind: 'rerun' };
    case 'send-back':
      return { sha: step.sha, kind: 'sent-back' };
    case 'resolve-conflicts':
      return { sha: step.sha, kind: 'resolving' };
    default:
      return undefined;
  }
}

/** What Ops tells the captain once it took on a PR's conflicts with its base branch. */
export function conflictsSaid(where: string, base: string, outcome: Exclude<ConflictsOutcome, { kind: 'agent' }> | { kind: 'agent' }): string {
  const said = outcome.kind === 'agent' ? '– resolving them before QA'
    : outcome.kind === 'up-to-date' ? `on GitHub, but it already has everything from ${base}`
    : outcome.auto ? `– Ops merged ${base} in, settling ${outcome.auto.join(', ')} by rule`
    : `– Ops merged ${base} in cleanly`;
  return `🔧 ${where} conflicts with ${base} ${said}`;
}

/** Why merging a PR from the board needs the manager to confirm: QA hasn't passed its current head commit. */
export function unpassedReason(review: QaReview | undefined, pr: Pick<PullRequest, 'headSha'>): string | undefined {
  switch (qaBadge(review, pr).state) {
    case 'passed':
      return undefined;
    case 'none':
      return 'QA hasn’t tested it';
    case 'queued':
    case 'testing':
      return 'QA hasn’t finished testing it';
    case 'error':
      return 'QA couldn’t finish testing it';
    case 'failed':
    case 'fixing':
    case 'triaging':
    case 'needs-you':
      return 'QA failed it';
    case 'stale':
      return `QA ${review?.status} an older commit, not the latest one`;
  }
}

/** Whether PRs Ops opened merge by themselves: off unless the project switched it on. */
export function autoMergeFor(project: { autoMerge?: boolean }): boolean {
  return project.autoMerge === true;
}

/** How a repo's pull requests merge: the project's choice for that repo, or else the Focus-wide setting. */
export function mergeMethodFor(project: { mergeMethods?: Record<string, MergeMethod> } | undefined, repo: string, fallback: MergeMethod): MergeMethod {
  return project?.mergeMethods?.[repo] ?? fallback;
}

/**
 * What the board's merge button does: merge now (asking first when QA hasn't passed it), merge past a merge check that
 * refused it (`override`, asking first), wait while another merge in the repo goes first (`queued`) or while the check
 * runs, or merge once QA passes.
 */
export type MergeAction = { kind: 'merge'; confirm?: string; override?: true } | { kind: 'queued'; behind?: number } | { kind: 'checking' } | { kind: 'when-passed' } | { kind: 'requested' };

export function mergeAction(review: QaReview | undefined, pr: Pick<PullRequest, 'headSha' | 'mergeCheck'>): MergeAction {
  if (pr.mergeCheck?.state === 'queued') return { kind: 'queued', ...(pr.mergeCheck.behind && { behind: pr.mergeCheck.behind }) };
  if (pr.mergeCheck?.state === 'checking') return { kind: 'checking' };
  const state = qaBadge(review, pr).state;
  if (state === 'queued' || state === 'testing') return review?.mergeRequested ? { kind: 'requested' } : { kind: 'when-passed' };
  const unpassed = unpassedReason(review, pr);
  if (pr.mergeCheck?.state === 'refused') {
    const why = `Its merge check refused it: ${pr.mergeCheck.reason ?? 'a check failed'}${unpassed ? `, and ${unpassed}` : ''}`;
    return { kind: 'merge', confirm: `${why}. Merging past the check is noted in the ledger`, override: true };
  }
  return unpassed ? { kind: 'merge', confirm: unpassed } : { kind: 'merge' };
}

export type RequestedStep =
  /** QA passed `sha`, the PR's head: merge exactly that commit. */
  | { kind: 'merge'; sha: string }
  | { kind: 'wait' }
  /** Commits arrived after QA passed it: QA again, and merge once that passes. */
  | { kind: 'qa'; reason: string }
  /** Ops won't merge it after all: forget the request and tell the captain why. */
  | { kind: 'drop'; reason: string };

/** What Ops does next with a merge the captain asked for while QA was testing a PR. */
export function requestedMerge(pr: Pick<PullRequest, 'headSha' | 'isDraft' | 'mergeable' | 'checks'>, review: QaReview): RequestedStep {
  switch (review.status) {
    case 'queued':
    case 'testing':
      return { kind: 'wait' };
    case 'error':
      return { kind: 'drop', reason: 'QA couldn’t finish testing it' };
    case 'failed':
      return { kind: 'drop', reason: 'QA failed it' };
    case 'passed':
      break;
  }
  const head = pr.headSha;
  if (!head || !review.sha) return { kind: 'drop', reason: 'Ops can’t tell which commit QA passed' };
  if (!sameCommit(review.sha, head)) return { kind: 'qa', reason: 'commits arrived after QA passed it' };
  if (pr.isDraft) return { kind: 'drop', reason: 'it’s a draft' };
  if (pr.mergeable === 'CONFLICTING') return { kind: 'drop', reason: 'it conflicts with its base branch' };
  if (pr.mergeable === 'UNKNOWN' || pr.checks === 'pending') return { kind: 'wait' };
  return { kind: 'merge', sha: head };
}

/** What Ops tells the captain once their merge from the board went through: past the check (`override`), or checked. */
export function boardMergeSaid(where: string, base: string, override: boolean): string {
  return override ? `Merged ${where} past its merge check, as you asked` : `Merged ${where}: it checks out merged onto ${base}`;
}

/** What a QA officer says to a message once their PR merged or closed, instead of resuming their session. */
export function goneReply(number: number, gone: 'merged' | 'closed'): string {
  return `PR #${number} was ${gone}; nothing to review`;
}
