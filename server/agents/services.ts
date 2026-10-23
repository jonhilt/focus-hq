import { Context, Data, Effect, Layer, Schedule, type Scope } from 'effect';
import { GhServerError, serverStatus } from '../github/runner';
import { errorMessage } from '../util';
import type { TriageDecision, Triager, TriageRequest } from './triage';
import type { QaChatAnswer, QaChatRequest, QaChatter } from './qaChat';
import type { SinceVerdict } from './retest';
import type { CommandRun } from './qaProof';
import type { EditedRecording } from './recorder';
import type { PackageFacts } from '../packageManager';
import type { MergeHeads, MergeTrial } from '../../shared/mergeCheck';
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

/** The QA officer couldn't answer the captain at the Playbook. */
export class QaChatFailed extends Data.TaggedError('QaChatFailed')<{ reason: string }> {
  override get message() {
    return this.reason;
  }
}

/** Ops couldn't open a terminal to start a cloud session in. */
export class TerminalFailed extends Data.TaggedError('TerminalFailed')<{ reason: string }> {
  override get message() {
    return this.reason;
  }
}

/** The agents' checkouts: worktrees of Ops' clones, one per agent (a lead's holds one per repo). */
export class Workspace extends Context.Service<Workspace, {
  /** A worktree on `branch` from the remote `startPoint`, reclaiming it from an agent who isn't `aboard`. */
  create(repo: string, agentId: string, branch: string, startPoint: string, aboard: (agentId: string) => boolean, local?: string): Effect.Effect<string, GitFailed>;
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
  renameBranch(dir: string, from: string, to: string): Effect.Effect<void, GitFailed>;
  cherryPick(dir: string, commits: string[]): Effect.Effect<void, GitFailed>;
  push(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  publish(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  pull(dir: string, branch: string): Effect.Effect<void, GitFailed>;
  checkoutPullRequest(repo: string, id: string, number: number): Effect.Effect<string, GitFailed>;
  mergeBase(repo: string, branch: string, baseBranch: string): Effect.Effect<BaseMerge, GitFailed>;
  missingRemoteCommits(dir: string, branch: string): Effect.Effect<boolean, GitFailed>;
  /** A worktree on `branch` as it was left (a closed goal's), from Ops' clone or else GitHub, never reset. */
  reopen(repo: string, agentId: string, branch: string, aboard: (agentId: string) => boolean): Effect.Effect<string, GitFailed>;
  snapshot(dir: string, message: string): Effect.Effect<boolean, GitFailed>;
  branchState(dir: string, branch: string, baseBranch: string): Effect.Effect<BranchState, GitFailed>;
  sinceVerdict(repo: string, number: number, baseBranch: string, sha: string): Effect.Effect<SinceVerdict | null, GitFailed>;
  runChecks(repo: string, number: number, head: string): Effect.Effect<ChecksRun | null, GitFailed>;
  mergeHeads(repo: string, number: number, baseBranch: string): Effect.Effect<MergeHeads, GitFailed>;
  /** Never fails: what went wrong building or checking the merge is a `broken` trial. */
  tryMerge(repo: string, heads: MergeHeads, chosen?: readonly string[]): Effect.Effect<MergeTrial>;
  /** Runs a command in a checkout, without a shell. Never fails: where there's no real checkout, it couldn't start. */
  runIn(dir: string, args: string[], timeoutMs: number): Effect.Effect<CommandRun>;
  /** A file in a checkout; undefined when it isn't there. */
  readIn(dir: string, file: string): Effect.Effect<string | undefined>;
  /** What a checkout's root says about its checks; undefined when there's no such folder, or it can't be read. */
  packageFacts(dir: string): Effect.Effect<PackageFacts | undefined>;
  /** The same of Ops' own clone of `repo`; undefined until it has one. */
  cloneFacts(repo: string): Effect.Effect<PackageFacts | undefined>;
}>()('focus/agents/Workspace') {
  /** The workspace on its Promise-based operations: the live git ones, or the demo's pretend ones. */
  static fromOps(ops: WorkspaceOps): Layer.Layer<Workspace> {
    const git = <A>(what: string, run: () => Promise<A>): Effect.Effect<A, GitFailed> =>
      Effect.tryPromise({ try: run, catch: (err) => new GitFailed({ what, reason: errorMessage(err), serverError: serverStatus(errorMessage(err)) }) });
    return Layer.succeed(Workspace, Workspace.of({
      create: (repo, agentId, branch, startPoint, aboard, local) => git(`check out ${branch}`, () => ops.create(repo, agentId, branch, startPoint, aboard, local)),
      remove: (repo, agentId) => Effect.ignore(git('remove a checkout', () => ops.remove(repo, agentId))),
      install: (dir) => Effect.promise(() => ops.install(dir)),
      dir: (agentId) => ops.dir(agentId),
      hasUncommittedChanges: (dir) => git('look for uncommitted changes', () => ops.hasUncommittedChanges(dir)),
      commitsAhead: (dir, baseBranch) => git('count new commits', () => ops.commitsAhead(dir, baseBranch)),
      head: (dir) => git('read the checked-out commit', () => ops.head(dir)),
      unshippedCommits: (dir, baseBranch, shipped) => git('look for unshipped commits', () => ops.unshippedCommits(dir, baseBranch, shipped)),
      changedFiles: (dir, baseBranch) => git('list the changed files', () => ops.changedFiles?.(dir, baseBranch) ?? Promise.resolve([])).pipe(Effect.orElseSucceed((): string[] => [])),
      freshBranch: (dir, branch, baseBranch) => git(`start ${branch} from ${baseBranch}`, () => ops.freshBranch(dir, branch, baseBranch)),
      renameBranch: (dir, from, to) => git(`rename ${from} to ${to}`, () => ops.renameBranch(dir, from, to)),
      cherryPick: (dir, commits) => git('bring commits over', () => ops.cherryPick(dir, commits)),
      push: (dir, branch) => git(`push ${branch}`, () => ops.push(dir, branch)),
      publish: (dir, branch) => git(`publish ${branch}`, () => ops.publish(dir, branch)),
      pull: (dir, branch) => git(`fetch ${branch}`, () => ops.pull(dir, branch)),
      checkoutPullRequest: (repo, id, number) => git(`check out PR #${number}`, () => ops.checkoutPullRequest(repo, id, number)),
      mergeBase: (repo, branch, baseBranch) => git(`merge ${baseBranch} into ${branch}`, () => ops.mergeBase(repo, branch, baseBranch)),
      missingRemoteCommits: (dir, branch) => git(`compare with origin's ${branch}`, () => ops.missingRemoteCommits(dir, branch)),
      reopen: (repo, agentId, branch, aboard) => git(`check out ${branch} again`, () => ops.reopen(repo, agentId, branch, aboard)),
      snapshot: (dir, message) => git('commit a WIP snapshot', () => ops.snapshot(dir, message)),
      branchState: (dir, branch, baseBranch) => git(`compare with origin's ${branch}`, () => ops.branchState(dir, branch, baseBranch)),
      sinceVerdict: (repo, number, baseBranch, sha) => git(`compare PR #${number} with ${sha.slice(0, 7)}`, () => ops.sinceVerdict(repo, number, baseBranch, sha)),
      runChecks: (repo, number, head) => git(`run the checks on PR #${number}`, () => ops.runChecks(repo, number, head)),
      mergeHeads: (repo, number, baseBranch) => git(`fetch PR #${number} and ${baseBranch}`, () => ops.mergeHeads(repo, number, baseBranch)),
      tryMerge: (repo, heads, chosen) =>
        git('check the merge', () => ops.tryMerge(repo, heads, chosen)).pipe(Effect.catch((err) => Effect.succeed<MergeTrial>({ kind: 'broken', ...heads, reason: err.reason }))),
      runIn: (dir, args, timeoutMs) => Effect.promise(() => ops.runIn?.(dir, args, timeoutMs) ?? Promise.resolve({ code: null, output: 'there is no checkout to run it in' })),
      readIn: (dir, file) => Effect.promise(() => ops.readIn?.(dir, file) ?? Promise.resolve(undefined)),
      packageFacts: (dir) => Effect.promise(() => (ops.packageFacts?.(dir) ?? Promise.resolve(undefined)).catch(() => undefined)),
      cloneFacts: (repo) => Effect.promise(() => (ops.cloneFacts?.(repo) ?? Promise.resolve(undefined)).catch(() => undefined)),
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
   * it has shown so far; undefined when Ops can't see it.
   */
  cloudTerminal(req: CloudTerminalRequest): Effect.Effect<{ read: Effect.Effect<string | undefined> }, TerminalFailed>;
}>()('focus/agents/Sessions') {
  /** Sessions on a runner: Claude Code through the Agent SDK, or the demo's scripted agents. */
  static fromRunner(runner: AgentRunner): Layer.Layer<Sessions> {
    return Layer.succeed(Sessions, Sessions.of({
      cloudTerminal: (req) =>
        Effect.tryPromise({
          try: () => (runner.cloudTerminal ? runner.cloudTerminal(req) : Promise.reject(new Error('This Focus has no terminal to open'))),
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

/** Ops couldn't take a picture of an HTML page. */
export class RenderFailed extends Data.TaggedError('RenderFailed')<{ reason: string }> {
  override get message() {
    return this.reason;
  }
}

/**
 * Moments of a page to take a picture of besides how it rests: the page jumps to each (its `kitSeek(at)`), the picture
 * is clipped to `clip`, and the page says what it sees in it (its `kitSeen(jpeg)`, given the picture as base64 JPEG).
 */
export interface Frames {
  at: readonly number[];
  clip: { x: number; y: number; width: number; height: number };
}

/** A page at one moment: its picture, and what the page said it saw in it (null when it has no `kitSeen`). */
export interface Frame {
  at: number;
  image: Buffer;
  seen: unknown;
}

/** A picture of a page: a JPEG as a browser shows it, and the errors its scripts reported while it loaded. */
export interface Picture {
  image: Buffer;
  errors: string[];
  /** The page at each moment asked for (`Frames`). */
  frames?: Frame[];
}

/** Pictures of the HTML pages a goal's lead puts on their station's screen, for the screen to show. */
export class Renderer extends Context.Service<Renderer, {
  /** `frames`: moments to also take a picture of the page at (an explainer's stage at each beat, say). */
  render(html: string, frames?: Frames): Effect.Effect<Picture, RenderFailed>;
}>()('focus/agents/Renderer') {
  /** Renders in the agents' shared headless Chromium (`BrowserPool.render`). */
  static fromBrowser(browser: { render(html: string, frames?: Frames): Promise<Picture> }): Layer.Layer<Renderer> {
    const failed = (err: unknown) => new RenderFailed({ reason: errorMessage(err) });
    return Layer.succeed(Renderer, Renderer.of({
      render: (html, frames) => Effect.tryPromise({ try: () => browser.render(html, frames), catch: failed }),
    }));
  }
}

/** Ops couldn't edit a recording of an agent's browser (no ffmpeg, say). */
export class RecordingFailed extends Data.TaggedError('RecordingFailed')<{ reason: string }> {
  override get message() {
    return this.reason;
  }
}

/** Recordings of agents' browser sessions, edited down to show on a pull request (recording.ts). */
export class Recordings extends Context.Service<Recordings, {
  /** Records the agent's browser from now on, throwing away any recording of it before. */
  start(agentId: string): Effect.Effect<void>;
  /** Stops recording and edits it down: nothing if it wasn't recorded or the agent never acted in it. */
  finish(agentId: string): Effect.Effect<EditedRecording | null, RecordingFailed>;
}>()('focus/agents/Recordings') {
  /** In the agents' shared headless Chromium (`BrowserPool`), edited with the machine's ffmpeg. */
  static fromBrowser(browser: { record(agentId: string): Promise<void>; finishRecording(agentId: string): Promise<EditedRecording | null> }): Layer.Layer<Recordings> {
    return Layer.succeed(Recordings, Recordings.of({
      start: (agentId) => Effect.promise(() => browser.record(agentId).catch(() => undefined)),
      finish: (agentId) => Effect.tryPromise({ try: () => browser.finishRecording(agentId), catch: (err) => new RecordingFailed({ reason: errorMessage(err) }) }),
    }));
  }

  /** Records nothing: every recording finishes as `recorded` (none by default). */
  static none(recorded: EditedRecording | null = null): Layer.Layer<Recordings> {
    return Layer.succeed(Recordings, Recordings.of({ start: () => Effect.void, finish: () => Effect.succeed(recorded) }));
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

/** The QA officer answering the captain at the Playbook: it proposes, and changes nothing. */
export class QaChat extends Context.Service<QaChat, {
  /** Interrupting it stops the call. */
  answer(req: Omit<QaChatRequest, 'signal'>): Effect.Effect<QaChatAnswer, QaChatFailed>;
}>()('focus/agents/QaChat') {
  static fromChatter(chatter: QaChatter): Layer.Layer<QaChat> {
    return Layer.succeed(QaChat, QaChat.of({
      answer: (req) => Effect.tryPromise({ try: (signal) => chatter.answer({ ...req, signal }), catch: (err) => new QaChatFailed({ reason: errorMessage(err) }) }),
    }));
  }
}
