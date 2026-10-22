import { describe, expect, it } from 'vitest';
import { parseJsonLines, readReply, retryDelay, routesOf, scoreLine, stopReason } from './jevRun';

describe('retryDelay', () => {
  it('asks again on a busy or failing server, a little later each time, up to three tries', () => {
    expect(retryDelay(429, 1)).toBe(2000);
    expect(retryDelay(503, 2)).toBe(4000);
    expect(retryDelay(503, 3)).toBeUndefined();
  });

  it('doesn’t ask again on an answer that won’t change', () => {
    expect(retryDelay(401, 1)).toBeUndefined();
    expect(retryDelay(400, 1)).toBeUndefined();
  });
});

describe('stopReason', () => {
  const run = { spent: 0, budget: 1, failed: 0, asked: 10 };
  it('stops at the budget', () => {
    expect(stopReason({ ...run, spent: 1 })).toBe('budget');
    expect(stopReason({ ...run, spent: 0.99 })).toBeUndefined();
  });

  it('stops when more than half the calls fail, five at least', () => {
    expect(stopReason({ ...run, failed: 6 })).toBe('failing');
    expect(stopReason({ ...run, failed: 5 })).toBeUndefined();
    expect(stopReason({ ...run, failed: 4, asked: 4 })).toBeUndefined();
  });
});

describe('readReply', () => {
  it('keeps the answers, the input tokens and the model', () => {
    expect(readReply({ model: 'jev-1.14.0', answers: { spends_money: { noul: 0.2 } }, usage: { input_tokens: 1900, output_tokens: 4 } })).toEqual({
      answers: { spends_money: { noul: 0.2 } },
      inputTokens: 1900,
      model: 'jev-1.14.0',
    });
  });

  it('counts no tokens when it isn’t told any, and is no reply without answers', () => {
    expect(readReply({ answers: {} })).toEqual({ answers: {}, inputTokens: 0 });
    expect(readReply({ error: 'nope' })).toBeUndefined();
    expect(readReply('nope')).toBeUndefined();
  });
});

describe('routesOf', () => {
  const lines = [{ id: 'a', bucket: 3 }, { id: 'b', bucket: 4 }, { id: 'c', bucket: 7 }, { bucket: 1 }, 'junk'];
  it('reads each line’s route, skipping lines that aren’t one', () => {
    expect([...routesOf(lines)]).toEqual([['a', 3], ['b', 4]]);
  });

  it('keeps only the turns asked for', () => {
    expect([...routesOf(lines, (id) => id === 'b')]).toEqual([['b', 4]]);
  });
});

describe('scoreLine', () => {
  it('writes the route at the bar, and why', () => {
    const answers = { route: { choice: 'card', probabilities: { card: 0.6, interrupt: 0.4 }, confidence: 0.7 } };
    expect(JSON.parse(scoreLine('a', answers, 0.0001, { threshold: 0.3, captainsCall: false }))).toEqual({
      id: 'a', bucket: 3, why: 'P(interrupt signal) 0.40, Jev chose card (confidence 0.70)', cost: 0.0001,
    });
  });

  it('says so when Jev gave no choice or confidence', () => {
    expect(JSON.parse(scoreLine('a', {}, 0, { threshold: 0.5, captainsCall: false })).why).toBe('P(interrupt signal) 0.00, Jev chose ? (confidence ?)');
  });
});

describe('parseJsonLines', () => {
  it('parses every line, leaving out a half-written last one', () => {
    expect(parseJsonLines('{"id":"a"}\n\n{"id":"b"}\n{"id":"c","ans')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('throws on a broken line before the last', () => {
    expect(() => parseJsonLines('{"id":\n{"id":"b"}')).toThrow('line 1');
  });
});
