import { describe, expect, it } from 'vitest';
import { decodeTraffic, logged, type TrafficEntry } from './traffic';

const news = (at: number, link?: TrafficEntry['link']): TrafficEntry => ({ at, level: 'info', text: `news ${at}`, link });

describe('logged', () => {
  it('puts the newest on top and keeps only the last few', () => {
    let log: TrafficEntry[] = [];
    for (let at = 1; at <= 5; at++) log = logged(log, news(at), 3);
    expect(log.map((e) => e.at)).toEqual([5, 4, 3]);
  });
});

describe('decodeTraffic', () => {
  it('reads back what was kept, links and all', () => {
    const log = [news(2, { kind: 'agent', id: 'a1', talk: true }), news(1, { kind: 'url', url: 'http://x', label: 'Open ↗' })];
    expect(decodeTraffic(JSON.stringify(log))).toEqual(log);
  });

  it('starts afresh from nothing, junk, or entries it can’t make sense of', () => {
    expect(decodeTraffic(null)).toEqual([]);
    expect(decodeTraffic('{not json')).toEqual([]);
    expect(decodeTraffic('{"at":1}')).toEqual([]);
    expect(decodeTraffic(JSON.stringify([news(1), { at: 'yesterday' }, { ...news(2), level: 'shout' }, null]))).toEqual([news(1)]);
  });
});
