import { describe, expect, it } from 'vitest';
import { awayPhrases, awaySummary, type LogKind, type LogLine, logSince } from './shared';

const line = (t: number, kind: LogKind): LogLine => ({ t, who: 'Lt. Oyelaran', source: 'slice', kind, tag: kind, tone: 'info', text: kind });
const DAY = 86_400_000;

describe('what happened while you were away', () => {
  it('counts each kind of line since you last looked, and restarts once a minute they fell in', () => {
    const lines = [line(50, 'shipped'), line(150, 'shipped'), line(160, 'pass'), line(170, 'fail'), line(60_000, 'interrupted'), line(60_500, 'restarted'), line(200_000, 'interrupted')];
    const s = awaySummary(lines, 100);
    expect(s).toEqual({ since: 100, lines: 6, counts: { shipped: 1, pass: 1, fail: 1, interrupted: 2, restarted: 1 }, restarts: 2 });
    expect(awayPhrases(s)).toEqual(['1 slice shipped', 'QA passed 1, failed 1', 'Focus restarted 2 times']);
  });

  it('says nothing when nothing happened', () => {
    expect(awayPhrases(awaySummary([line(5, 'merged')], 10))).toEqual([]);
    expect(awayPhrases(awaySummary([line(15, 'merged'), line(16, 'held'), line(17, 'asked'), line(18, 'failed')], 10))).toEqual(['1 merged', "1 hold for your plan's limit", '1 failure', '1 hand up']);
  });
});

describe('how far back the log reads', () => {
  it('reads from the time asked, within the last week, or the last day', () => {
    const now = 100 * DAY;
    expect(logSince(now, now - 3 * DAY)).toBe(now - 3 * DAY);
    expect(logSince(now, now - 30 * DAY)).toBe(now - 7 * DAY);
    expect(logSince(now, Number.NaN)).toBe(now - DAY);
    expect(logSince(now, 0)).toBe(now - DAY);
  });
});
