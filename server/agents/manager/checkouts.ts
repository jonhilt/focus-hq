import { Effect } from 'effect';
import type { LeadAgent } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { leadWorktreeId, reposBackNote } from '../lead';
import { repoFolders } from '../planner';
import { type GitFailed, Workspace } from '../services';
import { NothingToCheckOut, Part } from './core';

/** A goal's checkouts: every repo of the project side by side, checked out as the goal starts, and again when they're missing. */
export class Checkouts extends Part {
  /** Worktrees of `repos` on the lead's current branch, each from its repo's default branch, recorded on the lead. */
  checkOut(agent: LeadAgent, repos: string[]): Effect.Effect<void, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const checkouts: LeadAgent['lead']['repos'] = [];
      for (const [repo, folder] of repoFolders(repos)) {
        const info = yield* github.repoInfo(repo);
        if (info.isEmpty) {
          this.print(agent, [{ kind: 'system', text: `✻ Skipping ${repo}: it has no commits yet` }]);
          continue;
        }
        this.update(agent, { activity: `Checking out ${repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${repo} at ./${folder} on ${agent.branch}` }]);
        yield* workspace.create(repo, leadWorktreeId(agent.id, folder), agent.branch, info.defaultBranch, (id) => this.store.agents.has(id));
        yield* this.install(agent, workspace.dir(leadWorktreeId(agent.id, folder)));
        checkouts.push({ repo, folder, baseBranch: info.defaultBranch });
      }
      if (!checkouts.length) return yield* new NothingToCheckOut();
      this.update(agent, { lead: { ...agent.lead, repos: checkouts }, baseBranch: checkouts[0].baseBranch });
    });
  }

  /**
   * Where the lead's repos stand before their turn, and what they hear about it first (nothing, when nothing moved): a
   * lead left with no repos (a checkout that failed, or a move to fresh code from before leads opened their own pull
   * requests) has them checked out again.
   */
  beforeTurn(lead: LeadAgent): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return lead.lead.repos.length ? Effect.succeed('') : this.reposBack(lead);
  }

  /** A lead left with no repos (a checkout that failed): every repo checked out again on their branch. Succeeds with what they hear. */
  reposBack(agent: LeadAgent): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      this.print(agent, [{ kind: 'system', text: '✻ No repos are checked out (the last checkout didn’t finish): checking them out again' }]);
      yield* this.checkOut(agent, this.store.project(agent.projectId).repos);
      return reposBackNote(agent.lead, agent.branch);
    });
  }

}
