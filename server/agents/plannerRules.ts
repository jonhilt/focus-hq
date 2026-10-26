import type { IssueDraft } from '../../shared/types';
import type { DraftRequest, DraftResult } from './planner';

// Whether the planner starts drafting an issue, and what a finished draft becomes. Pure, so it's unit tested
// (plannerRules.test.ts); planner.ts runs the draft.

/** Why the planner won't start this draft, or undefined when they will. */
export function draftRefusal(ask: {
  project: string;
  repos: number;
  planner: string;
  drafting: boolean;
  idea: string;
  revise?: DraftRequest['revise'];
}): string | undefined {
  if (!ask.repos) return `${ask.project} has no repositories yet`;
  if (ask.drafting) return `${ask.planner} is already drafting an issue for ${ask.project}`;
  if (ask.revise) return ask.revise.notes.trim() ? undefined : `Tell ${ask.planner} what to change`;
  return ask.idea.trim() ? undefined : `Tell ${ask.planner} what you have in mind`;
}

/**
 * What a finished draft becomes: in the planner's repo while it's still one of the project's (else its first), trimmed,
 * and only flagged too big for a reason that says something.
 */
export function readyDraft(result: DraftResult, repos: readonly string[], now: number): Partial<IssueDraft> & { title: string } {
  return {
    status: 'ready',
    activity: 'Draft ready',
    repo: repos.includes(result.repo) ? result.repo : repos[0],
    title: result.title.trim(),
    body: result.body.trim(),
    tooBig: result.tooBig?.trim() || undefined,
    costUsd: result.costUsd,
    finishedAt: now,
  };
}
