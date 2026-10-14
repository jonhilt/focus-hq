// The pure half of `pnpm run climb:replay` (docs/climber.md#replay): an experiment on the climber's memory. Fresh
// sessions rank the gaps from the same brief twice over: the control with the log as it is, the treatment with one
// more climb in it, closed by the captain: the very gap the control picked first, turned down. If the memory works, the
// treatment picks it again far less often than the control's sessions agree with each other.
import type { ClimbRecord } from '../server/agents/climb';

/** What a session would climb, as it answers the replay. */
export interface ClimbPick {
  gap: string;
  target: string;
  hypothesis: string;
}

/** The structured answer each replay session gives (the Agent SDK's outputFormat). */
export const PICK_SCHEMA = {
  type: 'object',
  properties: {
    gap: { type: 'string', description: 'The gap you would take, in a sentence: what is wrong and where' },
    target: { type: 'string', description: 'Your Target line: `Target: <metric key> <before> → <expected after>`, or `Target: none` and why' },
    hypothesis: { type: 'string', description: 'Your hypothesis, as the brief asks for it, in a few sentences' },
  },
  required: ['gap', 'target', 'hypothesis'],
  additionalProperties: false,
} as const;

/** The judge's answer: is this the same gap as the one turned down? */
export const SAME_SCHEMA = {
  type: 'object',
  properties: {
    same: { type: 'boolean', description: 'true when both would change the same code for the same reason, even in other words' },
    why: { type: 'string' },
  },
  required: ['same', 'why'],
  additionalProperties: false,
} as const;

/** What the replay sessions are told after the brief: rank only, from the numbers given, and change nothing. */
export function rankOnly(brief: string, scorecard: string): string {
  return [
    brief,
    '',
    '---',
    'This is a dry run of steps 0 to 2 and the hypothesis only. Change nothing, and run nothing: the scorecard has been measured for you, and its numbers are below. Read the code as much as you need to rank the gaps, then answer with the gap you would take, its Target line and your hypothesis.',
    '',
    scorecard,
  ].join('\n');
}

/** The control's pick, planted in the log as a climb the captain closed unmerged, saying why, so it's newest. */
export function plantRejection(log: ClimbRecord[], pick: ClimbPick, reason: string, at: number): ClimbRecord[] {
  return [{ at, pr: 9999, title: pick.gap, outcome: 'closed', hypothesis: `${pick.hypothesis} ${pick.target}`, words: [reason] }, ...log];
}

/** The judge's question: whether `pick` takes the same gap as `rejected`. */
export function sameGapQuestion(rejected: ClimbPick, pick: ClimbPick): string {
  return [
    'Two engineers each chose one change to make to the same codebase. Do they take the same gap: would both change the same code for the same reason, whatever words they use? Different gaps in the same area, or the same metric moved by changing different code, are not the same.',
    '',
    `A: ${rejected.gap}\n${rejected.target}\n${rejected.hypothesis}`,
    '',
    `B: ${pick.gap}\n${pick.target}\n${pick.hypothesis}`,
  ].join('\n');
}

export interface ReplayResult {
  /** How many of the control's other sessions took the same gap as its first: how strongly that gap draws a fresh session. */
  control: { same: number; of: number };
  /** How many treatment sessions took it again, told the captain turned it down. */
  treatment: { same: number; of: number };
  /** The memory works when the treatment repeats it less often than the control converges on it. */
  verdict: 'remembered' | 'repeated' | 'inconclusive';
}

/**
 * The replay's verdict. Remembered: no treatment session took the rejected gap, while the control converged on it at
 * least once (so avoiding it means something). Repeated: the treatment took it as often as the control did. Otherwise,
 * inconclusive: run more sessions.
 */
export function replayVerdict(control: boolean[], treatment: boolean[]): ReplayResult {
  const count = (xs: boolean[]) => ({ same: xs.filter(Boolean).length, of: xs.length });
  const c = count(control);
  const t = count(treatment);
  const rate = (x: { same: number; of: number }) => (x.of ? x.same / x.of : 0);
  const verdict = t.of && t.same === 0 && c.same > 0 ? 'remembered' : t.of && c.of && rate(t) >= rate(c) && t.same > 0 ? 'repeated' : 'inconclusive';
  return { control: c, treatment: t, verdict };
}
