import { Effect } from 'effect';
import { autoQaFor, prKey } from '../../../shared/qa';
import type { Agent, ConflictsOutcome, PullRequest } from '../../../shared/types';
import { errorMessage, newId } from '../../util';
import { conflictsAgentModel, conflictsRecord } from '../conflicts';
import { conflictsResolvedNote, fixPushedNote } from '../lead';
import { conflictsPrompt } from '../prompts';
import { Workspace } from '../services';
import { type BaseMerge } from '../types';
import { FINISHED, Part, Refused } from './core';

/** Resolving a pull request's merge conflicts: Ops' own merge of its base, or an agent seated on it. */
export class Conflicts extends Part {
  /** The pull requests (prKey) Ops is merging its base branch into right now. */
  private merging = new Set<string>();

  /**
   * Gets a pull request's merge conflicts resolved without interrupting anyone. Ops first merges the base branch
   * in itself, and pushes it when git needs no help (or the repo's rules settle every conflicted file) and it
   * type-checks. Otherwise the developer who opened the PR takes it, if they're still aboard; for anyone else's,
   * a goal's slice included, a new agent sits down on the PR's branch in a worktree of their own. A goal's lead hears
   * about it as a note, with the next message they get.
   */
  async resolveConflicts(projectId: string, pr: PullRequest): Promise<ConflictsOutcome> {
    const resolving = [...this.store.agents.values()].find((a) => a.task === 'conflicts' && a.repo === pr.repo && a.pr?.number === pr.number && !FINISHED.includes(a.status));
    if (resolving) throw new Refused({ message: `${resolving.name} is already resolving the conflicts on #${pr.number}` });
    const lead = this.core.goalPrs.ownerOf(pr.repo, pr.number);
    const owner = lead ? undefined : this.core.seating.prOwner(pr.repo, pr.number);
    const merge = await this.mergeBase(pr);
    if (merge.kind === 'up-to-date') return merge;
    this.core.ledger.record(projectId, { kind: 'conflicts', repo: pr.repo, pr: pr.number, goal: lead?.lead?.title, ...conflictsRecord(merge) });
    if (merge.kind === 'merged') {
      if (lead) this.pushedForLead(lead, pr, merge.sha, 'Ops');
      else if (owner) await this.runtime.runPromise(this.catchUp(owner, merge));
      this.verdictCatchesUp(projectId, pr, merge.sha);
      return { kind: 'merged', ...(merge.auto ? { auto: merge.auto } : {}) };
    }
    if (owner) {
      this.update(owner, { baseBranch: pr.baseBranch });
      // Ops' news, never the captain's words
      this.core.comms.message(owner.id, conflictsPrompt(owner), 'Ops');
      return { kind: 'agent', agent: owner };
    }
    const agent = this.core.seating.seat(projectId, pr.repo, {
      id: newId('agent'),
      task: 'conflicts',
      issue: { number: pr.number, title: pr.title, url: pr.url },
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      pr: { number: pr.number, url: pr.url },
      ...conflictsAgentModel(this.store.settings),
    });
    return { kind: 'agent', agent };
  }

  /**
   * Ops' merge of the base left QA's verdict on the commit before it: back to QA, who carry a pass over a clean
   * merge with the project's checks alone (`precheck`), so the PR doesn't wait for the captain at an older commit.
   */
  private verdictCatchesUp(projectId: string, pr: PullRequest, sha: string): void {
    const review = this.store.reviews.get(prKey(pr.repo, pr.number));
    if (!review || !autoQaFor(this.store.project(projectId))) return;
    try {
      this.core.reviews.requestReview(projectId, pr.repo, pr.number, pr.title, undefined, false, sha);
    } catch (err) {
      console.warn(`Couldn't hand ${pr.repo}#${pr.number} back to QA after merging ${pr.baseBranch} in: ${errorMessage(err)}`);
    }
  }

  /** Ops' own merge of the PR's base branch into it. One that fails for any reason other than conflicts goes to an agent too. */
  private async mergeBase(pr: PullRequest): Promise<BaseMerge> {
    const key = prKey(pr.repo, pr.number);
    if (this.merging.has(key)) throw new Refused({ message: `Ops is already merging ${pr.baseBranch} into #${pr.number}` });
    this.merging.add(key);
    const merge = Workspace.use((w) => w.mergeBase(pr.repo, pr.branch, pr.baseBranch)).pipe(
      Effect.catch((err) => Effect.sync((): BaseMerge => {
        console.warn(`Couldn't merge ${pr.baseBranch} into ${pr.repo}#${pr.number} on Ops' side: ${err.message}`);
        return { kind: 'conflicts', files: [] };
      })),
    );
    return this.runtime.runPromise(merge).finally(() => this.merging.delete(key));
  }

  /**
   * Ops merged the base into a finished developer's PR: their worktree, which still has the PR's old head and
   * nothing else, moves up to the merge, so their next push doesn't undo it.
   */
  private catchUp(owner: Agent, merge: { from: string }): Effect.Effect<void, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      if (owner.cloud || !FINISHED.includes(owner.status)) return;
      const workspace = yield* Workspace;
      const dir = workspace.dir(owner.id);
      if ((yield* workspace.hasUncommittedChanges(dir)) || (yield* workspace.head(dir)) !== merge.from) return;
      yield* workspace.pull(dir, owner.branch);
    }).pipe(Effect.ignore);
  }

  /**
   * Ops pushed a merge (or a fix for what QA found, by `who`) to one of a lead's pull requests: the slice records the
   * PR's new head, and the lead hears to pull it before touching that repo again, as a note with the next message they get.
   */
  pushedForLead(lead: Agent, pr: Pick<PullRequest, 'repo' | 'number' | 'baseBranch' | 'branch'>, sha: string, who: string, what: 'merge' | 'fix' = 'merge'): void {
    const work = lead.lead;
    if (!work) return;
    const folder = work.repos.find((r) => r.repo === pr.repo)?.folder ?? pr.repo.split('/')[1];
    const prs = work.prs.map((p) => (p.repo === pr.repo && p.number === pr.number ? { ...p, sha } : p));
    this.update(lead, { lead: { ...work, prs } });
    this.core.leads.noteForLead(lead, 'Ops', what === 'fix' ? fixPushedNote(pr, folder, who, sha) : conflictsResolvedNote(pr, folder, who));
  }
}
