import { Effect } from 'effect';
import { autoQaFor, sameCommit } from '../../../shared/qa';
import type { Agent } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { errorMessage, newId } from '../../util';
import { afterLanding, carriedNote, behindNote, everyPr, heldBack, leadPrBody, leadWorktreeId, newSliceNote, notShipped, openPr, shipped, shippedSha, shipPlan, sliceBranch, type FreshBranch, freshBranchNote, needsFreshBranch, repoBranch } from '../lead';
import { repoFolders } from '../planner';
import { type GitFailed, Workspace } from '../services';
import { type ManagerServices, NothingToCheckOut, Part, Refused } from './core';

/** A goal's slices: checking every repo out side by side, moving on to fresh code when a slice lands, and the lead's ship tool. */
export class Slices extends Part {
  /** Worktrees of `repos` on the lead's current branch, each from its repo's default branch, recorded on the lead. */
  checkOutSlice(agent: Agent, repos: string[]): Effect.Effect<void, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const folders = repoFolders(repos);
      const checkouts: NonNullable<Agent['lead']>['repos'] = [];
      for (const repo of repos) {
        const info = yield* github.repoInfo(repo);
        if (info.isEmpty) {
          this.print(agent, [{ kind: 'system', text: `✻ Skipping ${repo}: it has no commits yet` }]);
          continue;
        }
        const folder = folders.get(repo)!;
        this.update(agent, { activity: `Checking out ${repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${repo} at ./${folder} on ${agent.branch}` }]);
        yield* workspace.create(repo, leadWorktreeId(agent.id, folder), agent.branch, info.defaultBranch, (id) => this.store.agents.has(id));
        checkouts.push({ repo, folder, baseBranch: info.defaultBranch });
      }
      if (!checkouts.length) return yield* new NothingToCheckOut();
      this.update(agent, { lead: { ...agent.lead!, repos: checkouts }, baseBranch: checkouts[0].baseBranch });
    });
  }

  /**
   * The slice has landed: a new branch on fresh code in every repo, unless a repo has uncommitted changes, which are
   * never thrown away. Commits that never shipped come along onto the new branch, or stay on the old one, with the
   * lead told how to bring them over, when they don't apply cleanly. Succeeds with what the lead hears about it.
   */
  nextSlice(agent: Agent, lead: NonNullable<Agent['lead']>): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const project = this.store.project(agent.projectId);
      const dir = (folder: string) => workspace.dir(leadWorktreeId(agent.id, folder));
      const dirty = yield* Effect.filter(lead.repos, (r) => workspace.hasUncommittedChanges(dir(r.folder)));
      if (afterLanding(dirty.map((r) => r.folder)) === 'held-back') return heldBack(lead, dirty.map((r) => r.folder));
      const unshipped = yield* Effect.forEach(lead.repos, (r) =>
        workspace.unshippedCommits(dir(r.folder), r.baseBranch, shippedSha(lead, r.repo)).pipe(Effect.map((commits) => ({ ...r, commits }))),
      );
      const oldBranch = agent.branch;
      const slice = lead.slice + 1;
      yield* Effect.forEach(lead.repos, (r) => workspace.remove(r.repo, leadWorktreeId(agent.id, r.folder)), { discard: true });
      const note = lead.note && { ...lead.note, slice: [] };
      this.update(agent, { branch: sliceBranch(lead.title, slice, newId('s').slice(-4)), lead: { ...lead, note, repos: [], slice, prs: [], landed: everyPr(lead) } });
      yield* this.checkOutSlice(agent, project.repos);
      const carried = yield* Effect.forEach(unshipped.filter((r) => r.commits.length), ({ repo, folder, commits }) =>
        Effect.gen({ self: this }, function* () {
          const now = agent.lead!.repos.find((r) => r.repo === repo);
          if (!now) return { folder, commits, applied: false };
          this.print(agent, [{ kind: 'system', text: `✻ Bringing ${commits.length} unshipped commit${commits.length === 1 ? '' : 's'} over to ./${now.folder}` }]);
          const applied = yield* workspace.cherryPick(dir(now.folder), commits).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
          return { folder: now.folder, commits, applied };
        }),
      );
      return [newSliceNote(agent.lead!, agent.branch), carriedNote(carried, oldBranch)].filter(Boolean).join('\n\n');
    });
  }

  /**
   * The lead's ship tool: pushes every repo with new commits and opens (or updates) its pull request, which QA then
   * reviews. Nothing ships while any repo has uncommitted changes.
   */
  shipLead(agent: Agent, input: { title: string; summary: string }): Effect.Effect<string, GitHubError | GitFailed | Refused, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work?.repos.length) return yield* new Refused({ message: 'There’s nothing checked out to ship' });
      if (this.core.leads.closingGoals.has(agent.id)) return yield* new Refused({ message: 'The captain is closing the goal: nothing ships now' });
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      // a repo whose pull request merged moves to a fresh branch first: its own still carries the merged commits
      const moved = yield* this.freshBranches(agent);
      const movedNotes = moved.map(freshBranchNote);
      if (moved.some((m) => !m.applied)) return `Nothing shipped.\n\n${movedNotes.join('\n\n')}`;
      const states = yield* Effect.forEach(
        agent.lead!.repos,
        (r) =>
          Effect.gen(function* () {
            const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
            const head = yield* workspace.head(dir);
            const changed = !openPr(work, r.repo)?.sha || !sameCommit(head, openPr(work, r.repo)!.sha!);
            return { ...r, dir, head, branch: repoBranch(r, agent.branch), changed, dirty: yield* workspace.hasUncommittedChanges(dir), ahead: yield* workspace.commitsAhead(dir, r.baseBranch) };
          }),
        { concurrency: 'unbounded' },
      );
      // the office may have pushed a merge to the slice's branch (resolving conflicts): never ship over it
      for (const s of states.filter((x) => x.changed && openPr(work, x.repo))) {
        if (yield* workspace.missingRemoteCommits(s.dir, s.branch)) return yield* new Refused({ message: behindNote(s.folder, s.branch) });
      }
      const plan = shipPlan(states);
      if (plan.kind !== 'ship') return [notShipped(plan), ...movedNotes].join('\n\n');
      const project = this.store.project(agent.projectId);
      const title = input.title.trim() || `Slice ${work.slice}`;
      const lines: string[] = [];
      for (const s of states.filter((x) => plan.repos.includes(x.repo))) {
        this.update(agent, { status: 'pushing', activity: `Shipping ${s.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${s.branch} in ${s.repo}` }]);
        yield* this.retrying(agent, `the push in ${s.repo}`, workspace.push(s.dir, s.branch));
        const found = openPr(work, s.repo) ?? (yield* this.retrying(agent, 'looking for the pull request', github.findPullRequest(s.repo, s.branch)));
        let pr: { number: number; url: string };
        if (found) {
          pr = found;
          lines.push(`Updated ${s.repo}#${pr.number}: ${pr.url}`);
        } else {
          const alongside = plan.repos.filter((r) => r !== s.repo);
          const body = leadPrBody(input.summary, agent, alongside, this.store.settings.attribution);
          pr = yield* this.retrying(agent, 'opening the pull request', github.createPullRequest(s.repo, { head: s.branch, base: s.baseBranch, title, body }));
          lines.push(`Opened ${s.repo}#${pr.number}: ${pr.url}`);
          this.hub.toast('success', `🎉 ${agent.name} opened ${s.repo.split('/')[1]}#${pr.number}: ${title}`, agent.id);
        }
        const others = agent.lead!.prs.filter((p) => !(p.repo === s.repo && p.number === pr.number));
        this.update(agent, { lead: { ...agent.lead!, prs: [...others, { repo: s.repo, number: pr.number, url: pr.url, sha: s.head, branch: s.branch }] } });
        this.print(agent, [{ kind: 'success', text: `✔ ${lines.at(-1)}` }]);
        if (autoQaFor(project)) {
          try {
            this.core.reviews.requestReview(agent.projectId, s.repo, pr.number, title);
          } catch (err) {
            this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand ${s.repo}#${pr.number} to QA: ${errorMessage(err)}` }]);
          }
        }
      }
      this.update(agent, { status: 'working', activity: 'Shipped the slice' });
      this.boardChanged(agent.projectId);
      return [shipped(lines), ...movedNotes].join('\n\n');
    });
  }

  /**
   * Moves each of the lead's repos whose pull request merged (`needsFreshBranch`) onto a new branch from its base, with
   * the commits that hadn't shipped cherry-picked onto it. A repo with uncommitted changes stays put: it can't ship yet.
   */
  private freshBranches(agent: Agent): Effect.Effect<FreshBranch[], GitFailed, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const moved: FreshBranch[] = [];
      for (const r of agent.lead!.repos) {
        const work = agent.lead!;
        const from = repoBranch(r, agent.branch);
        if (!needsFreshBranch(work, r.repo, from)) continue;
        const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
        if (yield* workspace.hasUncommittedChanges(dir)) continue;
        const commits = yield* workspace.unshippedCommits(dir, r.baseBranch, shippedSha(work, r.repo));
        const to = sliceBranch(work.title, work.slice, newId('s').slice(-4));
        this.print(agent, [{ kind: 'system', text: `✻ ${r.repo}'s pull request from ${from} has merged: starting ${to} from ${r.baseBranch}` }]);
        yield* workspace.freshBranch(dir, to, r.baseBranch);
        this.update(agent, { lead: { ...agent.lead!, repos: agent.lead!.repos.map((x) => (x.repo === r.repo ? { ...x, branch: to } : x)) } });
        const applied = commits.length ? yield* workspace.cherryPick(dir, commits).pipe(Effect.as(true), Effect.orElseSucceed(() => false)) : true;
        if (commits.length) this.print(agent, [{ kind: 'system', text: applied ? `✻ Brought ${commits.length} unshipped commit${commits.length === 1 ? '' : 's'} over to ${to}` : `✻ The unshipped commits didn't apply cleanly to ${to}: they're still on ${from}` }]);
        moved.push({ folder: r.folder, from, to, baseBranch: r.baseBranch, commits, applied });
      }
      return moved;
    });
  }
}
