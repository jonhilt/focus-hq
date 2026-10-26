import { isOneOf, isRecord } from '../../plugin-api/shared';
import { answersOf, interruptSignal, type JevAnswer, jevRoute, type RoutePolicy } from './jevRoute';
import { type CosRoute, ROUTES } from './shared';

// The Jev backtest scripts' decisions (README.md#backtesting-jev): when to ask again, when to stop, and how its
// files read and write. The scripts (`scripts/jevBacktest.ts`, `scripts/jevSweep.ts`) do the I/O.

/** How many times a turn is asked before its failure counts. */
export const JEV_TRIES = 3;

/** How long to wait before asking again after an answer of `status` on try `attempt` (from 1); undefined: don't. */
export function retryDelay(status: number, attempt: number): number | undefined {
  const busy = status === 429 || status >= 500;
  return busy && attempt < JEV_TRIES ? 2000 * attempt : undefined;
}

/**
 * Why a run should stop before its next call, if it should: it's spent its budget, or more than half its calls are
 * failing (five at least, so a bad first call or two doesn't end it).
 */
export function stopReason(run: { spent: number; budget: number; failed: number; asked: number }): 'budget' | 'failing' | undefined {
  if (run.spent >= run.budget) return 'budget';
  if (run.failed >= 5 && run.failed > run.asked / 2) return 'failing';
  return undefined;
}

/** Jev's reply, as far as the backtest keeps it. */
export interface JevReply {
  answers: Record<string, JevAnswer>;
  inputTokens: number;
  model?: string;
}

/** Jev's reply read from its JSON: the answers (`answersOf`) and the input tokens; undefined when it has no answers. */
export function readReply(json: unknown): JevReply | undefined {
  if (!isRecord(json) || !isRecord(json.answers)) return undefined;
  const tokens = isRecord(json.usage) ? json.usage.input_tokens : undefined;
  return {
    answers: answersOf(json.answers),
    inputTokens: typeof tokens === 'number' ? tokens : 0,
    ...(typeof json.model === 'string' && { model: json.model }),
  };
}

/** An earlier run's routes, from the lines of its score.py file (`bucket` is the route it gave), the ones `keep` keeps. */
export function routesOf(lines: readonly unknown[], keep: (id: string) => boolean = () => true): Map<string, CosRoute> {
  const routes = new Map<string, CosRoute>();
  for (const r of lines) {
    if (!isRecord(r) || typeof r.id !== 'string' || !isOneOf(ROUTES, r.bucket) || !keep(r.id)) continue;
    routes.set(r.id, r.bucket);
  }
  return routes;
}

/** A turn's line in a score.py file: its route under `policy`, and why in brief. */
export function scoreLine(id: string, answers: Readonly<Record<string, JevAnswer>>, cost: number, policy: RoutePolicy): string {
  const route = answers.route;
  const confidence = route?.confidence === undefined ? '?' : route.confidence.toFixed(2);
  const why = `P(interrupt signal) ${interruptSignal(answers, policy.captainsCall).toFixed(2)}, Jev chose ${route?.choice ?? '?'} (confidence ${confidence})`;
  return JSON.stringify({ id, bucket: jevRoute(answers, policy), why, cost });
}

/**
 * A .jsonl file's lines, parsed. A last line that doesn't parse is left out: a run stopped mid-write leaves one
 * half-written, and the rerun asks that turn again. Any other line that doesn't parse is an error.
 */
export function parseJsonLines(text: string): unknown[] {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.flatMap((line, i): unknown[] => {
    try {
      return [JSON.parse(line)];
    } catch (err) {
      if (i === lines.length - 1) return [];
      throw new Error(`line ${i + 1} isn't JSON`, { cause: err });
    }
  });
}
