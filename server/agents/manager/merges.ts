import { Effect } from 'effect';
import type { Closer, LedgerEntry } from '../../../shared/ledger';
import { gateStep, type MergeHeads, mergeCheckOn, type MergeTrial, mergeVerdict, refusalComment, trialOutcome } from '../../../shared/mergeCheckRules';
import { checkMergesFor } from '../../../shared/mergeGateRules';
import { prKey } from '../../../shared/qa';
import type { MergeCheck, MergeMethod, PullRequest } from '../../../shared/types';
import { GitHub } from '../../github/service';
import { errorMessage, KeyedLock } from '../../util';
import { Workspace } from '../services';
import { Part, Refused } from './core';

/** How a merge goes: GitHub's method, who asked, the commit they mean (`want`), and whether the captain merges past the check. */
export interface MergeHow {
  method: MergeMethod;
  by: Closer;
  want?: string;
  override?: boolean;
}

export type MergeTarget = Pick<PullRequest, 'repo' | 'number' | 'baseBranch' | 'headSha'>;

type CheckFields = Pick<Extract<LedgerEntry, { kind: 'merge-check' }>, 'outcome' | 'base' | 'head' | 'failed'>;

/**
 * Every merge Ops makes (docs/merging.md): the merge check first (the PR's head merged onto its base as it is
 * now, and the repo's checks run on it), then GitHub's merge of exactly the commit it checked. One merge at a time in
 * each repo, so the next one is checked against a base that has the last one in it. A trial is kept by its base and
 * head, so trying again runs nothing until one of them moves. A project with the check switched off (`checkMerges`)
 * skips all of that: its merges go straight to GitHub, at the head the caller means.
 */
export class Merges extends Part {
  /** Each PR's last trial (by prKey). */
  private trials = new Map<string, MergeTrial>();
  /** Where each PR's merge check stands (by prKey), for its card on the board. */
  private checks = new Map<string, MergeCheck>();
  private inFlight = new Map<string, Promise<string>>();
  private repoLock = new KeyedLock();
  /** The PRs merging or waiting to in each repo (by repo), in turn: the first holds the lock. */
  private lines = new Map<string, number[]>();

  /** Merges the PR once its merge check passes (or the captain merges past it), and returns the commit merged. Rejects with why it didn't. */
  merge(projectId: string, pr: MergeTarget, how: MergeHow): Promise<string> {
    const key = prKey(pr.repo, pr.number);
    const going = this.inFlight.get(key);
    if (going) {
      if (how.override) return Promise.reject(new Refused({ message: `Ops is still checking its merge` }));
      return going;
    }
    if (!checkMergesFor(this.store.projects.find((p) => p.id === projectId))) return this.track(key, this.mergeUnchecked(projectId, pr, how));
    const ahead = this.join(pr);
    if (ahead !== undefined) this.queue(projectId, pr, how, ahead);
    return this.track(key, this.repoLock.with(pr.repo, () => this.gateAndMerge(projectId, pr, how)).finally(() => this.leave(pr)));
  }

  /** Keeps the PR's merge as the one under way until it's done, so asking again meanwhile gets the same merge. */
  private track(key: string, merging: Promise<string>): Promise<string> {
    const job = merging.finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  /** A merge with the project's check off: no line, no trial, just GitHub's merge of the head the caller means, noted in the ledger. */
  private mergeUnchecked(projectId: string, pr: MergeTarget, how: MergeHow): Promise<string> {
    const head = how.want ?? pr.headSha ?? '';
    this.record(projectId, pr, how, { outcome: 'unchecked', ...(head && { head }) });
    return this.land(projectId, pr, how, head || undefined);
  }

  private record(projectId: string, pr: MergeTarget, how: MergeHow, fields: CheckFields): void {
    const goal = this.core.goalPrs.ownerOf(pr.repo, pr.number)?.lead?.title;
    this.core.ledger.record(projectId, { kind: 'merge-check', repo: pr.repo, pr: pr.number, ...(goal && { goal }), by: how.by, ...fields });
  }

  /** Puts the PR at the back of its repo's line, and returns the PR just ahead of it, if any. */
  private join(pr: MergeTarget): number | undefined {
    const line = this.lines.get(pr.repo) ?? [];
    this.lines.set(pr.repo, [...line, pr.number]);
    return line.at(-1);
  }

  private leave(pr: MergeTarget): void {
    const line = (this.lines.get(pr.repo) ?? []).filter((n) => n !== pr.number);
    if (line.length) this.lines.set(pr.repo, line);
    else this.lines.delete(pr.repo);
  }

  /** Shows straight away that the PR waits behind another merge in its repo, rather than nothing until its turn. */
  private queue(projectId: string, pr: MergeTarget, how: MergeHow, behind: number): void {
    this.show(projectId, pr, { state: 'queued', head: how.want ?? pr.headSha ?? '', behind });
    this.hub.toast('info', `⏳ ${pr.repo.split('/')[1]}#${pr.number} is queued behind #${behind}: its merge check starts once that one’s done`, undefined, projectId);
  }

  /** The merge check to show on a PR's card, while it's about the PR's head. */
  checkOf(pr: Pick<PullRequest, 'repo' | 'number' | 'headSha'>): MergeCheck | undefined {
    return mergeCheckOn(pr, this.checks.get(prKey(pr.repo, pr.number)));
  }

  private async gateAndMerge(projectId: string, pr: MergeTarget, how: MergeHow): Promise<string> {
    const record = (fields: CheckFields) => this.record(projectId, pr, how, fields);
    if (how.override) {
      const head = how.want ?? pr.headSha ?? '';
      record({ outcome: 'overridden', ...(head && { head }) });
      this.show(projectId, pr, { state: 'overridden', head });
      return this.land(projectId, pr, how, head || undefined);
    }
    // its turn: off the queue, while Ops fetches what it checks
    if (this.checks.get(prKey(pr.repo, pr.number))?.state === 'queued') this.show(projectId, pr, { state: 'checking', head: how.want ?? pr.headSha ?? '' });
    let heads: MergeHeads;
    try {
      const fetched = await this.runtime.runPromise(Workspace.use((w) => w.mergeHeads(pr.repo, pr.number, pr.baseBranch)));
      // no real clone (the demo): the PR's head as GitHub reports it
      heads = { base: fetched.base, head: fetched.head || pr.headSha || '' };
    } catch (err) {
      return this.refuse(projectId, pr, pr.headSha ?? '', `Ops couldn’t fetch it: ${errorMessage(err)}`);
    }
    const step = gateStep(heads, { want: how.want, cached: this.trials.get(prKey(pr.repo, pr.number)) });
    if (step.kind === 'refuse') return this.refuse(projectId, pr, heads.head, step.reason);
    const trial = step.kind === 'reuse' ? step.trial : await this.tryMerge(projectId, pr, heads);
    if (step.kind === 'try') record({ ...trialOutcome(trial), base: heads.base, head: heads.head });
    const verdict = mergeVerdict(trial);
    if (verdict.kind === 'refuse') {
      if (step.kind === 'try') this.background(GitHub.use((gh) => gh.commentOnPullRequest(pr.repo, pr.number, refusalComment(trial, verdict.reason))).pipe(Effect.ignore));
      return this.refuse(projectId, pr, heads.head, verdict.reason);
    }
    this.show(projectId, pr, { state: 'passed', head: heads.head });
    return this.land(projectId, pr, how, heads.head);
  }

  /** Builds the merge and runs the checks on it, showing it's under way on the PR's card. */
  private async tryMerge(projectId: string, pr: MergeTarget, heads: MergeHeads): Promise<MergeTrial> {
    this.show(projectId, pr, { state: 'checking', head: heads.head });
    this.hub.toast('info', `🚦 Checking ${pr.repo.split('/')[1]}#${pr.number} merged onto ${pr.baseBranch} before it merges`, undefined, projectId);
    const chosen = this.store.projects.find((p) => p.id === projectId)?.mergeChecks;
    const trial = await this.runtime.runPromise(Workspace.use((w) => w.tryMerge(pr.repo, heads, chosen)));
    if (trial.kind !== 'broken') this.trials.set(prKey(pr.repo, pr.number), trial);
    return trial;
  }

  private refuse(projectId: string, pr: MergeTarget, head: string, reason: string): never {
    this.show(projectId, pr, { state: 'refused', head, reason });
    throw new Refused({ message: reason });
  }

  /** GitHub's merge of exactly `head`, and Ops hearing the PR landed. */
  private async land(projectId: string, pr: MergeTarget, how: MergeHow, head: string | undefined): Promise<string> {
    try {
      await this.runtime.runPromise(GitHub.use((gh) => gh.mergePullRequest(pr.repo, pr.number, how.method, head)));
    } catch (err) {
      this.checks.delete(prKey(pr.repo, pr.number));
      this.show(projectId, pr, undefined);
      throw new Refused({ message: `GitHub refused it: ${errorMessage(err)}` });
    }
    const key = prKey(pr.repo, pr.number);
    this.trials.delete(key);
    this.checks.delete(key);
    this.core.seating.prClosed(pr.repo, pr.number, true, how.by, head);
    return head ?? '';
  }

  /** Puts where the PR's merge check stands on its card (nothing: takes it off), and sends the board. */
  private show(projectId: string, pr: MergeTarget, check: MergeCheck | undefined): void {
    const key = prKey(pr.repo, pr.number);
    if (check) this.checks.set(key, check);
    const board = this.store.boards.get(projectId);
    const card = board?.prs.find((p) => p.repo === pr.repo && p.number === pr.number);
    if (!board || !card) return;
    const shown = mergeCheckOn(card, check);
    if (shown) card.mergeCheck = shown;
    else delete card.mergeCheck;
    this.hub.send({ type: 'board', board });
  }
}
