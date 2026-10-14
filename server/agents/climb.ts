// Main engineering's climber (docs/climber.md), after ratstack's hill-climb prompt: each climb measures Focus with the
// scorecard, takes the worst gap, fixes it, proves the fix with the same numbers, and ships one pull request. Pure: the
// manager's Climbs part seats the climbing engineer and does the bookkeeping.
import { frictionGroups, type LedgerEvent } from '../../shared/ledger';
import { direction, formatValue } from '../../shared/scorecard';
import type { Agent, AgentStatus, Climb, ClimbEnd, Project, Scorecard, ScorecardNoise } from '../../shared/types';
import type { PastPullRequest } from '../github/provider';

const FINISHED: AgentStatus[] = ['done', 'error', 'stopped'];

/** What the climber is told in their system prompt: how a climb goes, and what they never do. */
export const CLIMB_ASSIGNMENT =
  'You are main engineering\'s climber. Your job is to move Focus, the office you work in, one change at a time towards its ' +
  'own standard: its CLAUDE.md and docs, Effect v4 done properly, honest types, and a fence of checks that makes the easy ' +
  'path the right one. This climb is one change, measured before and after.';

export const CLIMB_SUMMARY =
  'Your final message becomes the pull request: its first line is `# ` and the title (imperative, under 70 characters), ' +
  'then five sections: **Hypothesis** (as you wrote it before changing anything, with its `Target:` line, and whether it held), ' +
  '**Problem** (what was wrong, with the evidence), **Solution** (what changed, and why this way), ' +
  '**Before** and **After** (the scorecard\'s numbers and anything else you measured, measured the same way both times). ' +
  'Then, if you skipped anything that needs the captain\'s sign-off, a **Needs your sign-off** list. No preamble.';

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

/** Comments the office posts itself on a pull request: QA's reports, and the operations officer closing one. */
const OFFICE_COMMENT = /^(## 🔍 QA|🧭 )/;

/**
 * What people said on a climb's pull request, in their own words: the captain's comments (`captain` is the office's
 * GitHub login, which also posts the office's own reports, told apart by how they start), never a bot's.
 */
export function ownWords(comments: PastPullRequest['comments'], captain: string | undefined): string[] {
  return comments
    .filter((c) => !OFFICE_COMMENT.test(c.body.trim()) && !c.body.trim().startsWith('<!--') && (captain ? c.author === captain : !/bot\b|\[bot\]/i.test(c.author)))
    .map((c) => c.body.trim())
    .filter(Boolean);
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
  /** For a merged climb with a target: whether main has held the gain since (from scorecards measured after it merged). */
  since?: { held: boolean; now: number; label: string; format: Parameters<typeof formatValue>[1] };
}

const firstSentences = (text: string, max = 240) => {
  const flat = text.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Whether a merged climb's gain has held on main: the target number on the latest clean main scorecard measured after it merged. */
export function heldSince(target: ClimbTarget, mergedAt: number, main: Scorecard[], noise?: ScorecardNoise): ClimbRecord['since'] {
  const card = main.filter((c) => c.branch === 'main' && !c.dirty && c.at > mergedAt).at(-1);
  const metric = card?.metrics.find((m) => m.key === target.key);
  if (!metric) return undefined;
  return { held: direction(metric, target.after, noise) !== 'worse', now: metric.value, label: metric.label, format: metric.format };
}

/** Every climb so far, newest first: the pull requests on GitHub, and the climbs that ended without one. */
export function climbLog(prs: PastPullRequest[], ends: ClimbEnd[], captain: string | undefined, main: Scorecard[] = [], noise?: ScorecardNoise): ClimbRecord[] {
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
      since: outcome === 'merged' && target ? heldSince(target, at, main, noise) : undefined,
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
    if (r.since) lines.push(`  On main since: ${r.since.label} is ${formatValue(r.since.now, r.since.format)}, ${r.since.held ? 'held' : 'SLIPPED back past the target'}`);
    for (const w of r.words) lines.push(`  The captain said: “${firstSentences(w, 400)}”`);
    return lines.join('\n');
  }).join('\n');
}

/** How many days of frictions the brief lists, as the retro reads them. */
const FRICTION_DAYS = 14;

/** The climb's first message: the evidence beyond the code (the office's frictions, the retro's open issues) and the steps. */
export function climbBrief(agent: Pick<Agent, 'repo' | 'baseBranch' | 'branch'>, events: LedgerEvent[], now: number, log: ClimbRecord[] = [], noise?: ScorecardNoise): string {
  const frictions = frictionGroups(events, now, FRICTION_DAYS).filter((g) => g.sessions >= 3).slice(0, 8);
  const issues = openRetroIssues(events, agent.repo);
  return [
    `Climb ${agent.repo} one step towards its standard. You're on \`${agent.branch}\`, fresh from \`${agent.baseBranch}\`.`,
    '',
    '## 0. What you\'ve climbed before',
    log.length
      ? `Every climb is yours, newest first. A merged one is done: don't redo it. A closed one was turned down: don't take its gap again unless your **Hypothesis** says what has changed since, answering the captain's words. A gain that SLIPPED on main is a gap worth taking.\n${climbLogText(log)}`
      : 'This is your first climb.',
    '',
    '## 1. Measure',
    'Read CLAUDE.md and docs/scorecard.md. Run `pnpm install` and then `pnpm run scorecard --no-save` before you change anything: its numbers are your **Before**. Every number you report must come from a command you ran, never from reading code by eye.',
    noise
      ? `Numbers wobble: the scorecard compares against a noise floor of ${noise.runs} runs on ${noise.commit.slice(0, 8)}, and marks a change ▲ or ▼ only past it. Claim a gain only where it does. What wobbled: ${noiseText(noise)}.`
      : 'There\'s no noise floor yet, so a time has to move more than 10% to count. If your target is a time, run `pnpm run scorecard --repeat 3 --no-save` for its spread first, and claim only a move past it.',
    'Times swing with the machine\'s load (other agents run beside you): if your target is a time, measure it interleaved, base and change taking turns on the same machine (at least 5 of each, the base in a worktree of its own), and compare medians.',
    '',
    '## 2. Rank',
    'Put every gap on one scale: harm to the captain and the office first, then how far the code is from the standard, then size. Pick the top one that fits in one reviewable pull request. The gaps include:',
    '- the scorecard\'s numbers: a gate that fails or is slow, type assertions and non-null assertions, the server\'s edges between Effect and Promise code, functions over CRAP 30, no property tests;',
    frictions.length
      ? `- the office's open frictions: what got in the agents' way in 3 or more sessions in the last ${FRICTION_DAYS} days, with no retro decision yet:\n${frictions.map((g) => `  - ${g.key} (${g.sessions} sessions)`).join('\n')}`
      : '- the office\'s open frictions: none came up in 3 or more sessions lately;',
    issues.length
      ? `- the retro's accepted issues, still open in ${agent.repo} (if you take one, say \`Closes #n\` in the Solution):\n${issues.map((i) => `  - #${i.number} ${i.title}`).join('\n')}`
      : '- the retro\'s accepted issues: none are open.',
    'Skip anything that needs the captain\'s sign-off (a dependency version, a change to how the office merges or deploys, anything outside this repo) and list it at the end instead.',
    '',
    '## Hypothesis, before you change anything',
    'Write it down in your terminal now, and keep it as your pull request\'s **Hypothesis** section: which gap, why it\'s the top one, which scorecard number it will move, by how much, and what result would show you wrong. End it with one line, `Target: <metric key> <before> → <expected after>` (a key from `pnpm run scorecard --json`, like `Target: fence.typeAssertions 226 → 214`); the office reads that line to check, on main, whether your gain holds. A gap the scorecard can\'t see still gets its nearest number, or `Target: none` and why.',
    '',
    '## 3. Fix',
    'If the bad pattern can come back, add a check first (a lint rule, a type, a test that guards it) and watch it fail. Then make the smallest coherent change. Plant a bug to prove each new test can fail, then take the bug out.',
    '',
    '## 4. Prove',
    'Run the whole gate (`pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run build`), then `pnpm run scorecard --no-save` again: its numbers are your **After**. Say plainly whether your hypothesis held; a miss is worth reporting as it is. Update the docs the change touches.',
    '',
    '## Never',
    '- Pass `--no-verify`, or loosen a lint rule, check, diagnostic or test to make something pass.',
    '- Change a dependency version.',
    '- Mix two reasons in one pull request, or claim a number you didn\'t measure.',
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

/**
 * What to do about the climb now: start one (climbing is on and none is open), wait for the one under way (its
 * climber is working, or its pull request is open), or stop climbing because the last one ended without a pull
 * request. `climber` is the climbing engineer while they're in the office: a new climb also waits while they're still
 * busy with the last (a pull request closed while they were fixing QA's findings), since every climb is theirs.
 */
export type ClimbStep = { kind: 'start' } | { kind: 'wait' } | { kind: 'stop'; why: string; outcome: 'nothing' | 'failed' } | { kind: 'idle' };

export function climbStep(climb: Climb, climber: Pick<Agent, 'status' | 'pr' | 'error' | 'activity'> | undefined): ClimbStep {
  if (climb.pr) return { kind: 'wait' };
  if (climb.agentId) {
    if (!climber) return { kind: 'stop', why: 'The climber went home before opening a pull request', outcome: 'failed' };
    if (!FINISHED.includes(climber.status)) return { kind: 'wait' };
    if (climber.pr) return { kind: 'wait' };
    if (climber.status === 'done') return { kind: 'stop', why: `The last climb found nothing to change: ${climber.activity}`, outcome: 'nothing' };
    return { kind: 'stop', why: `The last climb ${climber.status === 'stopped' ? 'was stopped' : 'failed'}${climber.error ? `: ${climber.error}` : ''}`, outcome: 'failed' };
  }
  if (!climb.keepClimbing) return { kind: 'idle' };
  return climber && !FINISHED.includes(climber.status) ? { kind: 'wait' } : { kind: 'start' };
}

/** `owner/repo` from a git remote's URL (`https://github.com/o/r.git`, `git@github.com:o/r.git`), or nothing for another host. */
export function githubRepo(remoteUrl: string): string | undefined {
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim())?.[1];
}

/**
 * Where the climbs are: the project with the office's own repo (`ownRepo`, from its checkout's remote). The demo office
 * has no repo of its own, so it climbs its first project's first repo.
 */
export function climbHome(projects: Pick<Project, 'id' | 'repos'>[], ownRepo: string | undefined, demo: boolean): { projectId: string; repo: string } | undefined {
  const own = ownRepo && projects.find((p) => p.repos.includes(ownRepo));
  if (own && ownRepo) return { projectId: own.id, repo: ownRepo };
  const first = demo ? projects.find((p) => p.repos.length) : undefined;
  return first && { projectId: first.id, repo: first.repos[0] };
}
