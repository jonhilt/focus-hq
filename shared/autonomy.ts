// How much an agent may do without asking: the office's setting, or the captain's choice for one agent.

import type { Autonomy, Settings } from './types';

export const AUTONOMY_MODES: readonly Autonomy[] = ['ask', 'auto', 'full'];

/** What the settings panel and an agent's panel call each mode. */
export const AUTONOMY_LABEL: Record<Autonomy, string> = { ask: 'Raise your hand', auto: 'Auto mode', full: 'Full autonomy' };

export function isAutonomy(value: unknown): value is Autonomy {
  return typeof value === 'string' && (AUTONOMY_MODES as readonly string[]).includes(value);
}

/** The mode an agent's session runs in: the captain's choice for them, else the office's setting. */
export function effectiveAutonomy(agent: { autonomy?: Autonomy }, settings: Pick<Settings, 'autonomy'>): Autonomy {
  return agent.autonomy ?? settings.autonomy;
}

/**
 * The line in the agent's terminal when the captain changes their mode: whether it took hold in the session that's
 * running (`live`), waits for their next turn (a running session that can't switch, like a cloud one), or there's no
 * session running and it applies when they next start.
 */
export function autonomyChangeLine(name: string, mode: Autonomy, session: 'live' | 'next-turn' | 'none'): string {
  const line = `✻ The captain set ${name}'s autonomy to ${AUTONOMY_LABEL[mode]}`;
  return session === 'next-turn' ? `${line} (from their next turn)` : line;
}
