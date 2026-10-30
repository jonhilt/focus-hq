import { describe, expect, it } from 'vitest';
import { needsYou } from '../../../shared/tricorder';
import type { Agent, TermLine } from '../../../shared/types';
import { focus, until } from '../fakeFocus';

const issue = { number: 1, title: 'Add a dark mode toggle to the header' };
const running = { id: 'b1', kind: 'shell', description: 'pnpm test', status: 'running', startedAt: 5 } as const;

describe('stopping a background task', () => {
  it('stops it in the session, then tells the agent', async () => {
    const { agents, claude, project, store } = focus();
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
    await until(() => claude.turns.length === 1);
    store.agent(id).background = [running];
    expect(await agents.stopBackground(id, 'b1')).toEqual({ stopped: true });
    expect(claude.turns[0].stoppedTasks).toEqual(['b1']);
    expect(claude.turns[0].sent).toEqual(['I stopped your background command `pnpm test`. Start it again if you still need it.']);
  });

  it('leaves the session and the agent alone when the task isn’t running', async () => {
    const { agents, claude, project, store } = focus();
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
    await until(() => claude.turns.length === 1);
    store.agent(id).background = [{ ...running, status: 'done' }];
    expect(await agents.stopBackground(id, 'b1')).toEqual({ stopped: false });
    expect(await agents.stopBackground('nobody', 'b1')).toEqual({ stopped: false });
    expect(claude.turns[0].stoppedTasks).toEqual([]);
    expect(claude.turns[0].sent).toEqual([]);
  });

  it('doesn’t tell the agent about a stop their session refused', async () => {
    const { agents, claude, project, store } = focus();
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
    await until(() => claude.turns.length === 1);
    store.agent(id).background = [running];
    claude.deaf = true;
    expect(await agents.stopBackground(id, 'b1')).toEqual({ stopped: false });
    expect(claude.turns[0].sent).toEqual([]);
  });
});

describe('a lead’s proposal to close the goal', () => {
  const attention = (agent: Agent) => needsYou([agent], [], new Map()).map((a) => a.kind);
  const setAside = (lines: TermLine[]) => lines.filter((l) => l.text.includes('set aside'));

  /** A lead whose first turn proposed closing the goal, and ended: the user is asked to close it. */
  const proposed = async () => {
    const o = focus();
    const started = o.agents.startGoal(o.project.id, 'Saved items');
    if (!('agent' in started)) throw new Error('the goal was queued');
    const { agent } = started;
    await until(() => o.claude.turns.length === 1);
    await o.claude.turns[0].req.tools?.proposeClose({ reason: 'Saved items work end to end' });
    o.claude.turns[0].end({ ok: true, summary: 'Ready to close' });
    await until(() => o.store.agent(agent.id).status === 'done');
    expect(attention(o.store.agent(agent.id))).toEqual(['wrap-up']);
    return { ...o, id: agent.id };
  };

  it('is set aside as their next turn starts when the chief of staff wakes them, and made again normally in it', async () => {
    const { agents, claude, store, id } = await proposed();
    agents.message(id, 'QA passed it: carry on with the next slice', 'Chief of Staff');
    await until(() => claude.turns.length === 2);
    expect(store.agent(id).lead?.closing).toBeUndefined();
    expect(attention(store.agent(id))).not.toContain('wrap-up');
    const surname = store.agent(id).name.split(' ').at(-1);
    expect(setAside(store.recentLines(id)).map((l) => l.text)).toEqual([`✻ Close the goal? — set aside: ${surname} carried on`]);

    // proposing again in the new turn asks the user again
    await claude.turns[1].req.tools?.proposeClose({ reason: 'Now it is' });
    claude.turns[1].end({ ok: true, summary: 'Ready to close' });
    await until(() => store.agent(id).status === 'done');
    expect(attention(store.agent(id))).toEqual(['wrap-up']);
  });

  it('is cleared by the user’s own reply, with no line saying it was set aside', async () => {
    const { agents, claude, store, id } = await proposed();
    agents.message(id, 'Not yet: the empty state too');
    expect(store.agent(id).lead?.closing).toBeUndefined();
    await until(() => claude.turns.length === 2);
    expect(setAside(store.recentLines(id))).toEqual([]);
  });
});
