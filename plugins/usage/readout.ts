// How main engineering reads out your plan's usage: the same words on the MSD and in the engineering panel.

import { type Agent, clock } from '../../plugin-api/shared';
import type { Usage } from './shared';

/** How close a limit is: 'ok', getting there ('warn', from 75%), or nearly out ('bad', from 90%). */
export type UsageTone = 'ok' | 'warn' | 'bad';

export const usageTone = (percent: number): UsageTone => (percent >= 90 ? 'bad' : percent >= 75 ? 'warn' : 'ok');

export interface UsageRow {
  label: string;
  percent: number;
  /** "resets 03:59", with the day when it isn't today. */
  note: string;
  tone: UsageTone;
}

/** A row per limit of your plan, and extra usage when it's switched on. */
export function usageRows(usage: Usage | null, now = Date.now()): UsageRow[] {
  const plan = usage?.plan;
  if (!plan) return [];
  const rows = plan.windows.map((w): UsageRow => ({
    label: w.label,
    percent: w.percent,
    note: w.resetsAt ? `resets ${clock(w.resetsAt, now)}` : '',
    tone: usageTone(w.percent),
  }));
  const extra = plan.extra;
  if (extra?.enabled) rows.push({ label: 'extra usage', percent: extra.percent, note: `${money(extra.used, extra.currency)} of ${money(extra.limit, extra.currency)} this month`, tone: usageTone(extra.percent) });
  return rows;
}

const money = (amount: number, currency: string) => {
  try {
    return amount.toLocaleString([], { style: 'currency', currency, maximumFractionDigits: 2 });
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/** What the readout says when there are no rows: why there's nothing to show. */
export function usageHeadline(usage: Usage | null): string {
  if (!usage) return 'Reading your plan’s usage…';
  if (usage.signIn === 'key') return 'Agents use your API key: no plan limits apply';
  if (!usage.plan) return usage.error ? `Couldn’t read your plan’s usage: ${usage.error}` : 'Reading your plan’s usage…';
  return `${usage.plan.plan ? `${usage.plan.plan[0].toUpperCase()}${usage.plan.plan.slice(1)} plan` : 'Your plan'}`;
}

/** How Focus's sessions sign in, in a line: the plan, the key, or the plan with the key behind it. */
export function signInLine(usage: Usage | null): string {
  if (!usage) return '';
  if (usage.signIn === 'key') return 'Signed in with your API key';
  if (usage.signIn === 'login') return 'Signed in with your Claude plan';
  return usage.onKey
    ? `On your API key while the plan’s limit is reached: $${usage.keySpentUsd.toFixed(2)} of $${usage.keyBudgetUsd} spent`
    : `Your Claude plan, then your API key (up to $${usage.keyBudgetUsd}) when it runs out`;
}

/** What an agent's session signs in with: their cloud session's plan, your API key, or your plan. */
export const agentSignIn = (a: Pick<Agent, 'cloud' | 'onKey'>): 'cloud' | 'key' | 'plan' => (a.cloud ? 'cloud' : a.onKey ? 'key' : 'plan');

/** The HUD's line on the plan: each limit as "session 9%", and how close the nearest is; null when there's no plan to read. */
export function usageStat(usage: Usage | null): { text: string; tone: UsageTone } | null {
  const windows = usage?.plan?.windows ?? [];
  if (!windows.length) return null;
  const top = Math.max(...windows.map((w) => w.percent));
  return { text: windows.map((w) => `${w.label} ${w.percent}%`).join(' · '), tone: usageTone(top) };
}
