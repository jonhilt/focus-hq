import { Effect } from 'effect';
import { autoQaFor, sameCommit } from '../../../shared/qa';
import type { Agent } from '../../../shared/types';
import { GitHub } from '../../github/service';
import { errorMessage } from '../../util';
import { afterCloudRun } from '../cloud';
import { COMMIT_NUDGE, pullRequestBody, pushNudge } from '../prompts';
import { Workspace } from '../services';
import { type ManagerServices, Part, Refused, type WorkError } from './core';

/** A developer's work onto GitHub once their session ends: the commit nudge, the push, and their pull request. */
export class Delivery extends Part {
  /** Pushes the branch and opens (or updates) the pull request. Then the agent hears anything the manager said meanwhile. */
  deliver(agent: Agent, summary: string): Effect.Effect<void, never, ManagerServices> {
    const rt = this.rt(agent.id);
    return Effect.gen({ self: this }, function* () {
      rt.busy = true;
      yield* this.ship(agent, summary).pipe(
        this.orFail(agent),
        Effect.ensuring(Effect.sync(() => {
          rt.busy = false;
          this.core.seating.schedule();
        })),
      );
      if (rt.inbox.length && this.store.agents.has(agent.id) && agent.status === 'done' && agent.sessionId) {
        yield* this.core.sessions.runSession(agent, rt.inbox.splice(0).join('\n\n'), agent.sessionId).pipe(this.orFail(agent));
      }
    });
  }

  /** The agent's work, onto GitHub: they're asked once to commit (or, in the cloud, push) what they left behind. */
  private ship(agent: Agent, summary: string): Effect.Effect<void, WorkError, ManagerServices> {
    const rt = this.rt(agent.id);
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const dir = workspace.dir(agent.id);
      if (agent.cloud) {
        // a cloud agent pushed its work to GitHub: bring it into the worktree, where the checks below look
        const before = yield* workspace.head(dir);
        this.update(agent, { activity: `Fetching ${agent.branch} from GitHub` });
        yield* workspace.pull(dir, agent.branch);
        if (afterCloudRun({ before, after: yield* workspace.head(dir), nudged: rt.nudged }) === 'nudge') {
          rt.nudged = true;
          this.print(agent, [{ kind: 'system', text: `✻ Nothing new on ${agent.branch} – asking the agent to push their work` }]);
          return yield* this.core.sessions.runSession(agent, pushNudge(agent), agent.sessionId);
        }
      } else if (!rt.nudged && (yield* workspace.hasUncommittedChanges(dir))) {
        rt.nudged = true;
        this.print(agent, [{ kind: 'system', text: '✻ Uncommitted changes left behind – asking the agent to commit them' }]);
        return yield* this.core.sessions.runSession(agent, COMMIT_NUDGE, agent.sessionId);
      }
      const fixing = this.core.reviews.fixing(agent);
      if (fixing?.sha && sameCommit(yield* workspace.head(dir), fixing.sha)) {
        this.update(agent, { status: 'done', activity: 'Finished without fixing anything – see the terminal', finishedAt: Date.now() });
        this.core.reviews.fixEnded(agent, 'pushed-nothing');
        return;
      }
      const ahead = yield* workspace.commitsAhead(dir, agent.baseBranch);
      if (ahead === 0) {
        this.update(agent, { status: 'done', activity: 'Finished without committing changes – see the terminal', finishedAt: Date.now() });
        this.hub.toast('info', `${agent.name} finished #${agent.issue.number} without code changes`, agent.id);
        return;
      }
      if (agent.cloud) {
        this.print(agent, [{ kind: 'system', text: `✻ ${ahead} commit${ahead === 1 ? '' : 's'} on ${agent.branch}, pushed from the cloud session` }]);
      } else {
        // the push is forced, and every worktree of the repo shares its remote-tracking refs, so the lease alone wouldn't stop it
        if (yield* workspace.missingRemoteCommits(dir, agent.branch)) {
          return yield* new Refused({ message: `Someone else pushed to ${agent.branch} meanwhile: merge it in with \`git pull --no-rebase origin ${agent.branch}\` before this can ship` });
        }
        this.update(agent, { status: 'pushing', activity: `Pushing ${ahead} commit${ahead === 1 ? '' : 's'}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${agent.branch}` }]);
        yield* this.retrying(agent, 'the push', workspace.push(dir, agent.branch));
      }

      let pr = agent.pr ?? (yield* this.retrying(agent, 'looking for the pull request', github.findPullRequest(agent.repo, agent.branch)));
      if (pr) {
        this.hub.toast('success', `${agent.name} updated PR #${pr.number}`, agent.id);
      } else {
        this.update(agent, { activity: 'Opening the pull request' });
        // a plugin's brief names its own pull request, from the write-up
        const brief = agent.task === 'brief' ? this.core.plugins.brief(agent.brief) : undefined;
        const { title, body } = brief ? brief.pullRequest(summary) : { title: agent.issue.title, body: summary };
        if (title !== agent.issue.title) this.update(agent, { issue: { ...agent.issue, title } });
        pr = yield* this.retrying(agent, 'opening the pull request', github.createPullRequest(agent.repo, {
          head: agent.branch,
          base: agent.baseBranch,
          title,
          body: pullRequestBody(agent, body, this.store.settings.attribution),
        }));
        this.hub.toast('success', `🎉 ${agent.name} opened PR #${pr.number}: ${agent.issue.title}`, agent.id);
      }
      this.print(agent, [{ kind: 'success', text: `✔ Pull request ready: ${pr.url}` }]);
      this.update(agent, { status: 'done', pr, activity: `PR #${pr.number} is ready for review`, finishedAt: Date.now() });
      if (agent.task === 'brief') this.core.plugins.prOpened(agent, pr);
      const lead = agent.task === 'conflicts' ? this.core.leads.leadWith(agent.repo, pr.number) : undefined;
      if (lead) this.core.conflicts.mergedForLead(lead, { repo: agent.repo, number: pr.number, baseBranch: agent.baseBranch, branch: agent.branch }, yield* workspace.head(dir), agent.name);
      this.boardChanged(agent.projectId);
      this.core.reviews.fixEnded(agent, 'pushed');
      // new code on the PR: the room's QA officer tests it
      const project = this.store.projects.find((p) => p.id === agent.projectId);
      if (project && autoQaFor(project)) {
        try {
          this.core.reviews.requestReview(agent.projectId, agent.repo, pr.number, agent.issue.title);
        } catch (err) {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand PR #${pr.number} to QA: ${errorMessage(err)}` }]);
        }
      }
    });
  }
}
