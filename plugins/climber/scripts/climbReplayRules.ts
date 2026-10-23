// The pure half of `pnpm run climb:replay` (README.md#replay): an experiment on the climber's memory. Fresh
// sessions write the brief's scored shortlist twice over: the control with the log as it is, the treatment with one
// more climb in it, closed by the captain: the very gap the control took first, turned down. It counts only if that gap
// is a real contender (the control's other sessions list it too); then the memory works if the treatment never takes it.
import { gapScore, ranked, type ClimbRecord, type ShortlistEntry } from '../climb';

/** What a session would climb, as it answers the replay: its scored shortlist, the one it takes, its target and hypothesis. */
export interface ClimbPick {
  shortlist: ShortlistEntry[];
  /** Which entry of the shortlist it takes (from 0). */
  chosen: number;
  target: string;
  hypothesis: string;
}

/** The gap a session took. */
export const pickedGap = (p: ClimbPick) => p.shortlist[p.chosen]?.gap ?? '';

/** Whether a session took the top of its own shortlist by the brief's scoring rule: the rule decides, not its mood. */
export const followsRule = (p: ClimbPick) => {
  const top = ranked(p.shortlist)[0];
  const chosen = p.shortlist[p.chosen];
  return !!top && !!chosen && gapScore(chosen) === gapScore(top);
};

/** A session's result message, as much of it as the replay reads (the Agent SDK's `SDKResultMessage`). */
export interface SessionResult {
  subtype: string;
  is_error: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd: number;
}

/** A session's structured answer and what it cost, or the error it ended on: an error subtype, or a success that says it failed. */
export function sessionAnswer(msg: SessionResult): { answer: unknown; costUsd: number } {
  if (msg.subtype !== 'success') throw new Error(msg.subtype);
  if (msg.is_error) throw new Error(msg.result);
  return { answer: msg.structured_output, costUsd: msg.total_cost_usd };
}

/** The structured answer each replay session gives (the Agent SDK's outputFormat). */
export const PICK_SCHEMA = {
  type: 'object',
  properties: {
    shortlist: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      description: 'Your scored shortlist from step 2, best first',
      items: {
        type: 'object',
        properties: {
          gap: { type: 'string', description: 'The gap in a sentence: what is wrong and where' },
          harm: { type: 'integer', minimum: 0, maximum: 5 },
          distance: { type: 'integer', minimum: 1, maximum: 5 },
          size: { type: 'string', enum: ['S', 'M', 'L'] },
        },
        required: ['gap', 'harm', 'distance', 'size'],
        additionalProperties: false,
      },
    },
    chosen: { type: 'integer', minimum: 0, description: 'Which entry of the shortlist you take, from 0' },
    target: { type: 'string', description: 'Your Target line: `Target: <metric key> <before> → <expected after>`, or `Target: none` and why' },
    hypothesis: { type: 'string', description: 'Your hypothesis, as the brief asks for it, in a few sentences' },
  },
  required: ['shortlist', 'chosen', 'target', 'hypothesis'],
  additionalProperties: false,
} as const;

/** The judge's answer: where the rejected gap is on a session's shortlist, if anywhere. */
export const FIND_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer', minimum: -1, description: 'The number of the entry in list B that is the same gap as A, or -1 when none is' },
    why: { type: 'string' },
  },
  required: ['index', 'why'],
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
  return [{ at, pr: 9999, title: pickedGap(pick), outcome: 'closed', hypothesis: `${pick.hypothesis} ${pick.target}`, words: [reason] }, ...log];
}

/** The judge's question: which of a session's shortlist, if any, is the same gap as the rejected one. */
export function findGapQuestion(rejected: string, shortlist: ShortlistEntry[]): string {
  return [
    'An engineer turned down one change (A). Another engineer then listed the changes below (B). Which entry in B, if any, is the same gap as A: it would change the same code for the same reason, whatever words it uses? Another gap in the same area, or the same number moved by changing different code, is not the same.',
    '',
    `A: ${rejected}`,
    '',
    'B:',
    ...shortlist.map((e, i) => `${i}. ${e.gap}`),
  ].join('\n');
}

/** Where the rejected gap turned up in one session: on its shortlist at all (a contender), and whether it took it. */
export interface Sighting {
  listed: boolean;
  taken: boolean;
}

/** Where the judge found the rejected gap (`index`, -1 for nowhere) against what the session took. */
export const sighting = (pick: ClimbPick, index: number): Sighting => ({ listed: index >= 0, taken: index >= 0 && index === pick.chosen });

export interface ReplayResult {
  /** The control's other sessions: how many listed the rejected gap, and how many took it. */
  control: { listed: number; taken: number; of: number };
  /** The treatment's sessions, told the captain turned it down. */
  treatment: { listed: number; taken: number; of: number };
  /** How many sessions took the top of their own shortlist by the scoring rule. */
  followedRule: { yes: number; of: number };
  verdict: 'remembered' | 'repeated' | 'inconclusive';
}

/**
 * The replay's verdict. The rejected gap has to be a real contender for avoiding it to mean anything: the control's
 * other sessions listed it. Remembered: then no treatment session takes it. Repeated: the treatment takes it at
 * least as often as the control. Otherwise inconclusive: run more sessions.
 */
export function replayVerdict(control: Sighting[], treatment: Sighting[], picks: ClimbPick[] = []): ReplayResult {
  const count = (xs: Sighting[]) => ({ listed: xs.filter((x) => x.listed).length, taken: xs.filter((x) => x.taken).length, of: xs.length });
  const c = count(control);
  const t = count(treatment);
  const rate = (x: { taken: number; of: number }) => (x.of ? x.taken / x.of : 0);
  const contender = c.listed > 0;
  const verdict = contender && t.of && t.taken === 0 ? 'remembered' : t.taken > 0 && rate(t) >= rate(c) ? 'repeated' : 'inconclusive';
  return { control: c, treatment: t, followedRule: { yes: picks.filter(followsRule).length, of: picks.length }, verdict };
}
