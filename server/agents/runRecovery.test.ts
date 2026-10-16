import { describe, expect, it } from 'vitest';
import { demoWorkspace } from './demoRunner';
import { office, restarted, until } from './fakeOffice';
import { RESUMED_NOTE } from './runJournal';

const issue = { number: 1, title: 'Add a dark mode toggle to the header' };

describe('a run after Focus restarts', () => {
  it('picks a turn it cut off back up in the same conversation, with the messages sent into it', async () => {
    const before = office();
    const { id } = before.agents.hire(before.project.id, 'demo/webshop-frontend', issue);
    await until(() => before.claude.turns.length === 1);
    before.agents.message(id, 'Also update the docs');
    expect(before.claude.turns[0].sent).toEqual(['Also update the docs']);

    // Focus stops part way through the turn: the store loads again, and the journal is what it kept
    const after = restarted(before.store);
    expect(before.store.agent(id).status).toBe('stopped');
    after.agents.recover();
    await until(() => after.claude.turns.length === 1);
    const { req } = after.claude.turns[0];
    expect(req.resumeSessionId).toBe('session-1');
    expect(req.prompt).toContain(RESUMED_NOTE);
    expect(req.prompt).toContain('Also update the docs');
    expect(before.store.agent(id).status).toBe('working');
    expect(before.store.run(id)).toMatchObject({ open: { prompt: req.prompt, resumes: 'session-1' }, last: { outcome: { ok: false } } });

    // and it ends like any other turn: delivered
    after.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
    await until(() => before.store.agent(id).status === 'done');
    expect(before.store.run(id).open).toBeUndefined();
    // the agent's panel reads where the run is from its journal
    expect(before.store.agent(id).run).toMatchObject({ phase: 'delivered', turns: 2, target: 'deliver', pr: before.store.agent(id).pr?.number });
  });

  it('picks it back up after the office shut down on purpose too (Ctrl-C, an update), but not after the captain’s stop', async () => {
    const before = office();
    const working = before.agents.hire(before.project.id, 'demo/webshop-frontend', issue).id;
    const stopped = before.agents.hire(before.project.id, 'demo/webshop-api', { number: 2, title: 'Rate-limit the login endpoint' }).id;
    await until(() => before.claude.turns.length === 2);
    before.agents.stop(stopped);
    await until(() => before.store.agent(stopped).status === 'stopped');
    before.agents.shutDown();
    expect(before.claude.turns.every((t) => t.stopped)).toBe(true);
    // the turn the shutdown stopped is left open, for the next start
    await new Promise((r) => setTimeout(r, 20));
    expect(before.store.run(working).open).toBeDefined();

    const after = restarted(before.store);
    after.agents.recover();
    await until(() => after.claude.turns.length === 1);
    expect(after.claude.turns[0].req).toMatchObject({ agentId: working, resumeSessionId: 'session-1', prompt: RESUMED_NOTE });
    expect(before.store.agent(stopped).status).toBe('stopped');
  });

  it('finishes putting their work on GitHub when Focus stopped part way, without another turn', async () => {
    // the push never comes back: Focus stops while it's under way
    const before = office({ ...demoWorkspace, push: () => new Promise<void>(() => undefined) });
    const { id } = before.agents.hire(before.project.id, 'demo/webshop-frontend', issue);
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
    await until(() => before.store.agent(id).status === 'pushing');
    expect(before.store.agent(id).run?.phase).toBe('delivering.pushing');

    const after = restarted(before.store);
    after.agents.recover();
    await until(() => before.store.agent(id).status === 'done');
    expect(after.claude.turns).toHaveLength(0);
    const pr = before.store.agent(id).pr?.number;
    expect(pr).toBeDefined();
    expect(before.store.agent(id).run).toMatchObject({ phase: 'delivered', pr });
  });

  it('puts an agent who was waiting for a free slot back in line', async () => {
    const before = office();
    before.project.maxAgents = 1;
    const first = before.agents.hire(before.project.id, 'demo/webshop-frontend', issue).id;
    const second = before.agents.hire(before.project.id, 'demo/webshop-api', { number: 2, title: 'Rate-limit the login endpoint' }).id;
    await until(() => before.claude.turns.length === 1);
    expect(before.store.agent(second)).toMatchObject({ status: 'queued', run: { phase: 'waiting' } });
    before.agents.shutDown();

    const after = restarted(before.store);
    expect(before.store.agent(second).status).toBe('stopped');
    after.agents.recover();
    // the one mid-turn carries on, and the one in line is in line again, to start once there's a slot
    await until(() => after.claude.turns.length === 1);
    expect(after.claude.turns[0].req.agentId).toBe(first);
    expect(before.store.agent(second)).toMatchObject({ status: 'queued', run: { phase: 'waiting' } });
    after.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
    await until(() => after.claude.turns.length === 2);
    expect(after.claude.turns[1].req.agentId).toBe(second);
  });

  it('keeps messages that were waiting, and hears them with the next', async () => {
    const before = office();
    const { id } = before.agents.hire(before.project.id, 'demo/webshop-frontend', issue);
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
    await until(() => before.store.agent(id).status === 'done');
    // taken for a turn's prompt, and Focus stopped before the turn was asked for
    before.store.journal(id, { kind: 'queued', text: 'Use the brand colours', at: 'end' });
    before.store.journal(id, { kind: 'taken' });

    const after = restarted(before.store);
    after.agents.recover();
    expect(before.store.run(id)).toMatchObject({ inbox: ['Use the brand colours'], owed: [] });
    after.agents.message(id, 'And the footer');
    await until(() => after.claude.turns.length === 1);
    expect(after.claude.turns[0].req.prompt).toBe('Use the brand colours\n\nAnd the footer');
  });

  it('leaves anyone who wasn’t mid-turn as they were', async () => {
    const before = office();
    const { id } = before.agents.hire(before.project.id, 'demo/webshop-frontend', issue);
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
    await until(() => before.store.agent(id).status === 'done');

    const after = restarted(before.store);
    after.agents.recover();
    expect(before.store.agent(id).status).toBe('done');
    expect(after.claude.turns).toHaveLength(0);
  });
});

describe('signing in', () => {
  it('stops a turn Claude Code signed in with the API key when the office meant your plan, and says where to look', async () => {
    const { agents, claude, project, store } = office();
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
    await until(() => claude.turns.length === 1);
    const { hooks } = claude.turns[0];
    hooks.signIn!(false);
    hooks.session('session-1', 'ANTHROPIC_API_KEY');
    await until(() => store.agent(id).status === 'error');
    expect(claude.turns[0].stopped).toBe(true);
    expect(store.agent(id).error).toMatch(/signed in with ANTHROPIC_API_KEY when the office meant your plan's login.*~\/\.claude\/settings\.json/);
    expect(store.run(id).last).toMatchObject({ onKey: false, keySource: 'ANTHROPIC_API_KEY', mismatch: 'ANTHROPIC_API_KEY' });
  });

  it('lets a turn on your plan carry on', async () => {
    const { agents, claude, project, store } = office();
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
    await until(() => claude.turns.length === 1);
    claude.turns[0].hooks.signIn!(false);
    claude.turns[0].hooks.session('session-1', 'none');
    expect(claude.turns[0].stopped).toBe(false);
    expect(store.run(id).open).toMatchObject({ onKey: false, keySource: 'none' });
  });
});
