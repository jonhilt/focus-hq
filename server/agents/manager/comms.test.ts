import { describe, expect, it } from 'vitest';
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
