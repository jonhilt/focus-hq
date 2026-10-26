import type { QaReport } from '../../shared/types';

// What Ops does after QA fails a pull request: send it back to a developer, stop and hand it to the manager or the
// goal's lead, or leave it alone. Pure, so it's unit tested (qaLoop.test.ts); manager.ts does the sending.

/** Failed QA rounds on one PR before Ops stops sending it back. */
export const MAX_FAILED_ROUNDS = 3;

export type QaLoopEvent =
  /**
   * QA finished a round. `failedRounds` counts this one if it failed; `behind`, it tested a commit the PR has moved
   * past, so QA's on the latest already.
   */
  | { kind: 'verdict'; verdict: QaReport['verdict']; failedRounds: number; behind?: boolean }
  /** A developer the PR was sent back to finished their session. */
  | { kind: 'fix-ended'; by: string; outcome: 'pushed' | 'pushed-nothing' | 'failed' | 'stopped' };

export type QaNextStep =
  | { kind: 'nothing' }
  | { kind: 'send-back' }
  | { kind: 'needs-you'; reason: string }
  /** A fix on a goal's pull request didn't land: it's the goal's lead's again. */
  | { kind: 'to-lead'; reason: string };

/**
 * Whose the PR is: `openedByOffice`, one of Focus's developers opened it; `lead`, a goal's lead did, and whether
 * they're `idle` (between turns) or at work, when a developer fixing their branch would get in their way.
 */
export interface QaLoopPr {
  openedByOffice: boolean;
  autoSendBack: boolean;
  lead?: { idle: boolean };
}

export function qaNextStep(pr: QaLoopPr, event: QaLoopEvent): QaNextStep {
  if (!pr.autoSendBack) return { kind: 'nothing' };
  if (pr.lead) return leadNextStep(pr.lead, event);
  if (!pr.openedByOffice) return { kind: 'nothing' };
  switch (event.kind) {
    case 'verdict':
      if (event.verdict === 'pass') return { kind: 'nothing' };
      if (event.failedRounds >= MAX_FAILED_ROUNDS) return { kind: 'needs-you', reason: `it failed QA ${event.failedRounds} times` };
      return { kind: 'send-back' };
    case 'fix-ended':
      switch (event.outcome) {
        case 'pushed':
          return { kind: 'nothing' }; // the push goes back to QA by itself
        case 'pushed-nothing':
          return { kind: 'needs-you', reason: `${event.by} pushed no fix` };
        case 'failed':
          return { kind: 'needs-you', reason: `${event.by} hit a problem fixing it` };
        case 'stopped':
          return { kind: 'needs-you', reason: `${event.by}'s fix was stopped` };
      }
  }
}

/**
 * A goal's pull request QA failed goes to a developer of its own while its lead is idle, so it's fixed without a turn
 * of theirs; a lead at work hears it as a note instead, as does one past the rounds (then it's the captain's). A fix
 * that doesn't land goes back to the lead, who knows what the goal is for.
 */
function leadNextStep(lead: { idle: boolean }, event: QaLoopEvent): QaNextStep {
  switch (event.kind) {
    case 'verdict':
      if (event.verdict === 'pass' || event.behind || !lead.idle || event.failedRounds >= MAX_FAILED_ROUNDS) return { kind: 'nothing' };
      return { kind: 'send-back' };
    case 'fix-ended':
      switch (event.outcome) {
        case 'pushed':
          return { kind: 'nothing' };
        case 'pushed-nothing':
          return { kind: 'to-lead', reason: `${event.by} pushed no fix` };
        case 'failed':
          return { kind: 'to-lead', reason: `${event.by} hit a problem fixing it` };
        case 'stopped':
          return { kind: 'to-lead', reason: `${event.by}'s fix was stopped` };
      }
  }
}
