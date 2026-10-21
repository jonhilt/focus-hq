import type { QaReport } from '../../shared/types';

// What Ops does after QA fails a pull request: send it back to a developer, stop and hand it to the manager, or
// leave it alone. Pure, so it's unit tested (qaLoop.test.ts); manager.ts does the sending.

/** Failed QA rounds on one PR before Ops stops sending it back. */
export const MAX_FAILED_ROUNDS = 3;

export type QaLoopEvent =
  /** QA finished a round. `failedRounds` counts this one if it failed. */
  | { kind: 'verdict'; verdict: QaReport['verdict']; failedRounds: number }
  /** A developer the PR was sent back to finished their session. */
  | { kind: 'fix-ended'; by: string; outcome: 'pushed' | 'pushed-nothing' | 'failed' | 'stopped' };

export type QaNextStep = { kind: 'nothing' } | { kind: 'send-back' } | { kind: 'needs-you'; reason: string };

export function qaNextStep(pr: { openedByOffice: boolean; autoSendBack: boolean }, event: QaLoopEvent): QaNextStep {
  if (!pr.openedByOffice || !pr.autoSendBack) return { kind: 'nothing' };
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
