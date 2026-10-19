import { describe, expect, it, vi } from 'vitest';
import type { Agent, AgentStatus, PluginHost } from '../../plugin-api/server';
import { BriefingDesk, QUICK_ANSWERER } from './desk';
import type { QuickAnswerer } from './quickAnswer';

const lead = (status: AgentStatus): Agent => ({ id: 'lead1', name: 'Lt. Adeyemi', status, lead: { title: 'Saved items', artifacts: [{ id: 'save-journey', title: 'How a save travels', at: 1 }] } }) as unknown as Agent;

function desk(status: AgentStatus, answer: QuickAnswerer['answer']) {
  const message = vi.fn<PluginHost['goals']['message']>(() => ({ sent: true }));
  const host: ConstructorParameters<typeof BriefingDesk>[0] = {
    agent: () => lead(status),
    artifact: () => Promise.resolve(new TextEncoder().encode('<p>The page</p>')),
    recentLines: () => [{ t: 0, kind: 'text', text: '⏺ Building the store.' }],
    settings: () => ({}) as ReturnType<PluginHost['settings']>,
    goals: { start: vi.fn(), startQueued: vi.fn(), message },
    leadCheckouts: () => [{ repo: 'demo/web', dir: '/work/lead1/web', baseBranch: 'main' }],
  };
  const asked = vi.fn(answer);
  const briefings = new BriefingDesk(host, { answer: asked });
  return { briefings, message, asked };
}

const ask = { briefing: 'save-journey', spot: { beat: 1, title: 'The outage' }, question: 'Why wait?' };

describe('BriefingDesk', () => {
  it('sends the question to a lead between turns, with the beat', async () => {
    const { briefings, message, asked } = desk('done', () => Promise.resolve({ text: 'unused' }));
    expect(await briefings.ask('lead1', ask)).toEqual({ by: 'lead' });
    expect(asked).not.toHaveBeenCalled();
    expect(message.mock.calls[0][1]).toContain('at beat 2, “The outage”): Why wait?');
    expect(message.mock.calls[0][2]).toEqual({ how: undefined });
  });

  it('has the quick answerer answer while the lead is busy, and tells the lead what it said', async () => {
    const { briefings, message, asked } = desk('working', () => Promise.resolve({ text: 'Because the database is down.' }));
    expect(await briefings.ask('lead1', ask)).toEqual({ by: 'quick', text: 'Because the database is down.' });
    const req = asked.mock.calls[0][0];
    expect(req).toMatchObject({ cwd: '/work/lead1', leadName: 'Lt. Adeyemi', recent: ['Building the store.'], briefing: { html: '<p>The page</p>' } });
    expect(message.mock.calls[0][1]).toContain('The quick answerer answered for you: Because the database is down.');
    expect(message.mock.calls[0][2]).toEqual({ from: QUICK_ANSWERER });
  });

  it('passes the question to the lead after all when the quick answerer fails', async () => {
    const { briefings, message } = desk('working', () => Promise.reject(new Error('timed out')));
    expect(await briefings.ask('lead1', ask)).toEqual({ by: 'lead' });
    expect(message.mock.calls[0][1]).toMatch(/^A question about your briefing/);
  });

  it('refuses a briefing that isn’t on the screen', async () => {
    const { briefings } = desk('done', () => Promise.resolve({ text: '' }));
    await expect(briefings.ask('lead1', { ...ask, briefing: 'nope' })).rejects.toThrow('Nothing called nope');
  });
});
