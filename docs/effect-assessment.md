# Effect adoption assessment

*A decision record, as of 2026-10 (when Effect v4 came in): why and how. The code is the source for what's there now.*

A spike for issue #46. `server/github/` was ported to an [Effect](https://effect.website/) service, with a Promise adapter (`toProvider`) at its edge. This page covers what the port showed and whether the rest of the server should follow.

## Version

- **`effect@4.0.1`**, pinned exactly. This is what npm's `latest` dist-tag pointed at on 2026-10-05. Other tags at the time: `rc` 4.0.0-rc.118, `beta` 4.0.0-beta.107, and a `snapshot`.
- **v4 is the current stable major**, so the assumption in the issue that we might land on v3 no longer holds. Nothing newer is in pre-release, so there's no pending major to plan around.
- **No other `@effect/*` packages.** v4 folded most of the old satellite packages into `effect` itself. A platform package (`@effect/platform-node`) would have given us the stock `ChildProcessSpawner`. The issue asked for a runner on `execFile`, though, and that takes a few lines (`runner.ts`), so I didn't add it. `@effect/vitest` (`it.effect`, `TestClock`) wasn't needed: plain `Effect.runPromise` inside a vitest `it` is enough at this size.
- **What v4 means in practice.** v4 is a large rewrite of v3: a smaller runtime, renamed modules and a lot of API churn (`Context.Tag` became `Context.Service`, `Effect.async` became `Effect.callback`, `catchAll` became `catch`, among others). Most blog posts, Stack Overflow answers and model training data describe **v3**. That matters more than anything else on this page for a codebase written by agents (see Agent-friendliness). If we adopt now, we start on v4 and never have a v3→v4 migration to do.

## Readability

The port came out about a third longer. The extra lines are mostly schemas (validation, not just types, in place of the `RawIssue`/`RawPr` interfaces), tagged error classes in place of the single `CommandError`, and the adapter, which restates each operation once more and goes away if consumers move to Effect. The demo got longer too: every in-memory lookup returns `Effect.succeed`/`Effect.fail` instead of a value or a throw.

For single-step operations, `.pipe(Effect.map(...))` costs one indent level and is otherwise just as clear. Multi-step code is where the styles diverge. `Effect.gen` reads like `async`/`await` (`yield*` for `await`), but a `try`/`catch` ("create the ref, and if that fails, check whether someone else created it") turns into a combinator.

**Verdict:** the code is slightly longer and slightly noisier, and nothing about it is unclear once you know the dozen combinators involved (`map`, `flatMap`, `catch`, `gen`, `as`, `andThen`, `succeed`, `fail`). Someone who doesn't know Effect will find it harder to read. The extra length is mostly validation and error types we didn't have before, not ceremony.

## Errors

**Before:** every failure was an `Error` whose message was a string assembled by `run()`. `run()` attached `stderr` and `code` to a `CommandError`, but no caller looked at them. A missing `gh` and a logged-out `gh` could only be told apart by reading the message. JSON that didn't match `RawPr` was cast anyway and failed later, somewhere else, as `undefined`.

**After:** every operation's type says exactly how it can fail, each error a tagged class carrying the facts as fields, with a message in the wording `run()` used, so logs and the UI read as before. Classification happens once, at the process boundary: not installed, not authenticated, or a failed command. Interrupting the effect kills `gh`; I checked that no orphaned `gh` process remains.

- **Inside Effect**, failures can be handled by tag, and the compiler removes a handled case from the type.
- **Through the adapter**, promises reject with the tagged error itself, an `instanceof Error`, so `errorMessage(err)` works unchanged.
- **The status line got slightly better**: a logged-out gh no longer says `gh auth login` twice.
- **Bad output is a typed error at the source.** One regression: for plain unparseable JSON, the schema's message is the generic `Expected a valid JSON string` and loses `JSON.parse`'s position detail.

**Verdict:** typed failures are clearly better than strings *inside* Effect code, and classifying errors at the boundary is a real improvement. But at the time nothing outside `server/github/` used the types: they stopped at the adapter and became messages again. Most of the benefit was deferred until consumers were written in Effect.

## Testability

**Before**, testing the gh layer would have meant one of these:

- `vi.mock('../util')` to replace `run()` for the whole module, which is order-sensitive and couples the test to the import graph;
- putting a fake `gh` script on `PATH`;
- refactoring the class to take a `run` function, which is a dependency-injection seam we would have to invent.

None of these existed, so the gh layer had no tests. With the runner a service, a test provides a fake one in a few lines (`ghCli.test.ts`).

**Verdict:** a real improvement, and it shows Effect's main selling point well: dependency injection comes from the type system (a layer that needs `GhRunner` doesn't compile until one is provided) rather than from module mocking. To be fair, a hand-written `run`-function parameter would get most of this for this one file. Effect pays off when there are several dependencies, because layers compose and the compiler tracks what's still missing.

## Cost

As measured for 4.0.1:

- **Dependencies.** One package, `effect`, with **zero transitive dependencies**, about 50 MB unpacked. The package ships `src/`, `CLAUDE.md`/`AGENTS.md` and `ai-docs/` on purpose, so agents can read the real source.
- **`npm run build` and the client bundle: no change.** The client doesn't import `server/github`, so the bundle contains no Effect code.
- **Startup.** Importing the `effect` barrel costs about 160–260 ms in plain Node and about 0.45 s under `tsx`, which is how the server runs. That's paid once at boot. Deep imports (`effect/Effect`, `effect/Schema`, …) cut this only a little. Not noticeable for a long-running server, but `tsx` restarts in dev pay it every time.
- **Runtime.** One `ManagedRuntime` per process. Per-call overhead is negligible next to spawning `gh`.
- **zod and Effect Schema together.** zod stays whatever we decide: the Claude Agent SDK's `tool()` takes zod schemas, so it can't be replaced. Adopting Effect Schema for our own boundaries means two schema languages with different idioms, two sets of error messages and two things for agents to keep straight. A workable rule would be zod only at the SDK's tool boundary and Effect Schema everywhere else. If we don't adopt Effect broadly, the gh decoding could just as well use zod, mapped to `GhBadOutput` by hand.
- **Schema strictness** is a cost as well as a benefit. An enum like `mergeable` decoded strictly means that if GitHub adds a value, the whole board for that repo fails with `GhBadOutput`, where before the unknown value would have been passed through. I kept fields optional or nullable wherever gh can omit them, and checked the decoders against a live repo.

## Agent-friendliness

This section is about what writing the spike was like for me, as the LLM agent that built it.

**What went well**

- **The package documents itself for agents.** `node_modules/effect/CLAUDE.md` and `ai-docs/` show the v4 idioms. I read them before writing any code. That's why the v4/v3 confusion didn't turn into compile errors: left to memory, I would have written `Context.Tag`, `Effect.async`, `Effect.catchAll` and `Effect.either`, all v3 names that don't exist in v4. Without those docs, expect an agent's first draft to be v3 code.
- **Once the types are right, they guide you well.** `ghCli.ts` compiled on the first try, and the `GitHub.of({...})` contract flagged every missing or mistyped operation.

**What was awkward or error-prone**

1. **Conditional `Effect.succeed`/`Effect.fail` doesn't unify.** `found ? Effect.succeed(found) : Effect.fail(...)` infers a *union of two Effects*. Every `.pipe(Effect.map(...))` on it then failed with a page-long error ending in `Type 'FakeRepo' is not assignable to type 'never'`, which points nowhere near the cause. The fix is an explicit return type. Agents will hit this often, and the error message won't tell them why.
2. **Eager versus lazy.** An Effect built once, when the layer is constructed, is correct, because Effects are descriptions. But my first fake runner recorded a call when `run()` was *called* rather than when the effect *ran*, so the test saw a phantom call. Mixing side-effecting JS with Effect values needs `Effect.suspend`/`Effect.sync`, and that's easy to forget.
3. **A forgotten `yield*` or an un-run Effect is silent.** Our type-aware ESLint (`no-floating-promises`) catches dropped Promises, but nothing catches a dropped Effect. Effect's TypeScript language-service plugin (`@effect/language-service`) has diagnostics for this ("floating Effect"), but it only runs in the editor unless wired into `tsc`.
4. **Small API surprises:**
   - `Data.TaggedError` errors have no `message` unless you declare one as a field or override the getter.
   - vitest's `toEqual` against `Effect.result(...)` failed because `Result` carries an `_id` field.
   - The schema error for non-JSON input is vague (see Errors).
   - `Schema.Struct` field spreading (`{ ...RawPrDetail.fields, ... }`) works but isn't obvious.
5. **Two ways to write everything.** `pipe` or `gen`, `Effect.fn` or plain arrows, `Data.TaggedError` or `Schema.TaggedError`, `flatMap` or `andThen`. Without a house style, each agent picks differently. That hurts review more than it hurts correctness.

**Guidance `CLAUDE.md` would need if we adopt** (as proposed at the time):

- We're on **Effect v4**. Read `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/` before writing Effect code, and don't use APIs from memory: `Context.Tag`, `Effect.Service`, `Effect.async`, `catchAll` and `either` are v3 and don't exist here.
- Services are `Context.Service` classes with a static `layer`. Live and demo implementations are Layers, and tests provide fake Layers rather than `vi.mock`.
- Errors are `Data.TaggedError` classes with a `message` getter. Classify at the I/O boundary; never fail with strings.
- Give helpers that return `succeed` *or* `fail` an explicit `Effect.Effect<A, E>` return type.
- Style: `pipe` for one or two steps, `Effect.gen` for anything with control flow, `yield* new SomeError(...)` to fail.
- Wrap side-effecting JS in `Effect.sync`/`Effect.suspend`; never do side effects while *building* an Effect.
- Decode external JSON with Effect Schema. Use zod only where the Claude Agent SDK requires it.
- Add `@effect/language-service` as a `tsc` plugin so floating Effects fail `npm run typecheck`.

## Recommendation

**Adopt partially.** Keep this port and run one more spike, on `previews.ts`, before deciding on the rest.

Why not adopt everywhere now:

- On the GitHub layer the gains are real but modest: typed errors, decoded JSON, a fake-runner test seam. Most of that could also be had with a `run` parameter and zod.
- The cost is real too: a third more lines here, about 0.2–0.45 s of startup, a 50 MB dependency, and a second idiom for agents to learn, on a major version most training data doesn't cover.
- The typed errors pay off only when callers are in Effect too, and at the time every caller sat behind the adapter.
- So the GitHub layer alone doesn't justify a server-wide move.

Why not back out:

- The port is done, tested, and behaves the same live and in the demo.
- It's walled off behind `toProvider`, so the rest of the server pays nothing for it except startup.
- Effect's strongest features weren't tested by this spike: structured concurrency, interruption, `Scope`d resources and timeouts. Those are exactly what the hand-rolled code in `previews.ts` and `manager.ts` reimplements with `AbortController`s, timers, `killTree` and `try`/`finally`.

### Rough migration path

1. **Merge this spike** (`server/github/` on Effect, Promise adapter at the edge). Add `@effect/language-service` to typecheck, plus the CLAUDE.md guidance above, if we go past step 2.
2. **Next spike: `previews.ts`.** It starts and stops dev servers: a detached process tree per preview, a stop command, polling for a URL, a grace period, then `SIGKILL`, plus log files.
   - *Gain:* each preview becomes a `Scope`. `Effect.acquireRelease` ties the process tree to it, so cleanup on stop, failure or shutdown is guaranteed by construction rather than by bookkeeping. Polling becomes a `Schedule`, timeouts become `Effect.timeout`, and it gets tests with `TestClock` instead of real sleeps.
   - *Risk:* it shells out on purpose (`&&`, `npm.cmd` on Windows), and process-group killing is platform-specific. That logic moves rather than disappears.
   - *Decide after this spike:* if `previews.ts` doesn't come out clearly simpler and safer, stop at partial adoption.
3. **Then the agent lifecycle in `manager.ts`:** hire → queue → worktree → run → commit nudge → push → PR, with messages and approvals. Do this once `GitHub` consumers can use the Effect service directly, and delete the adapter calls one by one.
   - *Gain:* a per-room concurrency limit (`Semaphore`), interruption that really stops an agent's run and its children, and typed failures from GitHub and git that can drive what happens next (retry on `GhTimedOut`, ask the human on `GhNotAuthenticated`).
   - *Risk:* this is the largest and most stateful file. The Claude Agent SDK is Promise and async-iterator based, so it would sit behind its own adapter (`Stream.fromAsyncIterable`). A partial port here would mix Promise and Effect styles in one file, which is worse than either.
   - *Done.* `manager.ts` runs on Effect inside and keeps Promise-based methods for `focus.ts` and the routes, the way `Previews` does, and uses `GitHub` directly. Running each agent's work as a fiber, run only if that agent has none, made a double launch on resume impossible by construction rather than by a status check, and a Claude Code turn as a scoped resource means sending an agent home stops the session. The SDK's message loop stayed in `claudeRunner.ts` behind the `AgentRunner` interface; wrapping it in a `Stream` gained nothing.
4. **`util.ts` primitives** (`KeyedLock`, `sleep`, `run()`) go when their last caller moves. `KeyedLock` becomes a keyed `Semaphore`, and `run()` folds into a generalised `runner.ts`.
5. **Leave alone:** `client/`, `shared/` (plain types and pure functions), the pure decision code (QA verdicts, prompts), and zod at the SDK tool boundary.

### Measuring it

Effect is meant for the files that do I/O, not for every file. Decisions stay plain: pure functions, or XState machines stepped with the pure `transition` (`runMachine.ts`, the journals). The scorecard's Effect section counts it that way. It shows the share of the server's I/O files on Effect, the I/O files still on Promises (some stay on purpose, like the Claude Agent SDK's loop in `claudeRunner.ts`), and the `run*` edges. An earlier headline, the share of *all* server files on Effect, fell from 29% to 20% between 2026-10-12 and 2026-10-17 while no file left Effect. Four Effect files had moved into `plugins/`, and every pure module or machine added since grew the total.
