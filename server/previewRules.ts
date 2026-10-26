import type { PreviewLink } from '../shared/types';

/** A running stack's own status that's worth a warning (anything else, e.g. "ready" or "ok", clears it). */
const TROUBLED = /unhealthy|stale|fail|error|degraded|down|stopped|dead|crash/i;
/** A start command's JSON status that means it gave up. */
const GAVE_UP = ['failed', 'error', 'stopped'];
/** Checks in a row with no site answering before a detached preview counts as gone. */
export const MISSES_TO_FAIL = 3;

/**
 * A running preview's links, just checked: how many checks in a row have found every site down, and whether that's
 * the end of it. Only a detached preview fails this way: while its command runs, the command's exit says so.
 */
export function linksVerdict(links: PreviewLink[], misses: number, detached: boolean): { misses: number; fail?: string } {
  const next = links.some((l) => l.health !== 'down') ? 0 : misses + 1;
  return detached && next >= MISSES_TO_FAIL ? { misses: next, fail: 'The site stopped answering' } : { misses: next };
}

/**
 * What the progress command's word on our stack means for a running preview: it went away (fail), it named a status
 * (the warning follows it: troubled or cleared), or it said nothing we can read (leave the warning as it is).
 */
export function stackVerdict(stack: Record<string, unknown> | 'gone' | undefined): { fail: string } | { warning: string | undefined } | null {
  if (stack === 'gone') return { fail: 'The stack went away: it is no longer in the progress command’s list' };
  if (!stack || typeof stack.status !== 'string') return null;
  const error = typeof stack.error === 'string' && stack.error ? `: ${stack.error}` : '';
  return { warning: TROUBLED.test(stack.status) ? `The stack reports itself as ${stack.status}${error}` : undefined };
}

export interface CommandExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The start command's last JSON result, if it printed one. */
  result: Record<string, unknown> | null;
  /** The preview has links to check. */
  hasLinks: boolean;
  /** The command's own output offered a site to check. */
  offered: boolean;
  /** The command's JSON result named its links. */
  namedLinks: boolean;
}

export type ExitVerdict =
  /** It finished and left its sites running on their own (e.g. a CLI that starts them in the background). */
  | { kind: 'detached' }
  /** A stack CLI that brought its sites up but didn't like what it saw (e.g. "unhealthy"): they may be worth a look. */
  | { kind: 'complained'; complaint: string }
  | { kind: 'failed'; message: string };

/** What a preview's start command exiting means for the preview. */
export function exitVerdict({ code, signal, result, hasLinks, offered, namedLinks }: CommandExit): ExitVerdict {
  const status = typeof result?.status === 'string' ? result.status : undefined;
  const reported = typeof result?.error === 'string' && result.error ? result.error : undefined;
  const gaveUp = !!status && GAVE_UP.includes(status);
  if (code === 0 && !gaveUp && (hasLinks || offered)) return { kind: 'detached' };
  if (code !== 0 && !signal && !gaveUp && namedLinks) {
    const complaint = `The command exited with code ${code}${status ? ` and reported the stack as ${status}` : ''}${reported ? `: ${reported}` : ''}`;
    return { kind: 'complained', complaint };
  }
  const what = signal ? `was killed (${signal})` : code === 0 ? 'finished without reporting a site' : `exited with code ${code}`;
  return { kind: 'failed', message: reported ?? `The command ${what}${status ? ` (status "${status}")` : ''}` };
}
