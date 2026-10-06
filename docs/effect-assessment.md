# Effect adoption assessment

A spike for issue #46. `server/github/` was ported to an [Effect](https://effect.website/) service. The rest of the server still sees the Promise-based `GitHubProvider` it had before, through a thin adapter. This page covers what the port showed and whether the rest of the server should follow.

## What the spike changed

| File | Role |
| --- | --- |
| `server/github/runner.ts` (new) | `GhRunner` service: runs `gh` via `execFile` (no shell, stdin input, 120s timeout, killed on interruption). It defines the tagged errors and `decodeJson`. |
| `server/github/service.ts` (new) | `GitHub` service (same operations as `GitHubProvider`, returning `Effect`s), the `GitHubError` union, and `toProvider(layer)`, the Promise adapter. |
| `server/github/ghCli.ts` | `GhCliProvider` class → `ghCliService` / `ghCliLayer`. gh's JSON is decoded with Effect Schema instead of `as T`. |
| `server/github/demo.ts` | `DemoGitHub` class → `demoLayer`, with the same seed data and in-memory behaviour. |
| `server/github/ghCli.test.ts` (new) | Fake-runner tests for success mapping and each failure tag, plus adapter tests over the demo layer. |
| `server/index.ts` | `toProvider(config.demo ? demoLayer : ghCliLayer)`. |

`provider.ts` is unchanged: the interface, the exported types and the pure helpers (`closingIssues`, `rollupChecks`, `evidenceUrl`, `QA_EVIDENCE_BRANCH`). `office.ts`, `previews.ts`, `manager.ts` and `run()` in `util.ts` are also untouched.

## Version

- **`effect@4.0.1`**, pinned exactly. This is what npm's `latest` dist-tag pointed at on 2026-10-05. Other tags at the time: `rc` 4.0.0-rc.118, `beta` 4.0.0-beta.107, and a `snapshot`.
- **v4 is the current stable major**, so the assumption in the issue that we might land on v3 no longer holds. Nothing newer is in pre-release, so there's no pending major to plan around.
- **No other `@effect/*` packages.** v4 folded most of the old satellite packages into `effect` itself (`effect/Schema`, `effect/testing`, `effect/unstable/process`, …). A platform package (`@effect/platform-node`) would have given us the stock `ChildProcessSpawner`. The issue asked for a runner on `execFile`, though, and that takes 20 lines (`runner.ts`), so I didn't add it. `@effect/vitest` (`it.effect`, `TestClock`) wasn't needed: plain `Effect.runPromise` inside a vitest `it` is enough at this size.
- **What v4 means in practice.** v4 is a large rewrite of v3: a smaller runtime, renamed modules and a lot of API churn. `Context.Tag`/`Effect.Service` became `Context.Service`, `Effect.async` became `Effect.callback`, `catchAll` became `catch`, `either` became `result`, and `Schema.Literal(...a)` became `Schema.Literals([a])`, among others. Most blog posts, Stack Overflow answers and model training data describe **v3**. That matters more than anything else on this page for a codebase written by agents (see Agent-friendliness). If we adopt now, we start on v4 and never have a v3→v4 migration to do.

## Readability

Line counts:

| | Before | After |
| --- | --- | --- |
| `ghCli.ts` | 221 | 235 |
| `demo.ts` | 244 | 256 |
| `runner.ts` | – (`run()` in util) | 71 |
| `service.ts` | – | 60 |
| **Production total** | **465** | **622 (+157, +34%)** |
| Tests | 0 | 126 |

Where the extra lines go:

- **About 55 lines of schemas** in `ghCli.ts`, replacing the `RawIssue`/`RawPr` interfaces (about 30 lines). These lines buy validation, not just types.
- **About 35 lines of error classes** in `runner.ts`. Today's equivalent is the single `CommandError` in `util.ts`.
- **30 lines of adapter** (`toProvider`), restating each operation once more. This goes away if consumers move to Effect.
- **The demo got longer.** Every in-memory lookup now returns `Effect.succeed`/`Effect.fail` instead of a value or a throw.

**Before**, a method in `ghCli.ts` reads like ordinary async code:

```ts
async getIssue(repo: string, number: number): Promise<IssueDetail> {
  const raw = await ghJson<RawIssue>(['issue', 'view', String(number), '-R', repo, '--json', `${ISSUE_FIELDS},comments`]);
  return {
    ...toIssue(repo, raw),
    comments: (raw.comments ?? []).map((c) => ({ author: c.author?.login ?? 'someone', body: c.body })),
  };
}
```

**After**, the same operation is a pipeline:

```ts
getIssue: (repo, number) =>
  ghJson(RawIssue, ['issue', 'view', String(number), '-R', repo, '--json', `${ISSUE_FIELDS},comments`]).pipe(
    Effect.map((raw) => ({
      ...toIssue(repo, raw),
      comments: (raw.comments ?? []).map((c) => ({ author: c.author?.login ?? 'someone', body: c.body })),
    })),
  ),
```

For single-step operations, `.pipe(Effect.map(...))` costs one indent level and is otherwise just as clear. Multi-step code is where the styles diverge. `Effect.gen` reads like `async`/`await` (`yield*` for `await`), as in `evidenceBranch`. But the "create the ref, and if that fails, check whether someone else created it" step turned from a `try`/`catch` into a combinator:

```ts
// before
try {
  await ghPost('POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${QA_EVIDENCE_BRANCH}`, sha: commit.sha });
} catch (err) {
  // another room's QA officer may have just created it
  if (!(await exists())) throw err;
}

// after
yield* ghPost(Schema.Unknown, 'POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${QA_EVIDENCE_BRANCH}`, sha: commit.sha }).pipe(
  // another room's QA officer may have just created it
  Effect.catch((err) => Effect.flatMap(exists, (there) => (there ? Effect.void : Effect.fail(err)))),
);
```

The demo shows the same trade-off. Before:

```ts
private repo(name: string): FakeRepo {
  const repo = this.repos.get(name);
  if (!repo) throw new Error(`Repository ${name} not found (demo mode knows: ${[...this.repos.keys()].join(', ')})`);
  return repo;
}
async listIssues(name: string): Promise<Issue[]> {
  return [...this.repo(name).issues];
}
```

After:

```ts
const repo = (name: string): Effect.Effect<FakeRepo, GitHubNotFound> => {
  const found = repos.get(name);
  return found
    ? Effect.succeed(found)
    : Effect.fail(new GitHubNotFound({ message: `Repository ${name} not found (demo mode knows: ${[...repos.keys()].join(', ')})` }));
};
// ...
listIssues: (name) => repo(name).pipe(Effect.map((r) => [...r.issues])),
```

**Verdict:** the code is slightly longer and slightly noisier, and nothing about it is unclear once you know the dozen combinators involved (`map`, `flatMap`, `catch`, `gen`, `as`, `andThen`, `succeed`, `fail`). Someone who doesn't know Effect will find the "after" harder to read. The extra length is mostly validation and error types we didn't have before, not ceremony.

## Errors

**Before:** every failure was an `Error` whose message was a string assembled by `run()`, e.g. `gh pr view 999999 failed: GraphQL: Could not resolve…`. `run()` attached `stderr` and `code` to a `CommandError`, but no caller looked at them. A missing `gh` and a logged-out `gh` could only be told apart by reading the message. JSON that didn't match `RawPr` was cast anyway and failed later, somewhere else, as `undefined`.

**After:** every operation's type says exactly how it can fail:

```ts
readonly listRepos: Effect.Effect<string[], GitHubError>;
// GitHubError = GhNotInstalled | GhNotAuthenticated | GhCommandFailed | GhTimedOut | GhBadOutput
//             | GitHubNotFound | GitHubRejected   (the last two only from the demo layer)
```

Each error is a `Data.TaggedError` carrying the facts as fields. Its `message` getter renders the same wording `run()` used, so logs and the UI read as before:

```ts
export class GhCommandFailed extends Data.TaggedError('GhCommandFailed')<{ args: readonly string[]; stderr: string; exitCode: number | null }> {
  override get message() {
    return `${describe(this.args)} failed: ${lastLines(this.stderr)}`;
  }
}
```

Classification happens once, at the process boundary (`classify` in `runner.ts`): `ENOENT` means not installed, exit code 4 or "gh auth login" on stderr means not authenticated, and anything else is a failed command. Timeouts come from `Effect.timeoutOrElse`. Interrupting the effect aborts `execFile`'s `signal`, which kills `gh`; I checked that no orphaned `gh` process remains.

What callers see:

- **Inside Effect**, failures can be handled by tag, and the compiler removes a handled case from the type: `gh.mergePullRequest(...).pipe(Effect.catchTag('GhCommandFailed', (e) => e.exitCode === 1 ? … : Effect.fail(e)))`. `status` uses this to turn any error into `{ ok: false }`, and its type is now `Effect<GitHubStatus>` (it can't fail).
- **Through the adapter** (all current callers), promises reject with the tagged error itself. It's an `instanceof Error` whose message is at least as good as before, so `errorMessage(err)` in `office.ts` and `manager.ts` works unchanged. `err._tag` is also there. In the running demo, `POST /api/projects/:id/repos` with an unknown repo still answers `Can't open demo/nope on GitHub: Repository demo/nope not found (demo mode knows: …)`.
- **The status line is slightly better.** A logged-out gh used to show `gh is not ready: gh api user failed: To get started with GitHub CLI, please run: gh auth login Alternatively, populate the GH_TOKEN…. Install the GitHub CLI and run "gh auth login".`, which said `gh auth login` twice. It now says `gh is not ready: gh is not logged in to GitHub. Install the GitHub CLI and run "gh auth login".`, keeping the same `ok: false` shape and prefix and suffix. A missing gh shows `gh is not ready: the GitHub CLI (gh) is not installed or not on the PATH. …`.
- **Bad output is now a typed error at the source.** Malformed or wrongly shaped JSON fails with `GhBadOutput` naming the command, the raw output and the schema's reason (`Expected number at ["number"]`). One regression: for plain unparseable JSON, the schema's message is the generic `Expected a valid JSON string` and loses `JSON.parse`'s position detail.

**Verdict:** typed failures are clearly better than strings *inside* Effect code, and classifying errors at the boundary is a real improvement. But nothing outside `server/github/` uses the types yet: they stop at the adapter and become messages again. Most of the benefit is deferred until consumers are written in Effect.

## Testability

**Today**, testing `GhCliProvider` would mean one of these:

- `vi.mock('../util')` to replace `run()` for the whole module, which is order-sensitive and couples the test to the import graph;
- putting a fake `gh` script on `PATH`;
- refactoring the class to take a `run` function, which is a dependency-injection seam we would have to invent.

None of these exist, so the gh layer had no tests. `DemoGitHub` was always testable as a plain class, but nothing tested it.

**Now**, the runner is a service, and a test provides a fake one in about 10 lines:

```ts
function fakeGh(reply: (args: readonly string[]) => Effect.Effect<string, GhCommandError>) {
  const calls: (readonly string[])[] = [];
  const runner = Layer.succeed(GhRunner, GhRunner.of({
    run: (args) => Effect.suspend(() => { calls.push(args); return reply(args); }),
  }));
  return { calls, layer: ghCliService.pipe(Layer.provide(runner)) };
}

it('fails with GhCommandFailed, keeping stderr and the exit code', async () => {
  const { layer } = fakeGh((args) => Effect.fail(new GhCommandFailed({ args, stderr: 'GraphQL: Could not resolve to a Repository', exitCode: 1 })));
  const error = await fail(layer, (gh) => gh.listPullRequests('acme/nope'));
  expect(error).toMatchObject({ _tag: 'GhCommandFailed', stderr: 'GraphQL: Could not resolve to a Repository', exitCode: 1 });
});
```

`ghCli.test.ts` covers these cases (8 tests, under 10 ms total):

- `gh pr list` JSON mapped to `PullRequest`, including rollup checks and merged `closes`;
- `GhCommandFailed` with stderr and exit code;
- `GhBadOutput` for both broken and wrongly shaped JSON;
- `GhBadOutput` when `gh pr create` prints no URL;
- a missing gh becoming a status;
- `classify` for ENOENT, exit 4 and other exit codes;
- the Promise adapter resolving and rejecting with tags over `demoLayer`, including state that persists across calls.

**Verdict:** a real improvement, and it shows Effect's main selling point well: dependency injection comes from the type system (a layer that needs `GhRunner` doesn't compile until one is provided) rather than from module mocking. To be fair, a hand-written `run`-function parameter would get most of this for this one file. Effect pays off when there are several dependencies, because layers compose and the compiler tracks what's still missing.

## Cost

- **Dependencies.** One package, `effect`, with **zero transitive dependencies**. The tarball is 8.9 MB; unpacked it's 49.6 MB in 2,561 files (33 MB `dist/`, 20 MB `src/`). `node_modules` grew from 429 MB to 482 MB (about +12%). The package ships `src/`, `CLAUDE.md`/`AGENTS.md` and `ai-docs/` on purpose, so agents can read the real source.
- **`npm run build` and the client bundle: no change.** The client doesn't import `server/github`. The bundle stays at 757.78 kB (208.43 kB gzip) and contains no Effect code. Build time is about 0.5 s, as before.
- **Startup.** Importing the `effect` barrel costs about 160–260 ms in plain Node and about 0.45 s under `tsx`, which is how the server runs. That's paid once at boot. The old `ghCli.ts` imported in about 10 ms. Deep imports (`effect/Effect`, `effect/Schema`, …) cut this only a little (about 160 ms for the set used here; `Schema` alone is about 100 ms). Not noticeable for a long-running server, but `tsx` restarts in dev pay it every time.
- **Runtime.** One `ManagedRuntime` per process. Per-call overhead is negligible next to spawning `gh`.
- **zod and Effect Schema together.** zod stays whatever we decide: the Claude Agent SDK's `tool()` takes zod schemas (`claudeCrew.ts`, `browserTool.ts`), so it can't be replaced. Adopting Effect Schema for our own boundaries means two schema languages with different idioms: `z.string().optional()` vs `Schema.optional(Schema.String)`, and `.describe()` vs annotations. That's two sets of error messages and two things for agents to keep straight. A workable rule would be zod only at the SDK's tool boundary and Effect Schema everywhere else. If we don't adopt Effect broadly, the gh decoding could just as well use zod (`z.array(RawPr).safeParse(JSON.parse(out))`), mapped to `GhBadOutput` by hand.
- **Schema strictness** is a cost as well as a benefit. `mergeable` is decoded as `'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'`, so if GitHub adds a fourth value, the whole board for that repo fails with `GhBadOutput`. Before, the unknown value would have been passed through. I kept fields optional or nullable wherever gh can omit them, and checked against the live `jonhilt/focus` repo: status, repo list, repo view, issue list and view, PR list, view and state, and `findPullRequest` all decode cleanly.

## Agent-friendliness

This section is about what writing the spike was like for me, as the LLM agent that built it.

**What went well**

- **The package documents itself for agents.** `node_modules/effect/CLAUDE.md` and `ai-docs/` show the v4 idioms (`Context.Service`, `Effect.fn`, `Schema.TaggedError`, `ManagedRuntime`). I read them before writing any code. That's why the v4/v3 confusion didn't turn into compile errors: left to memory, I would have written `Context.Tag`, `Effect.async`, `Effect.catchAll` and `Effect.either`, all v3 names that don't exist in v4. Without those docs, expect an agent's first draft to be v3 code.
- **Once the types are right, they guide you well.** `ghCli.ts` compiled on the first try, and the `GitHub.of({...})` contract flagged every missing or mistyped operation.

**What was awkward or error-prone**

1. **Conditional `Effect.succeed`/`Effect.fail` doesn't unify.** `const repo = (name) => found ? Effect.succeed(found) : Effect.fail(new GitHubNotFound(...))` infers a *union of two Effects*. Every `.pipe(Effect.map(...))` on it then failed with a page-long error ending in `Type 'FakeRepo' is not assignable to type 'never'`, which points nowhere near the cause. The fix is an explicit return type (`: Effect.Effect<FakeRepo, GitHubNotFound>`). Agents will hit this often, and the error message won't tell them why.
2. **Eager versus lazy.** `status: gh(['api', 'user'])` builds the Effect once, when the layer is constructed. That's correct, because Effects are descriptions. But my first fake runner pushed to `calls` when `run()` was *called* rather than when the effect *ran*, so the test saw a phantom `gh api user` call. Mixing side-effecting JS with Effect values needs `Effect.suspend`/`Effect.sync`, and that's easy to forget.
3. **A forgotten `yield*` or an un-run Effect is silent.** Our type-aware ESLint (`no-floating-promises`) catches dropped Promises, but nothing catches a dropped Effect: `gh.mergePullRequest(...)` without `yield*` just does nothing. Effect's TypeScript language-service plugin (`@effect/language-service`) has diagnostics for this ("floating Effect"), but it only runs in the editor unless wired into `tsc`. I didn't add it.
4. **Small API surprises:**
   - `Data.TaggedError` errors have no `message` unless you declare one as a field or override the getter, as `runner.ts` does.
   - vitest's `toEqual` against `Effect.result(...)` failed because `Result` carries an `_id` field, so the tests use `Effect.flip` instead.
   - The schema error for non-JSON input is vague (see Errors).
   - `Schema.Struct` field spreading (`{ ...RawPrDetail.fields, ... }`) works but isn't obvious.
5. **Two ways to write everything.** `pipe` or `gen`, `Effect.fn` or plain arrows, `Data.TaggedError` or `Schema.TaggedError`, `flatMap` or `andThen`. Without a house style, each agent picks differently. That hurts review more than it hurts correctness.

**Guidance `CLAUDE.md` would need if we adopt** (proposed, not added):

- We're on **Effect v4**. Read `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/` before writing Effect code, and don't use APIs from memory: `Context.Tag`, `Effect.Service`, `Effect.async`, `catchAll` and `either` are v3 and don't exist here.
- Services are `Context.Service` classes with a static `layer`. Live and demo implementations are Layers, and tests provide fake Layers rather than `vi.mock`.
- Errors are `Data.TaggedError` classes with a `message` getter. Classify at the I/O boundary; never fail with strings.
- Give helpers that return `succeed` *or* `fail` an explicit `Effect.Effect<A, E>` return type.
- Style: `pipe` for one or two steps, `Effect.gen` for anything with control flow, `yield* new SomeError(...)` to fail.
- Wrap side-effecting JS in `Effect.sync`/`Effect.suspend`; never do side effects while *building* an Effect.
- Decode external JSON with Effect Schema. Use zod only where the Claude Agent SDK requires it.
- Add `@effect/language-service` as a `tsc` plugin so floating Effects fail `npm run typecheck`. This needs checking; it isn't part of the spike.

## Recommendation

**Adopt partially.** Keep this port and run one more spike, on `previews.ts`, before deciding on the rest.

Why not adopt everywhere now:

- On the GitHub layer the gains are real but modest: typed errors, decoded JSON, a fake-runner test seam. Most of that could also be had with a `run` parameter and zod.
- The cost is real too: 34% more lines here, about 0.2–0.45 s of startup, a 50 MB dependency, and a second idiom for agents to learn, on a major version most training data doesn't cover.
- The typed errors pay off only when callers are in Effect too, and every current caller sits behind the adapter.
- So the GitHub layer alone doesn't justify a server-wide move.

Why not back out:

- The port is done, tested, and behaves the same live and in the demo.
- It's walled off behind `toProvider`, so the rest of the server pays nothing for it except startup.
- Effect's strongest features weren't tested by this spike: structured concurrency, interruption, `Scope`d resources and timeouts. Those are exactly what the hand-rolled code in `previews.ts` and `manager.ts` reimplements with `AbortController`s, timers, `killTree` and `try`/`finally`.

### Rough migration path

1. **Merge this spike** (`server/github/` on Effect, Promise adapter at the edge). Add `@effect/language-service` to typecheck, plus the CLAUDE.md guidance above, if we go past step 2.
2. **Next spike: `previews.ts` (872 lines).** It starts and stops dev servers: a detached process tree per preview, a stop command, `sleep`-based polling for a URL, a 10 s grace period, then `SIGKILL`, plus log files.
   - *Gain:* each preview becomes a `Scope`. `Effect.acquireRelease` ties the process tree to it, so cleanup on stop, failure or shutdown is guaranteed by construction rather than by `run.kill?.()` bookkeeping. Polling becomes a `Schedule`, timeouts become `Effect.timeout`, and it gets tests with `TestClock` instead of real sleeps.
   - *Risk:* it shells out on purpose (`&&`, `npm.cmd` on Windows), and process-group killing is platform-specific. That logic moves rather than disappears.
   - *Decide after this spike:* if `previews.ts` doesn't come out clearly simpler and safer, stop at partial adoption.
3. **Then the agent lifecycle in `manager.ts` (721 lines):** hire → queue → worktree → run → commit nudge → push → PR, with messages and approvals. Do this once `GitHub` consumers can use the Effect service directly, and delete the adapter calls one by one.
   - *Gain:* a per-room concurrency limit (`Semaphore`), interruption that really stops an agent's run and its children, and typed failures from GitHub and git that can drive what happens next (retry on `GhTimedOut`, ask the human on `GhNotAuthenticated`).
   - *Risk:* this is the largest and most stateful file. The Claude Agent SDK is Promise and async-iterator based, so it would sit behind its own adapter (`Stream.fromAsyncIterable`). A partial port here would mix Promise and Effect styles in one file, which is worse than either.
   - *Done.* `manager.ts` runs on Effect inside and keeps its Promise-based methods for `office.ts` and the routes, the way `Previews` does. It uses `GitHub` directly, and git, Claude Code sessions and triage come in as services in `server/agents/services.ts`, over the Promise implementations they always had (live and demo). Each agent's work is a fiber in a `FiberMap`, run only if that agent has none, which made a double launch on resume impossible by construction rather than by a status check. A Claude Code turn is a scoped resource, so interrupting an agent's fiber (sending them home) stops the session. Triage is serialised per room with a `PartitionedSemaphore`. Who starts next is a pure function (`schedule.ts`), and `manager.test.ts` drives the whole manager with a fake Claude and the demo's GitHub. The SDK's message loop stayed in `claudeRunner.ts` behind the `AgentRunner` interface; wrapping it in a `Stream` gained nothing.
4. **`util.ts` primitives** (`KeyedLock`, `sleep`, `run()`) go when their last caller moves. `KeyedLock` becomes a keyed `Semaphore`, and `run()` folds into a generalised `runner.ts`.
5. **Leave alone:** `client/`, `shared/` (plain types and pure functions), the pure decision code (QA verdicts, prompts), and zod at the SDK tool boundary.
