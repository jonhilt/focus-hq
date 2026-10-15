// What each part of the scorecard means, in plain words, for wherever it's explained: the engineering panel opens a
// number to show its `what` and `why` (plugins/scorecard/README.md).
import type { ScorecardSection } from './types';

export interface SectionAbout {
  /** The question the section answers, short enough for a tile. */
  question: string;
  /** What it covers and why it's worth watching, a sentence or two. */
  about: string;
}

export const SECTION_ABOUT: Record<ScorecardSection, SectionAbout> = {
  gate: {
    question: 'Does every check pass, and how long is the wait?',
    about: 'Typecheck, lint, the unit tests and the build: what every pull request has to clear. Agents and QA wait on it every round, so its time is the office’s pace.',
  },
  fence: {
    question: 'Where does the code step around the type checker?',
    about: 'Each of these is a place where TypeScript takes the code’s word for it instead of checking, so a bug can get past it. Counted outside tests, in server, shared, client and scripts.',
  },
  effect: {
    question: 'How far is the server onto Effect?',
    about: 'Effect makes the server’s errors, retries and clean-up explicit in its types. The edges are where it hands over to Promise code: the fewer, the more of the server speaks Effect end to end.',
  },
  tests: {
    question: 'How much code is risky to change?',
    about: 'How many tests there are, and how much of the server and shared code is too complex for how little the tests cover it (its CRAP score).',
  },
  office: {
    question: 'How smoothly does work get merged?',
    about: 'From the ledger, over the last 30 days: how often QA passes first time, what got merged without it, and what each merge cost in money and wasted effort.',
  },
};

export interface MetricAbout {
  /** A few words for it beside its value, in a list: `128 non-null`. */
  short: string;
  /** What it counts. */
  what: string;
  /** Why it matters, and how it comes down (or up). */
  why: string;
}

export const METRIC_ABOUT: Record<string, MetricAbout> = {
  'gate.pass': {
    short: 'gate',
    what: 'Whether typecheck, lint, the unit tests and the build all passed.',
    why: 'A red gate blocks every merge: fix it before anything else.',
  },
  'gate.seconds': {
    short: 'gate',
    what: 'The four steps’ times added up.',
    why: 'Every agent runs it before shipping and QA runs it every round, so a slower gate slows the whole office. Timings wobble, so it only counts as a change past 10%.',
  },
  'typecheck.seconds': {
    short: 'typecheck',
    what: 'How long tsc and the Effect language service take.',
    why: 'Usually the slowest step, and agents run it after every change.',
  },
  'typecheck.errors': {
    short: 'typecheck errors',
    what: 'tsc’s errors plus the Effect language service’s (a floating Effect, say).',
    why: 'Should be 0: any error fails the gate.',
  },
  'lint.seconds': { short: 'lint', what: 'How long ESLint takes, with its type-aware rules.', why: 'Part of every gate run.' },
  'lint.errors': { short: 'lint errors', what: 'ESLint’s errors.', why: 'Should be 0: any error fails the gate.' },
  'lint.warnings': {
    short: 'lint warnings',
    what: 'ESLint’s warnings.',
    why: 'They don’t fail the gate, but they pile up into noise that hides the next real one.',
  },
  'test.seconds': {
    short: 'tests',
    what: 'How long the unit tests take, run once with coverage (the CRAP numbers come from the same run).',
    why: 'Part of every gate run; coverage makes it a little slower than a plain `pnpm test`.',
  },
  'test.failed': { short: 'tests failing', what: 'Unit tests that failed.', why: 'Should be 0: any failure fails the gate.' },
  'build.seconds': { short: 'build', what: 'How long the Vite build of the client takes.', why: 'Part of every gate run.' },

  'fence.typeAssertions': {
    short: 'type assertions',
    what: 'Casts, `as T` and `<T>x` (but not `as const`), outside tests.',
    why: 'A cast tells TypeScript to trust you: if the value isn’t really a T, the bug turns up at runtime instead. Decoding with a schema, or narrowing with a check, removes one.',
  },
  'fence.nonNull': {
    short: 'non-null',
    what: 'Non-null assertions, `x!`: telling TypeScript a value can’t be null or undefined.',
    why: 'When it is, the code crashes somewhere far from the cause. A check, or a type that can’t be missing, removes one.',
  },
  'fence.explicitAny': {
    short: 'any',
    what: '`any` written out.',
    why: 'It switches type checking off for everything it touches.',
  },
  'fence.lintDisables': {
    short: 'eslint-disable',
    what: '`eslint-disable` comments.',
    why: 'Each one silences a rule the code is meant to follow.',
  },
  'fence.tsSuppressions': {
    short: 'ts-ignore',
    what: '`@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` comments.',
    why: 'Each one hides a type error instead of fixing it.',
  },

  'effect.files': { short: 'files on Effect', what: 'Server files that import Effect (demo code left out).', why: 'The migration’s progress, as a count.' },
  'effect.share': {
    short: 'of the server',
    what: 'Server files that import Effect, as a share of all the server’s files (demo code left out).',
    why: 'The migration’s progress: docs/effect-assessment.md has the path.',
  },
  'effect.runs': {
    short: 'run* edges',
    what: 'Calls that run an Effect: `runPromise`, `runFork`, `runSync`, `runCallback` and their `…Exit` forms.',
    why: 'Each is a seam where Effect hands over to Promise code, and its typed errors and interruption stop. Fewer means more of the server is Effect end to end.',
  },
  'effect.runFiles': { short: 'files with edges', what: 'Server files with at least one of those calls.', why: 'How spread out the seams are.' },
  'effect.machines': { short: 'XState machines', what: 'XState machines in the server.', why: 'Counted, not judged: neither more nor fewer is better.' },

  'tests.total': {
    short: 'tests',
    what: 'Unit tests (vitest).',
    why: 'More behaviour pinned down, as long as each test checks what the code does rather than just running it.',
  },
  'tests.files': { short: 'test files', what: 'Unit test files.', why: 'How much of the code has tests beside it.' },
  'tests.propertyFiles': {
    short: 'property test files',
    what: 'Test files that use property tests (fast-check).',
    why: 'A property test tries hundreds of generated inputs, so it finds the edge cases example tests miss.',
  },
  'crap.over': {
    short: 'over CRAP 30',
    what: 'Functions in server and shared with a CRAP score over 30: too complex for how little the tests cover them.',
    why: 'They’re the riskiest to change. Split one into small pure functions, or test it, and it drops (plugins/scorecard/crap.md).',
  },
  'crap.total': {
    short: 'total CRAP',
    what: 'Every server and shared function’s CRAP score, added up.',
    why: 'The overall risk, which moves even when no function crosses 30.',
  },

  'office.merged': {
    short: 'merged',
    what: 'Pull requests merged in the last 30 days.',
    why: 'Neither more nor fewer is better on its own: it’s the scale the rest are read against.',
  },
  'office.firstTime': {
    short: 'QA passed first time',
    what: 'Merged pull requests that QA passed on their first round.',
    why: 'High means agents get it right first go; low means rework rounds and waiting.',
  },
  'office.roundsPerMerge': {
    short: 'failed QA rounds per merge',
    what: 'QA rounds that failed, per pull request merged.',
    why: 'Each failed round is a fix session and another wait for QA.',
  },
  'office.mergedUnpassed': {
    short: 'merged without QA',
    what: 'Pull requests merged when QA hadn’t passed their last commit: merged by hand, or after QA went stale.',
    why: 'Each one skipped the safety net.',
  },
  'office.conflictsForAgent': {
    short: 'conflicts for an agent',
    what: 'Pull requests whose merge conflicts an agent had to resolve, rather than the office merging them cleanly.',
    why: 'Each costs a session, and usually means two pieces of work kept editing the same files.',
  },
  'office.checksSentBack': {
    short: 'checks sent back',
    what: 'Pull requests sent back to their developer because GitHub’s checks still failed after a re-run.',
    why: 'CI catching what the gate on the agent’s machine didn’t.',
  },
  'office.costPerMerge': {
    short: 'per merge',
    what: 'What the agents’ sessions cost in Claude usage, divided by the pull requests merged.',
    why: 'What a change costs, all in: rework, QA rounds and dead ends included.',
  },
  'office.wastedPerMerge': {
    short: 'wasted calls per merge',
    what: 'Tool calls that failed, or were run again unchanged, per pull request merged.',
    why: 'Time and money spent on nothing. The retro reads the frictions behind them.',
  },
  'office.fixesStopped': {
    short: 'retro fixes that worked',
    what: 'Retro fixes whose frictions haven’t come up since the fix landed.',
    why: 'Whether the retro is working, not just drafting.',
  },
  'office.patterns': {
    short: 'open friction patterns',
    what: 'Frictions that came up in 3 or more agent sessions in 14 days, with no retro decision on them yet.',
    why: 'Each is trouble that keeps coming back: what the next retro turns into issues.',
  },
};

/** A number's explanation; one the office doesn't know yet (a scorecard newer than the browser) gets its label alone. */
export const aboutMetric = (key: string, label: string): MetricAbout => METRIC_ABOUT[key] ?? { short: label, what: label, why: '' };
