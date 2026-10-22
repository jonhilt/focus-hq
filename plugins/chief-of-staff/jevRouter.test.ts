import { describe, expect, it } from 'vitest';
import { JevRouter, routingOf } from './jevRouter';

const reply = (route: Record<string, number>, nouls: Record<string, number> = {}) => ({
  model: 'jev-1.14.0',
  answers: { route: { choice: 'card', probabilities: route, confidence: 0.6 }, ...Object.fromEntries(Object.entries(nouls).map(([k, noul]) => [k, { noul }])) },
  usage: { input_tokens: 2000 },
});
const answering = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
  };
  return { calls, fetcher };
};

describe('routingOf', () => {
  it('routes by the proposed policy: interrupting at 0.30, and a carry-on sent back to the lead', () => {
    expect(routingOf({ route: { probabilities: { interrupt: 0.3, card: 0.7 } } }, 0).route).toBe(3);
    expect(routingOf({ route: { probabilities: { interrupt: 0.1, carry_on: 0.9 } } }, 0).route).toBe(4);
  });

  it('keeps what the verdict needs of how it got there, and what it cost', () => {
    const { route, how } = routingOf({ route: { choice: 'card', probabilities: { card: 0.8, interrupt: 0.2 }, confidence: 0.7 } }, 2000);
    const { costUsd, ...rest } = how;
    expect(route).toBe(2);
    expect(rest).toEqual({ model: 'jev-1.14.0', version: 'jev-v1', interrupt: 0.2, choice: 'card', confidence: 0.7 });
    expect(costUsd).toBeCloseTo(0.000084, 9);
  });
});

describe('JevRouter', () => {
  it('asks the pinned model the backtest’s questions, with the key, and routes by the answers', async () => {
    const { calls, fetcher } = answering(200, reply({ interrupt: 0.6, card: 0.4 }));
    const routing = await new JevRouter(() => 'k', fetcher).route('Goal: x', 'STANDING ORDERS\nDo it.');
    expect(routing.route).toBe(3);
    const body: unknown = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: 'jev-1.14.0', state: 'Goal: x', questions: { route: { type: 'choice' }, spends_money: { type: 'noul' } } });
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer k' });
  });

  it('fails, so Haiku routes, without a key, on an error, or on a reply with no answers', async () => {
    await expect(new JevRouter(() => undefined, answering(200, reply({})).fetcher).route('s', undefined)).rejects.toThrow('no TypeSafe key');
    await expect(new JevRouter(() => 'k', answering(401, 'bad key').fetcher).route('s', undefined)).rejects.toThrow('HTTP 401');
    await expect(new JevRouter(() => 'k', answering(200, { error: 'x' }).fetcher).route('s', undefined)).rejects.toThrow('no answers');
  });
});
