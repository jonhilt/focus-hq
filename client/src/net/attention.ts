import { columns } from '../../../shared/board';
import { type Attention, needsYou, turnKey } from '../../../shared/tricorder';
import type { Agent } from '../../../shared/types';
import { state } from './state';

// What waits on the captain right now, for the 3D office's Comms panel and badge and the Tricorder's Needs you strip,
// and which of the goals' leads' turns they've already looked at.

const STORE = 'focus.seenTurns';
/** Plenty for every lead's latest turn: older ones only matter until the lead takes another. */
const KEEP = 200;

const load = (): string[] => {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(kept) ? kept.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
};

const seenKeys = load();
const seen = new Set(seenKeys);
const listeners = new Set<() => void>();

/**
 * The captain has looked at the lead's latest turn (opened their panel, say): it stops hailing them until the lead's
 * next one. Kept in this browser.
 */
export function markSeen(agent: Agent): void {
  if (agent.task !== 'lead' || agent.status !== 'done' || seen.has(turnKey(agent))) return;
  seenKeys.push(turnKey(agent));
  seen.add(turnKey(agent));
  for (const old of seenKeys.splice(0, Math.max(0, seenKeys.length - KEEP))) seen.delete(old);
  try {
    localStorage.setItem(STORE, JSON.stringify(seenKeys));
  } catch {
    // private browsing: it holds until the page reloads
  }
  for (const fn of listeners) fn();
}

/** Calls `fn` whenever a turn is marked seen; returns the unsubscribe. */
export function onSeen(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The turns the captain has looked at, as `turnKey`s. */
export const seenTurns = (): ReadonlySet<string> => seen;

/** Everything waiting on the captain across the shown projects: `needsYou` over the agents and the boards' PRs. */
export function attention(): Attention[] {
  const login = state.info?.github.login;
  const prs = state.shown.flatMap((project) =>
    columns(project, state.boards.get(project.id), state.agentsIn(project.id), login).prs.map((pr) => ({ projectId: project.id, pr })),
  );
  return needsYou(state.shownAgents(), prs, state.reviews, seen);
}
