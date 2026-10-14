// Main engineering's climber (docs/climber.md), after ratstack's hill-climb prompt: each climb measures Focus with the
// scorecard, takes the worst gap, fixes it, proves the fix with the same numbers, and ships one pull request. Pure: the
// manager's Climbs part seats the climbing engineer and does the bookkeeping.
import { frictionGroups, type LedgerEvent } from '../../shared/ledger';
import type { Agent, AgentStatus, Climb, Project } from '../../shared/types';

const FINISHED: AgentStatus[] = ['done', 'error', 'stopped'];

/** What the climber is told in their system prompt: how a climb goes, and what they never do. */
export const CLIMB_ASSIGNMENT =
  'You are main engineering\'s climber. Your job is to move Focus, the office you work in, one change at a time towards its ' +
  'own standard: its CLAUDE.md and docs, Effect v4 done properly, honest types, and a fence of checks that makes the easy ' +
  'path the right one. This climb is one change, measured before and after.';

export const CLIMB_SUMMARY =
  'Your final message becomes the pull request: its first line is `# ` and the title (imperative, under 70 characters), ' +
  'then four sections: **Problem** (what was wrong, with the evidence), **Solution** (what changed, and why this way), ' +
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

/** How many days of frictions the brief lists, as the retro reads them. */
const FRICTION_DAYS = 14;

/** The climb's first message: the evidence beyond the code (the office's frictions, the retro's open issues) and the steps. */
export function climbBrief(agent: Pick<Agent, 'repo' | 'baseBranch' | 'branch'>, events: LedgerEvent[], now: number): string {
  const frictions = frictionGroups(events, now, FRICTION_DAYS).filter((g) => g.sessions >= 3).slice(0, 8);
  const issues = openRetroIssues(events, agent.repo);
  return [
    `Climb ${agent.repo} one step towards its standard. You're on \`${agent.branch}\`, fresh from \`${agent.baseBranch}\`.`,
    '',
    '## 1. Measure',
    'Read CLAUDE.md and docs/scorecard.md. Run `pnpm install` and then `pnpm run scorecard --no-save` before you change anything: its numbers are your **Before**. Every number you report must come from a command you ran, never from reading code by eye.',
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
    '## 3. Fix',
    'If the bad pattern can come back, add a check first (a lint rule, a type, a test that guards it) and watch it fail. Then make the smallest coherent change. Plant a bug to prove each new test can fail, then take the bug out.',
    '',
    '## 4. Prove',
    'Run the whole gate (`pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run build`), then `pnpm run scorecard --no-save` again: its numbers are your **After**. Update the docs the change touches.',
    '',
    '## Never',
    '- Pass `--no-verify`, or loosen a lint rule, check, diagnostic or test to make something pass.',
    '- Change a dependency version.',
    '- Mix two reasons in one pull request, or claim a number you didn\'t measure.',
    '',
    'If nothing is worth changing, commit nothing and say why in your final message.',
  ].join('\n');
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
