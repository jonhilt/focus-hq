import { Context, Data, Effect, Layer, type Scope } from 'effect';
import { errorMessage } from '../util';
import type { TriageDecision, Triager, TriageRequest } from './triage';
import type { SinceVerdict } from './retest';
import type { AgentRunner, AgentSession, BaseMerge, BranchState, ChecksRun, RunHooks, RunRequest, WorkspaceOps } from './types';

// What the agent manager needs from the outside world, as Effect services: git on the agents' checkouts, Claude Code
// sessions, and the operations officer's triage. Each wraps the Promise-based implementation it always had (the live
// one or the demo's), and classifies its failures once, here.

/** A git operation on an agent's checkout failed. Says what git said. */
export class GitFailed extends Data.TaggedError('GitFailed')<{ what: string; reason: string }> {
  override get message() {
    return this.reason;
  }
}

/** The operations officer couldn't finish looking at a stuck pull request. */
export class TriageFailed extends Data.TaggedError('TriageFailed')<{ reason: string }> {
  override get message() {
    return this.reason;
  }
}

/** The agents' checkouts: worktrees of the office's clones, one per agent (a lead's holds one per repo). */
export class Workspace extends Context.Service<Workspace, {
  /** A worktree on `branch` from the remote `startPoint`, reclaiming it from an agent who isn't `inOffice`. */
  create(repo: string, agentId: string, branch: string, startPoint: string, inOffice: (agentId: string) => boolean, local?: string): Effect.Effect<string, GitFailed>;
  /** Never fails: a checkout that won't go is left for the sweep. */
  remove(repo: string, agentId: string): Effect.Effect<void>;
  dir(agentId: string): string;
  hasUncommittedChanges(dir: string): Effect.Effect<boolean, GitFailed>;
  commitsAhead(dir: string, baseBranch: string): Effect.Effect<number, GitFailed>;
  head(dir: string): Effect.Effect<string, GitFailed>;
  unshippedCommits(dir: string, baseBranch: string, shipped?: string): Effect.Effect<string[], GitFailed>;
  cherryPick(dir: string, commits: string[]): Effect.Effect<void, GitFailed>;
  push(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  publish(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  pull(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  checkoutPullRequest(repo: string, agentId: string, number: number): Effect.Effect<string, GitFailed>;
  mergeBase(repo: string, branch: string, baseBranch: string): Effect.Effect<BaseMerge, GitFailed>;
  missingRemoteCommits(dir: string, branch: string): Effect.Effect<boolean, GitFailed>;
  /** A worktree on `branch` as it was left (a closed goal's), from the office's clone or else GitHub, never reset. */
  reopen(repo: string, agentId: string, branch: string, inOffice: (agentId: string) => boolean): Effect.Effect<string, GitFailed>;
  snapshot(dir: string, message: string): Effect.Effect<boolean, GitFailed>;
  branchState(dir: string, branch: string, baseBranch: string): Effect.Effect<BranchState, GitFailed>;
  sinceVerdict(repo: string, number: number, baseBranch: string, sha: string): Effect.Effect<SinceVerdict | null, GitFailed>;
  runChecks(repo: string, number: number, head: string): Effect.Effect<ChecksRun | null, GitFailed>;
}>()('focus/agents/Workspace') {
  /** The workspace on its Promise-based operations: the live git ones, or the demo's pretend ones. */
  static fromOps(ops: WorkspaceOps): Layer.Layer<Workspace> {
    const git = <A>(what: string, run: () => Promise<A>): Effect.Effect<A, GitFailed> =>
      Effect.tryPromise({ try: run, catch: (err) => new GitFailed({ what, reason: errorMessage(err) }) });
    return Layer.succeed(Workspace, Workspace.of({
      create: (repo, agentId, branch, startPoint, inOffice, local) => git(`check out ${branch}`, () => ops.create(repo, agentId, branch, startPoint, inOffice, local)),
      remove: (repo, agentId) => Effect.ignore(git('remove a checkout', () => ops.remove(repo, agentId))),
      dir: (agentId) => ops.dir(agentId),
      hasUncommittedChanges: (dir) => git('look for uncommitted changes', () => ops.hasUncommittedChanges(dir)),
      commitsAhead: (dir, baseBranch) => git('count new commits', () => ops.commitsAhead(dir, baseBranch)),
      head: (dir) => git('read the checked-out commit', () => ops.head(dir)),
      unshippedCommits: (dir, baseBranch, shipped) => git('look for unshipped commits', () => ops.unshippedCommits(dir, baseBranch, shipped)),
      cherryPick: (dir, commits) => git('bring commits over', () => ops.cherryPick(dir, commits)),
      push: (dir, branch) => git(`push ${branch}`, () => ops.push(dir, branch)),
      publish: (dir, branch) => git(`publish ${branch}`, () => ops.publish(dir, branch)),
      pull: (dir, branch) => git(`fetch ${branch}`, () => ops.pull(dir, branch)),
      checkoutPullRequest: (repo, agentId, number) => git(`check out PR #${number}`, () => ops.checkoutPullRequest(repo, agentId, number)),
      mergeBase: (repo, branch, baseBranch) => git(`merge ${baseBranch} into ${branch}`, () => ops.mergeBase(repo, branch, baseBranch)),
      missingRemoteCommits: (dir, branch) => git(`compare with origin's ${branch}`, () => ops.missingRemoteCommits(dir, branch)),
      reopen: (repo, agentId, branch, inOffice) => git(`check out ${branch} again`, () => ops.reopen(repo, agentId, branch, inOffice)),
      snapshot: (dir, message) => git('commit a WIP snapshot', () => ops.snapshot(dir, message)),
      branchState: (dir, branch, baseBranch) => git(`compare with origin's ${branch}`, () => ops.branchState(dir, branch, baseBranch)),
      sinceVerdict: (repo, number, baseBranch, sha) => git(`compare PR #${number} with ${sha.slice(0, 7)}`, () => ops.sinceVerdict(repo, number, baseBranch, sha)),
      runChecks: (repo, number, head) => git(`run the checks on PR #${number}`, () => ops.runChecks(repo, number, head)),
    }));
  }
}

/** Claude Code sessions, one turn at a time. */
export class Sessions extends Context.Service<Sessions, {
  /**
   * Starts a turn of an agent's Claude Code session, held in the scope: closing the scope stops a turn that's still
   * running, so interrupting whoever started it (sending the agent home, say) really stops Claude.
   */
  start(req: RunRequest, hooks: RunHooks): Effect.Effect<AgentSession, never, Scope.Scope>;
}>()('focus/agents/Sessions') {
  /** Sessions on a runner: Claude Code through the Agent SDK, or the demo's scripted agents. */
  static fromRunner(runner: AgentRunner): Layer.Layer<Sessions> {
    return Layer.succeed(Sessions, Sessions.of({
      start: (req, hooks) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const session = runner.start(req, hooks);
            let over = false;
            void session.done.finally(() => (over = true));
            return { session, over: () => over };
          }),
          ({ session, over }) => Effect.sync(() => (over() ? undefined : session.stop())),
        ).pipe(Effect.map(({ session }) => session)),
    }));
  }
}

/** The office couldn't take a picture of an HTML page. */
export class RenderFailed extends Data.TaggedError('RenderFailed')<{ reason: string }> {
  override get message() {
    return this.reason;
  }
}

/** Pictures of the HTML pages a goal's lead puts on their station's screen, for the screen to show. */
export class Renderer extends Context.Service<Renderer, {
  /** A JPEG of the page as a browser shows it. */
  render(html: string): Effect.Effect<Buffer, RenderFailed>;
}>()('focus/agents/Renderer') {
  /** Renders in the agents' shared headless Chromium (`BrowserPool.render`). */
  static fromBrowser(browser: { render(html: string): Promise<Buffer> }): Layer.Layer<Renderer> {
    return Layer.succeed(Renderer, Renderer.of({
      render: (html) => Effect.tryPromise({ try: () => browser.render(html), catch: (err) => new RenderFailed({ reason: errorMessage(err) }) }),
    }));
  }
}

/** The room's operations officer looking at a stuck pull request. */
export class Triage extends Context.Service<Triage, {
  /** Interrupting it stops the officer's session. */
  triage(req: Omit<TriageRequest, 'signal'>, activity: (text: string) => void): Effect.Effect<TriageDecision, TriageFailed>;
}>()('focus/agents/Triage') {
  static fromTriager(triager: Triager): Layer.Layer<Triage> {
    return Layer.succeed(Triage, Triage.of({
      triage: (req, activity) =>
        Effect.tryPromise({ try: (signal) => triager.triage({ ...req, signal }, activity), catch: (err) => new TriageFailed({ reason: errorMessage(err) }) }),
    }));
  }
}
