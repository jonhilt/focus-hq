import { describe, expect, it } from 'vitest';
import { measure, verdict, type Budgets, type Run, type Sent } from './scaleRules';

const sent = (type: string, bytes: number, times = 1): Sent[] => Array.from({ length: times }, () => ({ type, bytes }));

const run = (r: Partial<Run> = {}): Run => ({ seconds: 10, agents: 4, snapshotBytes: 8_000, sent: [], ...r });

const budgets: Budgets = { snapshotBytesPerAgent: 3_000, bytesPerSecPerAgent: 100, messagesPerSec: 5, largestEvent: 1_000 };

describe('measure', () => {
  it('sums each event type, biggest first, with its largest message', () => {
    const m = measure(run({ sent: [...sent('lines', 10, 3), ...sent('agent', 200), ...sent('agent', 300)] }));
    expect(m.events).toEqual([
      { type: 'agent', count: 2, bytes: 500, largest: 300 },
      { type: 'lines', count: 3, bytes: 30, largest: 10 },
    ]);
    expect(m.largestEvent).toBe(300);
  });

  it('spreads what a tab gets over the seconds watched and the agents on the ship', () => {
    const m = measure(run({ seconds: 10, agents: 4, snapshotBytes: 8_000, sent: sent('agent', 400, 10) }));
    expect(m).toMatchObject({ agents: 4, snapshotBytesPerAgent: 2_000, bytesPerSecPerAgent: 100, messagesPerSec: 1 });
  });

  it('reads an empty ship and a quiet run as nothing sent, not a division by zero', () => {
    expect(measure(run({ seconds: 0, agents: 0, snapshotBytes: 500 }))).toMatchObject({
      snapshotBytesPerAgent: 500,
      bytesPerSecPerAgent: 0,
      messagesPerSec: 0,
      largestEvent: 0,
      events: [],
    });
  });
});

describe('verdict', () => {
  it('passes a run at its budgets', () => {
    expect(verdict(measure(run({ agents: 1, snapshotBytes: 3_000, sent: sent('agent', 1_000) })), budgets)).toEqual({ kind: 'within' });
  });

  it('names each budget a run went past, with the number it reached', () => {
    const m = measure(run({ agents: 1, snapshotBytes: 3_001, sent: sent('plugin', 1_200) }));
    expect(verdict(m, budgets)).toEqual({ kind: 'over', reasons: ['snapshotBytesPerAgent: 3001 > 3000', 'bytesPerSecPerAgent: 120 > 100', 'largestEvent: 1200 > 1000'] });
  });
});
