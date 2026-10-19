// The training console's steps (docs/studio.md): the captain's moves in a scenario, in order, which `]` makes for them
// one at a time (start the goal, answer the lead, tell it something, approve what it asks, merge), so they can walk
// round the ship without opening a screen to keep the goal going. Pure: the browser (client/src/ui/trainingSteps.ts)
// only runs and draws what these decide.

import { isOneOf } from './records';
import type { Agent } from './types';

export const STEP_KINDS = ['start-goal', 'answer', 'reply', 'approve', 'merge'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface TrainingStep {
  do: StepKind;
  /** What the captain tells the lead, for `reply`. */
  say?: string;
}

/** A scenario's steps when its scene names none: start the goal, take the lead's first option, let it ship, merge. */
export const DEFAULT_STEPS: TrainingStep[] = [{ do: 'start-goal' }, { do: 'answer' }, { do: 'approve' }, { do: 'merge' }];

/**
 * A scene's `steps:` as YAML gives them: each a kind on its own (`- answer`) or a reply with what to say
 * (`- reply: Go ahead`); missing is the default steps. Throws saying what's wrong with one.
 */
export function readSteps(raw: unknown): TrainingStep[] {
  if (raw === undefined) return DEFAULT_STEPS;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('steps is a list of the captain’s moves');
  return raw.map((r: unknown, i): TrainingStep => {
    if (isOneOf(STEP_KINDS, r) && r !== 'reply') return { do: r };
    const say = r && typeof r === 'object' ? (r as Record<string, unknown>).reply : undefined;
    if (typeof say === 'string' && say.trim()) return { do: 'reply', say: say.trim() };
    throw new Error(`Step ${i + 1} is ${JSON.stringify(r)}: it's one of ${STEP_KINDS.filter((k) => k !== 'reply').join(', ')}, or reply: what to say`);
  });
}

/** `text` cut to `n` characters, an ellipsis marking the cut: the pill stays on one line. */
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** The lead's open question, if it has one. */
const openQuestion = (lead: Agent | undefined) => lead?.lead?.questions?.findLast((q) => !q.answer);

/** What a step does, as its pill says it: the option it'll pick and the request it'll grant, once there's one to. */
export function stepLabel(step: TrainingStep, lead: Agent | undefined): string {
  switch (step.do) {
    case 'start-goal':
      return 'Start the goal at team station 1';
    case 'answer': {
      const option = openQuestion(lead)?.options[0];
      return option ? `Answer: ${option.label}` : 'Answer the lead’s question';
    }
    case 'reply':
      return `Tell the lead: “${step.say ?? ''}”`;
    case 'approve':
      return lead?.permission ? `Approve: ${clip(lead.permission.summary, 48)}` : 'Approve what the lead asks for';
    case 'merge':
      return 'Merge the pull requests';
  }
}

/**
 * Whether a step has been done, by `]` or by hand through a screen: as far as the lead shows it (a reply leaves nothing
 * to tell it by, so only `]` moves past one).
 */
export function stepDone(step: TrainingStep, lead: Agent | undefined): boolean {
  switch (step.do) {
    case 'start-goal':
      return !!lead;
    case 'answer':
      return !!lead?.lead?.questions?.some((q) => q.answer);
    case 'reply':
      return false;
    case 'approve':
      return (lead?.lead?.prs.length ?? 0) > 0 || (lead?.lead?.landed?.length ?? 0) > 0;
    case 'merge':
      return (lead?.lead?.landed?.length ?? 0) > 0 || ((lead?.lead?.prs.length ?? 0) > 0 && !!lead?.lead?.prs.every((p) => p.outcome === 'merged'));
  }
}

/** Where the captain is in the steps, and whether that step was already done as they came to it. */
export interface StepAt {
  index: number;
  doneOnArrival: boolean;
}

/** Arriving at step `index`. */
export function arrive(steps: TrainingStep[], index: number, lead: Agent | undefined): StepAt {
  const i = Math.max(0, Math.min(steps.length, index));
  return { index: i, doneOnArrival: i < steps.length && stepDone(steps[i], lead) };
}

/**
 * The step after a moment of play: one done since the captain came to it (by `]`, or by hand) moves them on. A step
 * that was already done as they came to it (they stepped back onto it with `[`) waits for `]` to make it again.
 */
export function stepTick(steps: TrainingStep[], at: StepAt, lead: Agent | undefined): StepAt {
  const step = steps[at.index];
  if (!step || at.doneOnArrival || !stepDone(step, lead)) return at;
  return arrive(steps, at.index + 1, lead);
}

/** The pill's text: where the captain is and what `]` does next, or that the steps are over. */
export function stepPill(steps: TrainingStep[], at: StepAt, lead: Agent | undefined): { where: string; next: string } {
  const step = steps[at.index];
  if (!step) return { where: `${steps.length} / ${steps.length}`, next: 'All done' };
  return { where: `${at.index + 1} / ${steps.length}`, next: stepLabel(step, lead) };
}
