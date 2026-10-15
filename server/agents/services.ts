import { Context, Data, Effect, Layer, Schedule, type Scope } from 'effect';
import { GhServerError, serverStatus } from '../github/runner';
import { errorMessage } from '../util';
import type { TriageDecision, Triager, TriageRequest } from './triage';
import type { SinceVerdict } from './retest';
import type { StageMoment } from './explainer';
import type { AgentRunner, AgentSession, BaseMerge, BranchState, ChecksRun, CloudTerminalRequest, RunHooks, RunRequest, WorkspaceOps } from './types';

// What the agent manager needs from the outside world, as Effect services: git on the agents' checkouts, Claude Code
// sessions, and the operations officer's triage. Each wraps the Promise-based implementation it always had (the live
// one or the demo's), and classifies its failures once, here.

/** A git operation on an agent's checkout failed. Says what git said, and the 5xx GitHub answered with if that's why. */
export class GitFailed extends Data.TaggedError('GitFailed')<{ what: string; reason: string; serverError?: string }> {
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

/** The office couldn't open a terminal to start a cloud session in. */
export class TerminalFailed extends Data.TaggedError('TerminalFailed')<{ reason: string }> {
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
  /** Installs a checkout's dependencies. Never fails: what went wrong is a note for the agent working there. */
  install(dir: string): Effect.Effect<string | undefined>;
  dir(agentId: string): string;
  hasUncommittedChanges(dir: string): Effect.Effect<boolean, GitFailed>;
  commitsAhead(dir: string, baseBranch: string): Effect.Effect<number, GitFailed>;
  head(dir: string): Effect.Effect<string, GitFailed>;
  unshippedCommits(dir: string, baseBranch: string, shipped?: string): Effect.Effect<string[], GitFailed>;
  /** The files a review's checkout changes against its base; none when git can't say (QA's report then isn't checked against them). */
  changedFiles(dir: string, baseBranch: string): Effect.Effect<string[]>;
  freshBranch(dir: string, branch: string, baseBranch: string): Effect.Effect<void, GitFailed>;
  cherryPick(dir: string, commits: string[]): Effect.Effect<void, GitFailed>;
  push(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  publish(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  pull(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  checkoutPullRequest(repo: string, id: string, number: number): Effect.Effect<string, GitFailed>;
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
      Effect.tryPromise({ try: run, catch: (err) => new GitFailed({ what, reason: errorMessage(err), serverError: serverStatus(errorMessage(err)) }) });
    return Layer.succeed(Workspace, Workspace.of({
      create: (repo, agentId, branch, startPoint, inOffice, local) => git(`check out ${branch}`, () => ops.create(repo, agentId, branch, startPoint, inOffice, local)),
      remove: (repo, agentId) => Effect.ignore(git('remove a checkout', () => ops.remove(repo, agentId))),
      install: (dir) => Effect.promise(() => ops.install(dir)),
      dir: (agentId) => ops.dir(agentId),
      hasUncommittedChanges: (dir) => git('look for uncommitted changes', () => ops.hasUncommittedChanges(dir)),
      commitsAhead: (dir, baseBranch) => git('count new commits', () => ops.commitsAhead(dir, baseBranch)),
      head: (dir) => git('read the checked-out commit', () => ops.head(dir)),
      unshippedCommits: (dir, baseBranch, shipped) => git('look for unshipped commits', () => ops.unshippedCommits(dir, baseBranch, shipped)),
      changedFiles: (dir, baseBranch) => git('list the changed files', () => ops.changedFiles?.(dir, baseBranch) ?? Promise.resolve([])).pipe(Effect.orElseSucceed((): string[] => [])),
      freshBranch: (dir, branch, baseBranch) => git(`start ${branch} from ${baseBranch}`, () => ops.freshBranch(dir, branch, baseBranch)),
      cherryPick: (dir, commits) => git('bring commits over', () => ops.cherryPick(dir, commits)),
      push: (dir, branch) => git(`push ${branch}`, () => ops.push(dir, branch)),
      publish: (dir, branch) => git(`publish ${branch}`, () => ops.publish(dir, branch)),
      pull: (dir, branch) => git(`fetch ${branch}`, () => ops.pull(dir, branch)),
      checkoutPullRequest: (repo, id, number) => git(`check out PR #${number}`, () => ops.checkoutPullRequest(repo, id, number)),
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

/** How many more tries shipping gets when GitHub answers with a 5xx, on `ShipRetry`'s schedule. */
export const SHIP_RETRIES = 3;

/** The wait before each retry after a GitHub 5xx: 4, 8 then 16 seconds, about 30 in all. Tests set it to none. */
export const ShipRetry = Context.Reference<Schedule.Schedule<unknown>>('focus/agents/ShipRetry', {
  defaultValue: () => Schedule.exponential('4 seconds'),
});

/** The 5xx GitHub answered with, when that's why `err` failed: a push's `GitFailed` or a gh `GhServerError`. */
export function serverError(err: unknown): string | undefined {
  if (err instanceof GitFailed) return err.serverError;
  if (err instanceof GhServerError) return serverStatus(err.stderr) ?? 'HTTP 5xx';
  return undefined;
}

/**
 * Runs `effect` again, up to `SHIP_RETRIES` more times, while it fails because GitHub answered with a 5xx, telling
 * `retrying` each time. Any other failure, or the last 5xx, fails straight through.
 */
export const retryServerErrors = <A, E, R>(effect: Effect.Effect<A, E, R>, retrying: (status: string, attempt: number) => void): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const schedule = yield* ShipRetry;
    let retries = 0;
    return yield* effect.pipe(
      Effect.retry({
        schedule,
        while: (err) =>
          Effect.sync(() => {
            const status = serverError(err);
            if (!status || retries >= SHIP_RETRIES) return false;
            retrying(status, ++retries);
            return true;
          }),
      }),
    );
  });

/** Claude Code sessions, one turn at a time. */
export class Sessions extends Context.Service<Sessions, {
  /**
   * Starts a turn of an agent's Claude Code session, held in the scope: closing the scope stops a turn that's still
   * running, so interrupting whoever started it (sending the agent home, say) really stops Claude.
   */
  start(req: RunRequest, hooks: RunHooks): Effect.Effect<AgentSession, never, Scope.Scope>;
  /**
   * Opens a terminal on the captain's screen that starts a cloud session (`AgentRunner.cloudTerminal`). `read` is what
   * it has shown so far; undefined when the office can't see it.
   */
  cloudTerminal(req: CloudTerminalRequest): Effect.Effect<{ read: Effect.Effect<string | undefined> }, TerminalFailed>;
}>()('focus/agents/Sessions') {
  /** Sessions on a runner: Claude Code through the Agent SDK, or the demo's scripted agents. */
  static fromRunner(runner: AgentRunner): Layer.Layer<Sessions> {
    return Layer.succeed(Sessions, Sessions.of({
      cloudTerminal: (req) =>
        Effect.tryPromise({
          try: () => (runner.cloudTerminal ? runner.cloudTerminal(req) : Promise.reject(new Error('This office has no terminal to open'))),
          catch: (err) => new TerminalFailed({ reason: errorMessage(err) }),
        }).pipe(Effect.map((terminal) => ({ read: Effect.promise(() => terminal.read().catch(() => '')) }))),
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

/** A picture of a page: a JPEG as a browser shows it, and the errors its scripts reported while it loaded. */
export interface Picture {
  image: Buffer;
  errors: string[];
  /** For an explainer: the stage at each moment asked for, as a JPEG with what the office saw on it. */
  moments?: (StageMoment & { image: Buffer })[];
}

/** Pictures of the HTML pages a goal's lead puts on their station's screen, for the screen to show. */
export class Renderer extends Context.Service<Renderer, {
  /** `moments`: for an explainer, the times to also take a picture of its stage at (`beatMoments`). */
  render(html: string, moments?: readonly number[]): Effect.Effect<Picture, RenderFailed>;
}>()('focus/agents/Renderer') {
  /** Renders in the agents' shared headless Chromium (`BrowserPool.render`). */
  static fromBrowser(browser: { render(html: string, moments?: readonly number[]): Promise<Picture> }): Layer.Layer<Renderer> {
    const failed = (err: unknown) => new RenderFailed({ reason: errorMessage(err) });
    return Layer.succeed(Renderer, Renderer.of({
      render: (html, moments) => Effect.tryPromise({ try: () => browser.render(html, moments), catch: failed }),
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
