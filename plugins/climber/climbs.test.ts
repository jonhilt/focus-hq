import { describe, expect, it } from 'vitest';
import { AWAY_DESK } from '../../shared/types';
import { demoWorkspace } from '../../server/agents/demoRunner';
import { office, until } from '../../server/agents/fakeOffice';
import type { WorkspaceOps } from '../../server/agents/types';
import type { Store } from '../../server/store';
import climber from './server';
import { climbingEngineer, type Climb } from './shared';

/** The pretend office with the climber switched on, its own repo the shop's frontend unless `ownRepo` says otherwise (null: none). */
function climbing(workspace: WorkspaceOps = demoWorkspace, ownRepo: string | null = 'demo/webshop-frontend') {
  const o = office(workspace);
  o.agents.startPlugins([climber], { demo: false, ownRepo: () => ownRepo ?? undefined });
  const keep = o.agents.plugins.routes().find((r) => r.plugin === 'climber' && r.route.path === '/keep-climbing');
  return {
    ...o,
    climb: () => o.store.plugins.climber as Climb,
    keepClimbing: (on: boolean) => keep?.route.handle({ body: { on }, query: {} }),
    // the office looks at the climb each time a board's read again
    settle: () => o.agents.plugins.boardRefreshed(o.project.id),
  };
}

const climbers = (store: Store) => [...store.agents.values()].filter((a) => a.brief?.plugin === 'climber');

describe('the climber', () => {
  it('climbs one pull request at a time while the captain keeps climbing, and starts the next once it merges', async () => {
    const { agents, claude, store, climb, keepClimbing, settle } = climbing();
    keepClimbing(true);
    await until(() => claude.turns.length === 1);
    const id = climb().agentId!;
    // the climber stands in main engineering, not at one of the room's desks
    expect(store.agent(id)).toMatchObject({ task: 'brief', brief: { plugin: 'climber', kind: 'climb' }, desk: AWAY_DESK, name: climbingEngineer().name, branch: expect.stringMatching(/^focus\/climb-/) });
    const branch = store.agent(id).branch;
    expect(claude.turns[0].req.prompt).toMatch(/^Climb demo\/webshop-frontend one step/);

    claude.turns[0].end({ ok: true, summary: '# Narrow the board’s lookups\n\n**Problem**\n\nSix non-null assertions.' });
    await until(() => !!store.agent(id).pr);
    const pr = store.agent(id).pr!;
    expect(store.agent(id).issue.title).toBe('Narrow the board’s lookups');
    settle();
    expect(climb()).toMatchObject({ keepClimbing: true, cycles: 1, pr: { number: pr.number } });
    settle();
    expect(climbers(store)).toHaveLength(1);
    // the office never merges a climb by itself
    expect(agents.plugins.captainMerges({ branch })).toBe(true);

    agents.prClosed('demo/webshop-frontend', pr.number, true, 'captain');
    await until(() => climb().cycles === 2);
    expect(climb().last).toMatchObject({ pr: pr.number, outcome: 'merged' });
    // the same engineer climbs again, in a fresh session on a new branch, their terminal carrying on
    expect(climb().agentId).toBe(id);
    await until(() => claude.turns.length === 2);
    expect(store.agent(id)).toMatchObject({ name: climbingEngineer().name, status: expect.not.stringMatching(/done/) });
    expect(store.agent(id).pr).toBeUndefined();
    expect(store.agent(id).branch).not.toBe(branch);
    expect(claude.turns[1].req.resumeSessionId).toBeUndefined();
    // and they remember the climb before, read from GitHub
    expect(claude.turns[0].req.prompt).toContain('This is your first climb.');
    expect(claude.turns[1].req.prompt).toContain(`#${pr.number} Narrow the board’s lookups (`);
  });

  it('switches climbing off, saying why, when a climb ends without a pull request', async () => {
    const { claude, store, climb, keepClimbing, settle } = climbing({ ...demoWorkspace, commitsAhead: () => Promise.resolve(0) });
    keepClimbing(true);
    await until(() => claude.turns.length === 1);
    const id = climb().agentId!;
    claude.turns[0].end({ ok: true, summary: 'Nothing worth changing: the scorecard is clean.' });
    await until(() => store.agent(id).status === 'done');
    settle();
    expect(climb()).toMatchObject({ keepClimbing: false, agentId: undefined, last: { outcome: 'nothing' } });
    expect(climb().stoppedWhy).toMatch(/found nothing to change/);
    settle();
    expect(climbers(store)).toHaveLength(1);
  });

  it('holds on to the climb’s pull request from the moment it opens, even once the climber has gone home', async () => {
    const { agents, claude, store, climb, keepClimbing, settle } = climbing();
    keepClimbing(true);
    await until(() => claude.turns.length === 1);
    const id = climb().agentId!;
    claude.turns[0].end({ ok: true, summary: '# Narrow the board’s lookups\n\n**Problem**\n\nSix non-null assertions.' });
    await until(() => !!store.agent(id).pr);
    const pr = store.agent(id).pr!;
    expect(climb().pr).toEqual({ number: pr.number, url: pr.url });

    // sent home before any board refresh looked at the climb: it waits for its PR rather than switching off
    await agents.dismiss(id);
    settle();
    expect(climb()).toMatchObject({ keepClimbing: true, pr: { number: pr.number } });
    expect(climbers(store)).toHaveLength(0);
  });

  it('won’t climb without the office’s own repo in a project', () => {
    const { store, keepClimbing } = climbing(demoWorkspace, null);
    expect(() => keepClimbing(true)).toThrow(/Connect the office’s own repository/);
    expect(store.plugins.climber).toBeUndefined();
  });
});
