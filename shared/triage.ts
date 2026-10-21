import type { QaReview, Triage, TriageAction } from './types';

// When the room's operations officer triages a stuck PR, and what Ops does with their decision. Pure, so it's
// unit tested (shared/triage.test.ts); manager.ts runs the officer and does what they decided.

/** Triages per PR. A PR stuck again after that goes straight to the manager. */
export const MAX_TRIAGES = 2;

export type StuckStep = { kind: 'triage' } | { kind: 'needs-you'; reason: string };

/** A PR Ops opened is stuck (`reason`): the officer looks first, unless they've had their tries on it. */
export function whenStuck(review: Pick<QaReview, 'triages'>, officer: string, reason: string): StuckStep {
  const triages = review.triages ?? 0;
  if (triages >= MAX_TRIAGES) return { kind: 'needs-you', reason: `${reason}, and ${officer} already looked at it ${triages === 2 ? 'twice' : `${triages} times`}` };
  return { kind: 'triage' };
}

export type TriageStep =
  | { kind: 'retry-qa' | 'send-back' | 'rerun-checks' | 'close'; note: string }
  | { kind: 'needs-you'; reason: string };

export type TriageResult = { decision: { action: TriageAction; note: string } } | { error: string };

/**
 * What Ops does with the officer's decision. An escalation, or a session that ended without a decision, puts
 * the PR in front of the manager. A PR is only closed when it would close an issue, so the work gets built again.
 */
export function afterTriage(officer: string, result: TriageResult, pr: { closes: number[] }): TriageStep {
  if ('error' in result) return { kind: 'needs-you', reason: `${officer} couldn’t work out what to do (${result.error})` };
  const { action, note } = result.decision;
  switch (action) {
    case 'escalate':
      return { kind: 'needs-you', reason: `${officer}: ${note}` };
    case 'close':
      if (!pr.closes.length) return { kind: 'needs-you', reason: `${officer} would close it, but it closes no issue to build again: ${note}` };
      return { kind: action, note };
    case 'retry-qa':
    case 'send-back':
    case 'rerun-checks':
      return { kind: action, note };
  }
}

const DID: Record<TriageAction, string> = {
  'retry-qa': 'sent it back to QA',
  'send-back': 'sent it back to a developer',
  'rerun-checks': 're-ran the failed checks',
  close: 'closed the PR',
  escalate: 'handed it to you',
};

/** What a PR card says the officer did. */
export function triageLabel(triage: Pick<Triage, 'officer' | 'action'>): string {
  return `${triage.officer} ${DID[triage.action]}`;
}
