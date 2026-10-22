import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/server';
import { verdictVolume } from './jevWatch';

const DAY = 86_400_000;
const verdict = (at: number, route: 1 | 2 | 3 | 4, extra: object = {}, projectId = 'p'): LedgerEvent => ({
  kind: 'cos-verdict', sessionId: 's', agent: 'a', turnUuid: String(at), route, why: 'w', model: 'haiku', version: 'v8', at, projectId, seq: 1, ...extra,
});
const jev = { router: { by: 'jev', model: 'jev-1.14.0', version: 'jev-v1', interrupt: 0.5, costUsd: 0 } };

describe('verdictVolume', () => {
  it('counts each day’s turns and interrupts by who routed them, and the turns Jev couldn’t route', () => {
    const rows = verdictVolume([
      verdict(0, 3, jev), verdict(1, 2, jev), verdict(2, 3), verdict(3, 4, { routerFailed: 'HTTP 529' }),
      verdict(DAY, 3, jev),
    ], 0);
    expect(rows).toEqual([
      { day: '1970-01-01', jev: { turns: 2, interrupts: 1 }, haiku: { turns: 2, interrupts: 1, jevFailed: 1 } },
      { day: '1970-01-02', jev: { turns: 1, interrupts: 1 }, haiku: { turns: 0, interrupts: 0, jevFailed: 0 } },
    ]);
  });

  it('keeps only what’s since then, in the projects asked for', () => {
    expect(verdictVolume([verdict(0, 3), verdict(DAY, 3, {}, 'other'), verdict(DAY, 2)], DAY, (p) => p === 'p')).toEqual([
      { day: '1970-01-02', jev: { turns: 0, interrupts: 0 }, haiku: { turns: 1, interrupts: 0, jevFailed: 0 } },
    ]);
  });
});
