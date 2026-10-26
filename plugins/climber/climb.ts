// Main engineering's climber (README.md), after ratstack's hill-climb prompt: each climb measures Focus with the
// scorecard, takes the worst gap, fixes it, proves the fix with the same numbers, and ships one pull request. Its brief,
// its log and its pull request; what to do next is climbRules.ts'. Pure: the manager's Climbs part seats the climbing
// engineer and does the bookkeeping.
import type { Agent, LedgerEvent, PastPullRequest } from '../../plugin-api/server';
import { frictionGroups, OPEN_FRICTION_DAYS } from '../../plugin-api/shared';
import type { Scorecard, ScorecardNoise, ScorecardService } from '../scorecard/api';
import { gapScore, ranked } from './climbRules';
import type { ClimbEnd } from './shared';

/** How far one sweep goes (the brief's step 2): enough to be worth its pull request, few enough to review as one. */
export const SWEEP_PLACES = 6;
export const SWEEP_LINES = 400;

/** What the climber is told in their system prompt: how a climb goes, and what they never do. */
export const CLIMB_ASSIGNMENT =
  'You are main engineering\'s climber. Your job is to move Focus, the ship you serve on, one change at a time towards its ' +
  'own standard: its CLAUDE.md and docs, Effect v4 done properly, honest types, and a fence of checks that makes the easy ' +
  'path the right one. This climb is one change, measured before and after: one gap, or a sweep of one kind of fix ' +
  'across several places.';

export const CLIMB_SUMMARY =
  'Your final message becomes the pull request: its first line is `# ` and the title (imperative, under 70 characters), ' +
  'then six sections: **Shortlist** (your scored table from step 2, as you wrote it), ' +
  '**Hypothesis** (as you wrote it before changing anything, with its `Target:` line, and whether it held), ' +
  '**Problem** (what was wrong, with the evidence), **Solution** (what changed, and why this way; for a sweep, each place ' +
  'it changed), ' +
  '**Before** and **After** (the scorecard\'s numbers and anything else you measured, measured the same way both times). ' +
  'Then, if you skipped anything that needs the maintainer\'s sign-off, a **Needs your sign-off** list. No preamble.';

/** An accepted retro issue still waiting for its fix: the climber can take one as their gap. */
export interface RetroIssue {
  number: number;
  title: string;
}

/** The accepted retro drafts filed in `repo` that no merged pull request has closed yet, oldest first. */
export function openRetroIssues(events: LedgerEvent[], repo: string): RetroIssue[] {
  const closed = new Set(events.flatMap((e) => (e.kind === 'merged' && e.repo === repo ? e.closes ?? [] : [])));
  return events.flatMap((e) =>
    e.kind === 'retro-decision' && e.accepted && e.issue?.repo === repo && !closed.has(e.issue.number) ? [{ number: e.issue.number, title: e.title }] : []);
}

/** A section of a pull request's body, by its heading (`## Problem` or `**Problem**`), up to the next heading. */
export function section(body: string, name: string): string | undefined {
  const lines = body.split('\n');
  const heading = (line: string) => /^(#{1,4}\s+.+|\*\*[^*]+\*\*:?\s*)$/.test(line.trim());
  const start = lines.findIndex((l) => heading(l) && l.replace(/[#*:]/g, '').trim().toLowerCase() === name.toLowerCase());
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && heading(l));
  const text = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return text || undefined;
}

/** The number a climb set out to move, from its hypothesis' `Target: fence.typeAssertions 226 → 220` line. */
export interface ClimbTarget {
  key: string;
  before: number;
  after: number;
}

export function climbTarget(body: string): ClimbTarget | undefined {
  const m = /Target:\**\s*`?([\w.]+)`?\s*:?\s+(-?[\d.,]+)\s*(?:→|->)\s*(-?[\d.,]+)/.exec(body);
  const num = (s: string) => Number(s.replaceAll(',', ''));
  return m && Number.isFinite(num(m[2])) && Number.isFinite(num(m[3])) ? { key: m[1], before: num(m[2]), after: num(m[3]) } : undefined;
}

/** Comments Ops posts itself on a pull request: QA's reports, and the operations officer closing one. */
const OPS_COMMENT = /^(## 🔍 QA|🧭 )/;

/**
 * What people said on a climb's pull request, in their own words: the captain's comments (`captain` is Focus's
 * GitHub login, which also posts Ops' own reports, told apart by how they start), never a bot's.
 */
export function ownWords(comments: PastPullRequest['comments'], captain: string | undefined): string[] {
  return comments
    .filter((c) => !OPS_COMMENT.test(c.body.trim()) && !c.body.trim().startsWith('<!--') && (captain ? c.author === captain : !/bot\b|\[bot\]/i.test(c.author)))
    .map((c) => c.body.trim())
    .filter(Boolean);
}

/** One gap on a climb's shortlist, scored as step 2 of the brief asks. */
export interface ShortlistEntry {
  gap: string;
  /** Harm to the captain and Focus, 1 to 5. */
  harm: number;
  /** How far the code is from its standard, 1 to 5. */
  distance: number;
  size: 'S' | 'M' | 'L';
}

/** The shortlist table from a climb's pull request (`| # | Gap | Harm | Distance | Size | Score |`), best first. */
export function shortlistOf(body: string): ShortlistEntry[] {
  const table = section(body, 'Shortlist');
  if (!table) return [];
  const rows = table.split('\n').filter((l) => l.trim().startsWith('|')).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const header = rows[0]?.map((c) => c.toLowerCase()) ?? [];
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const [gap, harm, distance, size] = [col('gap'), col('harm'), col('distance'), col('size')];
  if ([gap, harm, distance, size].some((i) => i < 0)) return [];
  const entries = rows.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c))).flatMap((r): ShortlistEntry[] => {
    const h = Number(r[harm]);
    const d = Number(r[distance]);
    const z = r[size]?.toUpperCase().charAt(0);
    return r[gap] && Number.isFinite(h) && Number.isFinite(d) && (z === 'S' || z === 'M' || z === 'L') ? [{ gap: r[gap], harm: h, distance: d, size: z }] : [];
  });
  return ranked(entries);
}

/** One climb, as the next climb's brief remembers it. */
export interface ClimbRecord {
  at: number;
  pr?: number;
  title?: string;
  outcome: 'open' | 'merged' | 'closed' | 'nothing' | 'failed';
  hypothesis?: string;
  target?: ClimbTarget;
  /** The captain's own words on it. */
  words: string[];
  /** What else was on its shortlist, best first: the gaps it passed over. */
  passedOver?: ShortlistEntry[];
  /** For a merged climb with a target: whether main has held the gain since (from scorecards measured after it merged). */
  since?: { held: boolean; now: number; shown: string; label: string };
}

/** Main's scorecards, the latest last, and the scorecard's reading of a number (what the scorecard plugin provides). */
export type MainScorecards = Pick<ScorecardService, 'direction' | 'formatValue'> & { history: Scorecard[] };

const firstSentences = (text: string, max = 240) => {
  const flat = text.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Whether a merged climb's gain has held on main: the target number on the latest clean main scorecard measured after it merged. */
export function heldSince(target: ClimbTarget, mergedAt: number, main: MainScorecards): ClimbRecord['since'] {
  const card = main.history.filter((c) => c.branch === 'main' && !c.dirty && c.at > mergedAt).at(-1);
  const metric = card?.metrics.find((m) => m.key === target.key);
  if (!metric) return undefined;
  return { held: main.direction(metric, target.after) !== 'worse', now: metric.value, shown: main.formatValue(metric.value, metric.format), label: metric.label };
}

/** Every climb so far, newest first: the pull requests on GitHub, and the climbs that ended without one. */
export function climbLog(prs: PastPullRequest[], ends: ClimbEnd[], captain: string | undefined, main?: MainScorecards): ClimbRecord[] {
  const fromPrs = prs.map((p): ClimbRecord => {
    const at = Date.parse(p.closedAt ?? p.createdAt);
    const hypothesis = section(p.body, 'Hypothesis');
    const target = climbTarget(hypothesis ?? p.body);
    const outcome = p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : 'open';
    return {
      at,
      pr: p.number,
      title: p.title,
      outcome,
      hypothesis: firstSentences(hypothesis ?? section(p.body, 'Problem') ?? p.body),
      target,
      words: ownWords(p.comments, captain),
      // the top of the shortlist is the one it took
      passedOver: shortlistOf(p.body).slice(1, 5),
      since: outcome === 'merged' && target && main ? heldSince(target, at, main) : undefined,
    };
  });
  const fromEnds = ends.map((e): ClimbRecord => ({ at: e.at, outcome: e.outcome, hypothesis: e.why, words: [] }));
  return [...fromPrs, ...fromEnds].sort((a, b) => b.at - a.at);
}

const OUTCOME_WORDS: Record<ClimbRecord['outcome'], string> = {
  open: 'still open', merged: 'merged', closed: 'CLOSED UNMERGED by the captain', nothing: 'found nothing to change', failed: 'failed or was stopped',
};

/** The log as the brief lists it: the rejected ones in full, the rest a line each. */
export function climbLogText(log: ClimbRecord[], limit = 25): string {
  return log.slice(0, limit).map((r) => {
    const day = new Date(r.at).toISOString().slice(0, 10);
    const head = `- ${day} ${r.pr ? `#${r.pr} ${r.title ?? ''} ` : ''}(${OUTCOME_WORDS[r.outcome]})`;
    const lines = [head];
    if (r.hypothesis) lines.push(`  ${r.pr ? 'Hypothesis' : 'Why'}: ${r.hypothesis}`);
    if (r.target) lines.push(`  Target: ${r.target.key} ${r.target.before} → ${r.target.after}`);
    if (r.since) lines.push(`  On main since: ${r.since.label} is ${r.since.shown}, ${r.since.held ? 'held' : 'SLIPPED back past the target'}`);
    for (const w of r.words) lines.push(`  The captain said: “${firstSentences(w, 400)}”`);
    if (r.passedOver?.length) lines.push(`  Passed over: ${r.passedOver.map((e) => `${firstSentences(e.gap, 100)} (${gapScore(e)})`).join('; ')}`);
    return lines.join('\n');
  }).join('\n');
}


/** The climb's first message: the evidence beyond the code (Focus's frictions, the retro's open issues) and the steps. */
export function climbBrief(agent: Pick<Agent, 'repo' | 'baseBranch' | 'branch'>, events: LedgerEvent[], now: number, log: ClimbRecord[] = [], noise?: ScorecardNoise): string {
  const frictions = frictionGroups(events, now, OPEN_FRICTION_DAYS).filter((g) => g.sessions >= 3).slice(0, 8);
  const issues = openRetroIssues(events, agent.repo);
  return [
    `Climb ${agent.repo} one step towards its standard. You're on \`${agent.branch}\`, fresh from \`${agent.baseBranch}\`.`,
    '',
    '## 0. What you\'ve climbed before',
    log.length
      ? `Every climb is yours, newest first. A merged one is done: don't redo it. A closed one was turned down: don't take its gap again unless your **Hypothesis** says what has changed since, answering the captain's words. A gain that SLIPPED on main is a gap worth taking. Most climbs took one place at a time because the brief used to ask for that; it doesn't now (see "Group before you score" in step 2), so their size is no guide to yours.\n${climbLogText(log)}`
      : 'This is your first climb.',
    '',
    '## 1. Measure',
    'Read CLAUDE.md and plugins/scorecard/README.md. Run `pnpm install` and then `pnpm run scorecard --no-save` before you change anything: its numbers are your **Before**. Every number you report must come from a command you ran, never from reading code by eye.',
    noise
      ? `Numbers wobble: the scorecard compares against a noise floor of ${noise.runs} runs on ${noise.commit.slice(0, 8)}, and marks a change ▲ or ▼ only past it. Claim a gain only where it does. What wobbled: ${noiseText(noise)}.`
      : 'There\'s no noise floor yet, so a time has to move more than 10% to count. If your target is a time, run `pnpm run scorecard --repeat 3 --no-save` for its spread first, and claim only a move past it.',
    'Times swing with the machine\'s load (other agents run beside you): if your target is a time, measure it interleaved, base and change taking turns on the same machine (at least 5 of each, the base in a worktree of its own), and compare medians.',
    '',
    '## 2. Rank',
    'Put every gap on one scale, then write a **Shortlist**: the 3 to 5 strongest, as a table, before you choose. Score each the same way: **Harm** to Focus and its users, 1 to 5 (5: it breaks or misleads Focus now; 1: cosmetic), **Distance** from the standard, 1 to 5, and **Size** S, M or L. Score = 2 × Harm + Distance; take the highest, the smaller on a tie, that fits in one reviewable pull request. A gap a closed climb took, with nothing changed since, scores Harm 0. Write it as `| # | Gap | Harm | Distance | Size | Score |`. The gaps include:',
    '- the scorecard\'s numbers: a gate that fails or is slow, type assertions and non-null assertions, the server\'s edges between Effect and Promise code, functions over CRAP 30, no property tests;',
    frictions.length
      ? `- Focus's open frictions: what got in the agents' way in 3 or more sessions in the last ${OPEN_FRICTION_DAYS} days, with no retro decision yet:\n${frictions.map((g) => `  - ${g.key} (${g.sessions} sessions)`).join('\n')}`
      : '- Focus\'s open frictions: none came up in 3 or more sessions lately;',
    issues.length
      ? `- the retro's accepted issues, still open in ${agent.repo} (if you take one, say \`Closes #n\` in the Solution):\n${issues.map((i) => `  - #${i.number} ${i.title}`).join('\n')}`
      : '- the retro\'s accepted issues: none are open.',
    `**Group before you score.** Run \`pnpm run crap --top 25\` and see where the fence's casts sit, then group the gaps that take the same fix: functions over CRAP 30 whose decisions can move into pure functions, casts one honest type would replace, untested decisions in one area. A kind of fix with 2 or more places goes on the shortlist as one row, a sweep, never a place at a time: name the kind of fix and its places, worst first, up to ${SWEEP_PLACES} places and about ${SWEEP_LINES} changed lines. Score a sweep by its worst place, with Harm one higher (up to 5) when it takes 3 or more places, since leaving the rest costs the next change; size it by the whole sweep. A row with one function over CRAP 30, while others over 30 could take the same fix, is the mistake this rule is here to stop.`,
    'Skip anything that needs the maintainer\'s sign-off (a dependency version, a change to how Ops merges or deploys, anything outside this repo) and list it at the end instead.',
    '',
    '## Hypothesis, before you change anything',
    'Write it down in your terminal now, and keep it as your pull request\'s **Hypothesis** section: which gap, why it\'s the top one, which scorecard number it will move, by how much, and what result would show you wrong. End it with one line, `Target: <metric key> <before> → <expected after>` (a key from `pnpm run scorecard --json`, like `Target: fence.typeAssertions 226 → 214`); Ops reads that line to check, on main, whether your gain holds. A gap the scorecard can\'t see still gets its nearest number, or `Target: none` and why.',
    '',
    '## 3. Fix',
    'If the bad pattern can come back, add a check first (a lint rule, a type, a test that guards it) and watch it fail. Then make the smallest coherent change. Plant a bug to prove each new test can fail, then take the bug out.',
    'In a sweep, give every place the same treatment, a test beside each new function, and plant a bug in each; one check can guard the whole kind. If a place turns out not to take the fix, leave it out and say why rather than bending the fix to it.',
    '',
    '## 4. Prove',
    'Lock your gain in first: `pnpm run fence:lower` and `pnpm run crap --lower` lower the ratchets\' baselines to where your change brought each file (the gate fails a file below its baseline), and commit them. Then run `pnpm run scorecard --no-save` again: it runs the whole gate (typecheck, lint, the tests, build) itself, so don\'t run the gate separately first. Its numbers are your **After**, and its gate must pass; while you work, run only the tests and checks your change touches. Say plainly whether your hypothesis held; a miss is worth reporting as it is. Update the docs the change touches.',
    '',
    '## Never',
    '- Pass `--no-verify`, or loosen a lint rule, check, diagnostic or test to make something pass.',
    '- Change a dependency version.',
    '- Mix two reasons in one pull request (a sweep is one reason, the same fix in each place; two kinds of fix are two reasons), or claim a number you didn\'t measure.',
    '',
    'If nothing is worth changing, commit nothing and say why in your final message.',
  ].join('\n');
}

/** The numbers that wobbled in a noise floor, each with its spread: `gate.seconds ±9.1, test.seconds ±6.0`. */
function noiseText(noise: ScorecardNoise): string {
  const moving = Object.entries(noise.spread).filter(([, s]) => s.max > s.min);
  return moving.length ? moving.map(([k, s]) => `${k} ±${+((s.max - s.min) / 2).toFixed(2)}`).join(', ') : 'nothing; every number held still';
}

/** A climb's pull request title and body, from the climber's final message (`# Title` on its first line). */
export function climbPullRequest(summary: string): { title: string; body: string } {
  const text = summary.trim();
  const first = /^#\s+(.+)\n?/.exec(text);
  if (!first) return { title: 'Climb: one step up the scorecard', body: text };
  return { title: first[1].trim().slice(0, 100), body: text.slice(first[0].length).trim() };
}
