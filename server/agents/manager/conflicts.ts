import { Effect } from 'effect';
import { prKey } from '../../../shared/qa';
import type { Agent, ConflictsOutcome, PullRequest } from '../../../shared/types';
import { newId } from '../../util';
import { conflictsAgentModel } from '../conflicts';
import { conflictsResolvedNote } from '../lead';
import { conflictsPrompt } from '../prompts';
import { Workspace } from '../services';
import { type BaseMerge } from '../types';
import { FINISHED, Part, Refused } from './core';

/** Resolving a pull request's merge conflicts: the office's own merge of its base, or an agent seated on it. */
export class Conflicts extends Part {
  /** The pull requests (prKey) the office is merging its base branch into right now. */
  private merging = new Set<string>();

  /**
   * Gets a pull request's merge conflicts resolved without interrupting anyone. The office first merges the base branch
   * in itself, and pushes it when git needs no help. Otherwise the developer who opened the PR takes it, if they're still
   * in the office; for anyone else's, a goal's slice included, a new agent sits down on the PR's branch in a worktree of
   * their own. A goal's lead hears about it once their turn is over.
   */
  async resolveConflicts(projectId: string, pr: PullRequest): Promise<ConflictsOutcome> {
    const resolving = [...this.store.agents.values()].find((a) => a.task === 'conflicts' && a.repo === pr.repo && a.pr?.number === pr.number && !FINISHED.includes(a.status));
    if (resolving) throw new Refused({ message: `${resolving.name} is already resolving the conflicts on #${pr.number}` });
    const lead = this.core.leads.leadWith(pr.repo, pr.number);
    const owner = lead ? undefined : this.core.seating.prOwner(pr.repo, pr.number);
    const merge = await this.mergeBase(pr);
    if (merge.kind === 'up-to-date') return merge;
    this.core.ledger.record(projectId, { kind: 'conflicts', repo: pr.repo, pr: pr.number, goal: lead?.lead?.title, resolved: merge.kind === 'merged' ? 'office' : 'agent' });
    if (merge.kind === 'merged') {
      if (lead) this.mergedForLead(lead, pr, merge.sha, 'the office');
      else if (owner) await this.runtime.runPromise(this.catchUp(owner, merge));
      return { kind: 'merged' };
    }
    if (owner) {
      this.update(owner, { baseBranch: pr.baseBranch });
      this.core.comms.message(owner.id, conflictsPrompt(owner));
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

  /** The office's own merge of the PR's base branch into it. One that fails for any reason other than conflicts goes to an agent too. */
  private async mergeBase(pr: PullRequest): Promise<BaseMerge> {
    const key = prKey(pr.repo, pr.number);
    if (this.merging.has(key)) throw new Refused({ message: `The office is already merging ${pr.baseBranch} into #${pr.number}` });
    this.merging.add(key);
    const merge = Workspace.use((w) => w.mergeBase(pr.repo, pr.branch, pr.baseBranch)).pipe(
      Effect.catch((err) => Effect.sync((): BaseMerge => {
        console.warn(`Couldn't merge ${pr.baseBranch} into ${pr.repo}#${pr.number} on the office's side: ${err.message}`);
        return { kind: 'conflicts' };
      })),
    );
    return this.runtime.runPromise(merge).finally(() => this.merging.delete(key));
  }

  /**
   * The office merged the base into a finished developer's PR: their worktree, which still has the PR's old head and
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
   * The office pushed a merge to one of a lead's pull requests: the slice records the PR's new head, and the lead hears
   * to pull it before touching that repo again, once their turn is over.
   */
  mergedForLead(lead: Agent, pr: Pick<PullRequest, 'repo' | 'number' | 'baseBranch' | 'branch'>, sha: string, who: string): void {
    const work = lead.lead;
    if (!work) return;
    const folder = work.repos.find((r) => r.repo === pr.repo)?.folder ?? pr.repo.split('/')[1];
    const prs = work.prs.map((p) => (p.repo === pr.repo && p.number === pr.number ? { ...p, sha } : p));
    this.update(lead, { lead: { ...work, prs } });
    this.core.leads.noteForLead(lead, 'Office', conflictsResolvedNote(pr, folder, who));
  }
}
