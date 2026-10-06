import { Schema } from 'effect';
import { reportText } from '../../shared/engineering';
import { type Brief, type BriefingMessage, type EngineeringReport, OPTION_SIZES, type Planner, type Settings } from '../../shared/types';
import { since, transcript } from './briefing';
import { repoList } from './planner';

// The ship's engineer at a briefing: asked by the manager, they read the code and come back with two or three ways to
// build the change, recommending one. Read-only, like the rest of the permanent crew; they write no code.

export interface EngineerTurn {
  projectId: string;
  projectName: string;
  engineer: Planner;
  planner: Planner;
  repos: string[];
  idea: string;
  brief: Brief;
  messages: BriefingMessage[];
  /** What the manager asked for when they sent for engineering; empty for plain "give me options". */
  request: string;
  /** The engineer's last options, when the manager sends them back for changes. */
  previous?: EngineeringReport;
  /** The engineer's session in this briefing; missing the first time they're asked, or if it was lost. */
  resumeSessionId?: string;
  settings: Settings;
  signal: AbortSignal;
}

export interface EngineerReply {
  report: EngineeringReport;
  sessionId?: string;
  costUsd?: number;
}

/** Proposes options for a briefing's change. The live one resumes a read-only Claude Code session; the demo one is scripted. */
export interface BriefingEngineer {
  propose(req: EngineerTurn, activity: (text: string) => void): Promise<EngineerReply>;
}

export function engineerSystemPrompt(req: Pick<EngineerTurn, 'engineer' | 'planner' | 'projectName' | 'repos'>): string {
  return `
# You are ${req.engineer.name}, the engineer aboard the Focus, called to a briefing about ${req.projectName} in the observation lounge

The manager and ${req.planner.name}, ${req.projectName}'s operations officer, are agreeing what to build and why. It's a big change, so before it's written up for a developer (a Claude Code agent who builds it alone, with nobody to ask), the manager wants to settle how. Your job: read the code and lay out the options. The manager picks one, and it goes into the issue as the Approach.

${repoList(req.repos)}

How to work:
- Read before you propose (Read, Glob, Grep): the repo's CLAUDE.md or README first, then the modules the change touches, so every option names real files and fits the code's conventions. You can't change anything, and you write no code and no spikes: options only.
- Two or three options that genuinely differ: where the responsibility lives, what's reused and what's new, how big a step it is. No straw men; if one option clearly wins, still give the strongest alternative.
- For each option: a short title, the approach in a few lines, the files and modules it touches, its trade-offs, its risks, and its size: "one agent" if one agent can build it in one sitting, "several issues" if it needs splitting.
- Recommend one, and say why in a sentence or two, weighed against the brief: its why, scope and acceptance criteria.
- Keep every line short: the manager reads the options on the lounge's wall screen. Spend minutes, not an audit.
`.trim();
}

export function engineerPrompt(req: Pick<EngineerTurn, 'idea' | 'brief' | 'messages' | 'request' | 'previous' | 'resumeSessionId'>): string {
  const heard = req.resumeSessionId ? since(req.messages, 'engineer') : req.messages;
  const { approach: _, ...brief } = req.brief;
  const ask = req.request ? `\n\nThe manager's note for you:\n"""\n${req.request}\n"""` : '';
  const task = req.previous
    ? `The manager sent your last options back:\n"""\n${reportText(req.previous)}\n"""${ask}\n\nRework them to answer the note: keep what still holds, change what it asks for.`
    : `The manager is asking engineering for options on how to build this.${ask}`;
  return `The briefing is about:\n"""\n${req.idea}\n"""

${req.resumeSessionId ? 'Said since your last options' : 'The briefing so far'}:
"""
${transcript(heard, 'engineer')}
"""

The brief on the wall screen:
${JSON.stringify(brief, null, 2)}

${task}

Finish with the structured result: your two or three options, the one you recommend (its index, 0 for the first) and why.`;
}

const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

/** JSON schema for the engineer's structured result (the Agent SDK's outputFormat). */
export const ENGINEERING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['options', 'recommended', 'why'],
  properties: {
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'approach', 'touches', 'tradeoffs', 'risks', 'size'],
        properties: {
          title: { type: 'string', description: 'A few words, e.g. "Extend the existing store"' },
          approach: { type: 'string', description: 'The approach in a few lines' },
          touches: list('Files and modules it touches'),
          tradeoffs: list('Trade-offs, one short line each'),
          risks: list('Risks, one short line each'),
          size: { type: 'string', enum: [...OPTION_SIZES], description: '"one agent" for one sitting, "several issues" if it needs splitting' },
        },
      },
    },
    recommended: { type: 'integer', minimum: 0, description: 'Index of the option you recommend (0 for the first)' },
    why: { type: 'string', description: 'Why you recommend it, in a sentence or two' },
  },
};

const Lines = Schema.Array(Schema.String);
const Report = Schema.Struct({
  options: Schema.Array(
    Schema.Struct({ title: Schema.String, approach: Schema.String, touches: Lines, tradeoffs: Lines, risks: Lines, size: Schema.Literals(OPTION_SIZES) }),
  ),
  recommended: Schema.Number,
  why: Schema.String,
});

/** The engineer's structured result as a report, trimmed. Throws when it isn't two or three options with one recommended. */
export function decodeEngineeringReport(out: unknown): EngineeringReport {
  const raw = Schema.decodeUnknownSync(Report)(out);
  const lines = (items: readonly string[]) => items.map((l) => l.trim()).filter(Boolean);
  const options = raw.options.map((o) => ({
    title: o.title.trim(),
    approach: o.approach.trim(),
    touches: lines(o.touches),
    tradeoffs: lines(o.tradeoffs),
    risks: lines(o.risks),
    size: o.size,
  }));
  if (options.length < 2 || options.length > 3) throw new Error(`Came back with ${options.length} options instead of 2 or 3`);
  if (!Number.isInteger(raw.recommended) || !options[raw.recommended]) throw new Error('Recommended an option that isn’t there');
  return { options, recommended: raw.recommended, why: raw.why.trim() };
}
