// Two rules every part of the office that keeps state should hold, checked by running it, not by reading it
// (docs/invariants.md). They come from the bug corpus: most bugs that got past review here broke one of them.
//
// - **A restart is atomic.** Stop the office in the middle of anything (or between things) and start it again from what
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

/** Defers a part's own async work, so the harness decides when it finishes; outside the harness, it runs at once. */
export type Later = <T>(label: string, work: () => Promise<T>) => Promise<T>;

export const now: Later = (_label, work) => work();

/** One thing the part can be asked to do, or that can happen to it. It may refuse (throw): that's an answer too. */
export interface Action {
  name: string;
  run: () => unknown;
}

/** A part of the office, running. */
export interface Running<D> {
  /** What it can do now: picked by position, so the same state offers the same list. */
  actions(): Action[];
  /** What of it must survive, as plain data: compared by value. */
  durable(): D;
  /** Until nothing it started is still going (beyond what's waiting on `later`). */
  settle(): Promise<void>;
  /** The office going down (Ctrl-C, an update), maybe in the middle of an action, and starting again on what it kept,
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

const settings = (o: CheckOptions) => ({ numRuns: o.runs ?? 25, seed: o.seed ?? Number(process.env.FOCUS_TEST_SEED ?? 1), endOnFailure: true, includeErrorInReport: true, ...(o.path && { path: o.path }) });

/** What came of taking an action: its name, and whether it refused (threw), which leaves the state as it was. */
interface Taken {
  name?: string;
  refused: boolean;
}

/** Takes the action at `pick` (modulo how many there are), if there is one; its refusal is an answer, not a failure.
 *  An action of a life that's over by the time it would run (`alive.now` false) never runs: that office is gone. */
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

/** `later` through the scheduler, for one life of the part: once that life is over (`alive.now` false), what it left
 *  waiting never finishes, as the work of an office that went down doesn't. */
const deferred =
  (s: fc.Scheduler, alive = { now: true }): Later =>
  (label, work) =>
    s.schedule(Promise.resolve(label), label).then(() => (alive.now ? work() : new Promise<never>(() => undefined)));

/** Why a state isn't one of those allowed, for the failure message. */
const notOneOf = (what: string, got: unknown, allowed: Record<string, unknown>) =>
  `${what}: settled to ${JSON.stringify(got)}\n${Object.entries(allowed)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n')}`;

/**
 * A restart is atomic: a prefix of actions, then one more started and the office stopped after `cut` of the part's
 * deferred steps (none, some, or all of them), or between actions, then started again on what it kept: it settles to
 * the state it would have without that action, or with it finished.
 */
export async function checkRestart<D>(subject: Subject<D>, options: CheckOptions = {}): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), fc.array(fc.nat(), { maxLength: options.prefix ?? 4 }), fc.nat(), fc.integer({ min: -1, max: 6 }), async (s, prefix, pick, cut) => {
      const life = { now: true };
      const running = await subject.start(deferred(s, life));
      for (const p of prefix) await drain(s, running, take(running, p));
      // the action under test, started and left going: `cut` of its deferred steps finish before the office goes down
      // (-1: it never starts, the office going down between actions)
      const name = cut < 0 ? undefined : running.actions()[pick % Math.max(running.actions().length, 1)]?.name;
      if (cut >= 0) {
        void take(running, pick, life);
        await tick();
        for (let i = 0; i < cut && s.count(); i++) {
          await s.waitOne();
          await tick();
        }
      }
      life.now = false;
      const again = await running.restart(deferred(s));
      await drain(s, again);
      const got = again.durable();
      again.close?.();
      const never = await inTurn(subject, prefix);
      const done = cut < 0 ? never : await inTurn(subject, [...prefix, pick]);
      if (!isDeepStrictEqual(got, never.state) && !isDeepStrictEqual(got, done.state))
        throw new Error(notOneOf(`${subject.name}: restarted during "${name ?? 'nothing'}" after [${never.names.join(', ')}]`, got, { 'never started': never.state, finished: done.state }));
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
