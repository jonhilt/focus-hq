// What a big demo ship sends a tab, summed up, and whether it's within its budgets (tools/scale.ts). Pure, so
// it's unit tested (scaleRules.test.ts). The budgets are counts and bytes, never milliseconds: those depend on how busy
// the machine is, and other agents' gates are running on it too.

import { keysOf } from '../shared/records';

/** One message the ship sent down /ws after the snapshot: its event type and its size in bytes. */
export interface Sent {
  type: string;
  bytes: number;
}

/** What a run saw: the snapshot a tab gets on connecting, and what followed it. */
export interface Run {
  seconds: number;
  /** Agents on the ship once it was busy, leads and developers. */
  agents: number;
  snapshotBytes: number;
  sent: Sent[];
}

export interface EventTotal {
  type: string;
  count: number;
  bytes: number;
  largest: number;
}

export interface Measured {
  agents: number;
  /** The snapshot's size for each agent on the ship. */
  snapshotBytesPerAgent: number;
  /** What one open tab receives each second, for each agent on the ship. */
  bytesPerSecPerAgent: number;
  messagesPerSec: number;
  /** The biggest single event sent after the snapshot. */
  largestEvent: number;
  events: EventTotal[];
}

export type Budgets = Omit<Measured, 'agents' | 'events'>;

/**
 * What a busy ship may cost each open tab, set from measured runs with headroom. A change that needs more
 * should say why in its PR and raise the number here, where the diff shows it.
 */
export const BUDGETS: Budgets = {
  snapshotBytesPerAgent: 4_000,
  bytesPerSecPerAgent: 1_750,
  messagesPerSec: 60,
  largestEvent: 72_000,
};

export function measure(run: Run): Measured {
  const agents = Math.max(1, run.agents);
  const byType = new Map<string, EventTotal>();
  for (const { type, bytes } of run.sent) {
    const total = byType.get(type) ?? { type, count: 0, bytes: 0, largest: 0 };
    total.count += 1;
    total.bytes += bytes;
    total.largest = Math.max(total.largest, bytes);
    byType.set(type, total);
  }
  const bytes = run.sent.reduce((sum, s) => sum + s.bytes, 0);
  const seconds = Math.max(1, run.seconds);
  return {
    agents: run.agents,
    snapshotBytesPerAgent: Math.round(run.snapshotBytes / agents),
    bytesPerSecPerAgent: Math.round(bytes / seconds / agents),
    messagesPerSec: Math.round((run.sent.length / seconds) * 10) / 10,
    largestEvent: Math.max(0, ...run.sent.map((s) => s.bytes)),
    events: [...byType.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

export type Verdict = { kind: 'within' } | { kind: 'over'; reasons: string[] };

/** Whether a run kept to its budgets, and if not, each one it went past and by how much. */
export function verdict(m: Measured, budgets: Budgets = BUDGETS): Verdict {
  const reasons = keysOf(budgets)
    .filter((key) => m[key] > budgets[key])
    .map((key) => `${key}: ${m[key]} > ${budgets[key]}`);
  return reasons.length ? { kind: 'over', reasons } : { kind: 'within' };
}
