// How much of your Claude plan Focus has used, and what each agent signs in with, for main engineering: the
// plugin's state (its server part's), as the browser reads it.
import type { SignIn } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, and its state's key. */
export const USAGE = 'usage';

/** One of your plan's usage limits: how much of it is used, and when it starts again. */
export interface UsageWindow {
  /** Which limit: 'session' (five hours), 'week' (all models), or a model's own weekly one ('week · Opus'). */
  label: string;
  /** How much of it is used, 0 to 100. */
  percent: number;
  /** When it resets (epoch ms), if Claude Code said. */
  resetsAt?: number;
}

/** Extra usage: what Claude bills past your plan's limits, if it's switched on. */
export interface ExtraUsage {
  enabled: boolean;
  /** Spent this month, and the monthly cap, in `currency`. */
  used: number;
  limit: number;
  currency: string;
  percent: number;
}

/** Your plan's usage as Claude Code reports it (its `/usage`), read every few minutes. */
export interface PlanUsage {
  /** When it was read (epoch ms). */
  at: number;
  /** pro, max, team or enterprise. */
  plan?: string;
  windows: UsageWindow[];
  extra?: ExtraUsage;
}

/** How Focus's sessions sign in, and what your API key has spent while the plan's limit is reached. */
export interface Usage {
  /** Your plan's limits, or null before the first reading, or when there's no plan to read (on the API key). */
  plan: PlanUsage | null;
  /** Why there's no reading, when there isn't one. */
  error?: string;
  /** 'login': agents use your plan; 'key': your API key; 'fallback': your plan, then the key while it's limited. */
  signIn: SignIn['mode'];
  /** New sessions start on the key right now. */
  onKey: boolean;
  /** What the key has spent since your plan's limit was reached, and the most it may. */
  keySpentUsd: number;
  keyBudgetUsd: number;
}
