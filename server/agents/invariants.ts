// Two rules every part of Focus that keeps state should hold, checked by running it, not by reading it
// (docs/invariants.md). They come from the bug corpus: most bugs that got past review here broke one of them.
//
// - **A restart is atomic.** Stop Focus in the middle of anything (or between things) and start it again from what
//   it kept: what it then settles to is what it would have been had that action never started, or had it finished.
//   Never a half-done third thing (a diagram left "being drawn again", a hold the shutdown let go).
// - **At once is one after the other.** Two actions at once end as one of them then the other would have, in either
//   order. Never both taking effect where one would refuse (a draft filed twice) or one undoing the other's result
//   (a forgotten diagram brought back).
//
// A part describes itself as a `Subject`: how to start one, the actions it can take, what of it must survive, and how
// to stop it and start it again on what it kept. It knows nothing of the rules. fast-check picks the actions, and its
// scheduler picks the order the part's own async work finishes in (a model answering, GitHub, a write), which the part
// hands to `later`. A failure prints the seed and the shortest sequence that breaks the rule.
import fc from 'fast-check';
import { isDeepStrictEqual } from 'node:util';

/** Defers a part's own async work (a model answering, a request to GitHub), so the harness decides when it finishes;
 *  outside the harness, it runs at once. `work` is what happens out there, its result what the part hears back. */
export type Later = <T>(label: string, work: () => Promise<T>) => Promise<T>;

export const now: Later = (_label, work) => work();

/** One thing the part can be asked to do, or that can happen to it. It may refuse (throw): that's an answer too. */
export interface Action {
  name: string;
  run: () => unknown;
}

/** A part of Focus, running. */
export interface Running<D> {
  /** What it can do now: picked by position, so the same state offers the same list. */
  actions(): Action[];
  /** What of it must survive, as plain data: compared by value. */
  durable(): D;
  /** Until nothing it started is still going (beyond what's waiting on `later`). */
  settle(): Promise<void>;
  /** Focus going down (Ctrl-C, an update), maybe in the middle of an action, and starting again on what it kept,
   *  its async work deferred through `later` in its new life. */
  restart(later: Later): Running<D> | Promise<Running<D>>;
  /** Puts it away once the harness is done with it (its timers, what it listens to), so runs don't hear each other. */
  close?(): void;
}

export interface Subject<D> {
  name: string;
  /** A fresh one, its async work deferred through `later`. */
  start(later: Later): Running<D> | Promise<Running<D>>;
}

export interface CheckOptions {
  /** How many random runs (default 25). */
  runs?: number;
  /** fast-check's seed; the test seed (FOCUS_TEST_SEED) by default, so a run fails the same way every time. */
  seed?: number;
  /** Most actions taken before the one under test (default 4). */
  prefix?: number;
  /** fast-check's path to one failing run, as a failure prints it: replays that run alone. */
  path?: string;
}

/** Where a restart falls in the action under test: mostly where restarts break things (between actions, just after it
 *  starts, after its first deferred step), sometimes deeper in. */
const cuts = fc.oneof({ arbitrary: fc.constantFrom(-1, 0, 1), weight: 3 }, { arbitrary: fc.integer({ min: 2, max: 6 }), weight: 1 });

/** `FOCUS_INVARIANT_RUNS` multiplies every check's runs, for a longer soak than the everyday suite can afford: the
 *  interleavings that break a part are rare draws. */
const soak = Math.max(1, Number(process.env.FOCUS_INVARIANT_RUNS ?? 1) || 1);

const settings = (o: CheckOptions) => ({ numRuns: (o.runs ?? 25) * soak, seed: o.seed ?? Number(process.env.FOCUS_TEST_SEED ?? 1), endOnFailure: true, includeErrorInReport: true, ...(o.path && { path: o.path }) });

/** What came of taking an action: its name, and whether it refused (threw), which leaves the state as it was. */
interface Taken {
  name?: string;
  refused: boolean;
}

/** Takes the action at `pick` (modulo how many there are), if there is one; its refusal is an answer, not a failure.
 *  An action of a life that's over by the time it would run (`alive.now` false) never runs: that Focus is gone. */
async function take<D>(running: Running<D>, pick: number, alive = { now: true }): Promise<Taken> {
  const actions = running.actions();
  const action = actions[pick % Math.max(actions.length, 1)];
  if (!action) return { refused: true };
  return Promise.resolve()
    .then(() => (alive.now ? action.run() : new Promise<never>(() => undefined)))
    .then(
      () => ({ name: action.name, refused: false }),
      () => ({ name: action.name, refused: true }),
    );
}

/** The state a run settles to, every action finishing before the next starts: the prefix by position, then `named`
 *  by name (the actions under test, as they were offered when they were taken: the list can reorder in between). */
async function inTurn<D>(subject: Subject<D>, picks: number[], named: string[] = []): Promise<{ state: D; names: (string | undefined)[] }> {
  const running = await subject.start(now);
  // what the part does as it starts (Focus starting does work of its own) settles first, as a restart's does
  await running.settle();
  const names: (string | undefined)[] = [];
  for (const pick of picks) {
    names.push((await take(running, pick)).name);
    await running.settle();
  }
  for (const name of named) {
    const at = running.actions().findIndex((a) => a.name === name);
    // gone by then (the other one removed it): taking it then would have been refused
    if (at >= 0) await take(running, at);
    await running.settle();
  }
  const state = running.durable();
  running.close?.();
  return { state, names };
}

/** A turn of the event loop: what an action starts reaches the scheduler a few microtasks after it's called. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Whether the part hands the scheduler a deferred step soon (a tenth of a second at most): its async work can take
 *  many turns of the event loop, and a timer or two, before it gets that far. */
async function deferredSoon(s: fc.Scheduler): Promise<boolean> {
  for (let i = 0; i < 50 && !s.count(); i++) await tick();
  for (let i = 0; i < 20 && !s.count(); i++) await new Promise((r) => setTimeout(r, 5));
  return s.count() > 0;
}

/** Lets the scheduler finish everything waiting on it, and the part settle, until `pending` (what's being waited for,
 *  if anything) is over and nothing's left waiting. */
async function drain<D>(s: fc.Scheduler, running: Running<D>, pending?: Promise<unknown>): Promise<void> {
  let over = !pending;
  void pending?.finally(() => (over = true));
  for (let i = 0; i < 1000; i++) {
    await tick();
    if (s.count()) {
      await s.waitAll();
      continue;
    }
    await running.settle();
    await tick();
    if (over && !s.count()) return;
  }
  throw new Error('never settled: an action is waiting on something nothing will finish');
}

/**
 * `later` through the scheduler, for one life of the part. When that life ends with work still out (`alive.now` false),
 * what happens to it was settled as Focus went down: it landed out there (`alive.landed`: a comment it asked
 * GitHub for went up) or it was lost on the way, and either way Focus never hears back. The dangerous case for a
 * restart is a request that landed with nobody left to record it.
 */
const deferred =
  (s: fc.Scheduler, alive = { now: true, landed: false }): Later =>
  (label, work) =>
    s.schedule(Promise.resolve(label), label).then(() => {
      if (alive.now) return work();
      if (alive.landed) void work().catch(() => undefined);
      return new Promise<never>(() => undefined);
    });

/** Why a state isn't one of those allowed, for the failure message. */
const notOneOf = (what: string, got: unknown, allowed: Record<string, unknown>) =>
  `${what}: settled to ${JSON.stringify(got)}\n${Object.entries(allowed)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n')}`;

/**
 * A restart is atomic: a prefix of actions, then one more started and Focus stopped after `cut` of the part's
 * deferred steps (none, some, or all of them), or between actions, then started again on what it kept, and a few more
 * actions taken: it settles to the state it would have without that action, or with it finished, then those actions.
 */
export async function checkRestart<D>(subject: Subject<D>, options: CheckOptions = {}): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), fc.array(fc.nat(), { maxLength: options.prefix ?? 4 }), fc.nat(), cuts, fc.boolean(), fc.array(fc.nat(), { maxLength: 2 }), async (s, prefix, pick, cut, lands, after) => {
      const life = { now: true, landed: false };
      const running = await subject.start(deferred(s, life));
      for (const p of prefix) await drain(s, running, take(running, p));
      // the action under test, started and left going: `cut` of its deferred steps finish before Focus goes down
      // (-1: it never starts, Focus going down between actions)
      const name = cut < 0 ? undefined : running.actions()[pick % Math.max(running.actions().length, 1)]?.name;
      if (cut >= 0) {
        void take(running, pick, life);
        // each cut lets one deferred step finish, once the action has got as far as deferring one
        for (let i = 0; i < cut && (await deferredSoon(s)); i++) await s.waitOne();
        await tick();
      }
      // Focus goes down: what it had out either lands now, unheard, or is lost; then it starts again
      life.now = false;
      if (lands) {
        life.landed = true;
        if (s.count()) await s.waitAll();
        await tick();
      }
      const again = await running.restart(deferred(s));
      await drain(s, again);
      const settled = again.durable();
      // and what happens next: a restart that loses work can look the same until something should have followed on
      for (const p of after) await drain(s, again, take(again, p));
      const got = again.durable();
      again.close?.();
      // just after the restart, and after what followed it: a half-done state the next action happens to clear is
      // still half-done, and lost work only shows in what follows
      for (const then of after.length ? [[], after] : [[]]) {
        const never = await inTurn(subject, [...prefix, ...then]);
        const done = cut < 0 ? never : await inTurn(subject, [...prefix, pick, ...then]);
        const state = then.length ? got : settled;
        const before = never.names.slice(0, prefix.length).join(', ');
        const next = then.length ? `, then [${never.names.slice(prefix.length).join(', ')}]` : '';
        if (!isDeepStrictEqual(state, never.state) && !isDeepStrictEqual(state, done.state))
          throw new Error(notOneOf(`${subject.name}: restarted during "${name ?? 'nothing'}" after [${before}]${next}`, state, { 'never started': never.state, finished: done.state }));
      }
    }),
    settings(options),
  );
}

/**
 * At once is one after the other: after a prefix, two actions started together settle as one then the other would, in
 * either order. One that refused (threw) counts as never taken; one that said it was done must have taken effect.
 */
export async function checkAtOnce<D>(subject: Subject<D>, options: CheckOptions = {}): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), fc.array(fc.nat(), { maxLength: options.prefix ?? 4 }), fc.nat(), fc.nat(), async (s, prefix, a, b) => {
      const running = await subject.start(deferred(s));
      for (const p of prefix) await drain(s, running, take(running, p));
      const both = Promise.all([take(running, a), take(running, b)]);
      await drain(s, running, both);
      const [first, second] = await both;
      const got = running.durable();
      running.close?.();
      const kept = [first, second].map((t) => (t.refused || !t.name ? [] : [t.name]));
      const ab = await inTurn(subject, prefix, [...kept[0], ...kept[1]]);
      const ba = await inTurn(subject, prefix, [...kept[1], ...kept[0]]);
      const said = (t: Taken) => `"${t.name ?? 'nothing'}"${t.refused ? ' (refused)' : ''}`;
      if (!isDeepStrictEqual(got, ab.state) && !isDeepStrictEqual(got, ba.state))
        throw new Error(notOneOf(`${subject.name}: ${said(first)} and ${said(second)} at once after [${ab.names.join(', ')}]`, got, { 'one then the other': ab.state, 'the other then the one': ba.state }));
    }),
    settings(options),
  );
}
