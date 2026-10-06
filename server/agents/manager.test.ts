import { Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { demoLayer } from '../github/demo';
import { Hub } from '../hub';
import { Store } from '../store';
import { demoWorkspace } from './demoRunner';
import { AgentManager } from './manager';
import { Sessions, Triage, Workspace } from './services';
import type { PullRequest } from '../../shared/types';
import type { AgentRunner, AgentSession, RunHooks, RunOutcome, RunRequest } from './types';

/** A Claude Code stand-in: each turn runs until the test ends it, and remembers being stopped and what it was sent. */
class FakeClaude implements AgentRunner {
  turns: { req: RunRequest; hooks: RunHooks; end: (outcome: RunOutcome) => void; stopped: boolean; sent: string[] }[] = [];

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    let end!: (outcome: RunOutcome) => void;
    const done = new Promise<RunOutcome>((resolve) => (end = resolve));
    const turn = { req, hooks, end, stopped: false, sent: [] as string[] };
    this.turns.push(turn);
    hooks.session(req.resumeSessionId ?? 'session-1');
    return {
      send: (text) => (turn.sent.push(text), true),
      stop: () => {
        turn.stopped = true;
        end({ ok: false, summary: '', aborted: true });
      },
      done,
    };
  }
}

function office() {
  const store = new Store(false);
  const project = store.addProject('Shop');
  project.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
  const claude = new FakeClaude();
  const services = Layer.mergeAll(
    demoLayer,
    Workspace.fromOps(demoWorkspace),
    Sessions.fromRunner(claude),
    Triage.fromTriager({ triage: () => Promise.reject(new Error('no officer here')) }),
  );
  return { store, project, claude, agents: new AgentManager(store, new Hub(), services, () => undefined) };
}

/** Waits (a few seconds at most) for the office to get there. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

describe('AgentManager', () => {
  it('runs a goal’s lead one turn at a time, however often the office schedules', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.prompt).toMatch(/^Your workspace, with every repo of the project checked out side by side:\n- \.\/webshop-frontend/);
    agents.schedule();
    agents.schedule();
    agents.message(lead.id, 'Also the header');
    expect(claude.turns).toHaveLength(1);
    expect(claude.turns[0].sent).toEqual(['Also the header']);

    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');
    // two messages before they're back at it: one turn, which hears both
    agents.message(lead.id, 'Go ahead');
    agents.schedule();
    agents.message(lead.id, 'Small slices, please');
    await until(() => claude.turns.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(claude.turns).toHaveLength(2);
    const second = claude.turns[1];
    expect(second.req.resumeSessionId).toBe('session-1');
    expect([second.req.prompt, ...second.sent].join('\n\n')).toBe('Go ahead\n\nSmall slices, please');
  });

  it('stops their Claude Code session when they’re sent home', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await agents.dismiss(lead.id);
    expect(claude.turns[0].stopped).toBe(true);
    expect(store.agents.has(lead.id)).toBe(false);
  });

  it('hands a slice’s merge conflicts to its lead, even while they’re busy', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [pr] = store.agent(lead.id).lead!.prs;
    expect(store.agent(lead.id).status).toBe('working');

    const to = agents.resolveConflicts(project.id, { repo: pr.repo, number: pr.number, baseBranch: 'main' } as PullRequest);
    expect(to.id).toBe(lead.id);
    // the reviewer the slice brought along aside, nobody new sits down
    expect(claude.turns.filter((t) => t.req.agentId !== lead.id).map((t) => store.agent(t.req.agentId).task)).toEqual(['review']);
    expect(claude.turns.filter((t) => t.req.agentId === lead.id)).toHaveLength(1);
    expect(claude.turns[0].sent.at(-1)).toMatch(new RegExp(`^\\[Office\\] ${pr.repo}#${pr.number} has merge conflicts with \`main\`\\. Resolve them in \\./${pr.repo.split('/')[1]}`));
  });

  it('carries the goal into the next slice, as the captain put it, once the last one has landed', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items\nShoppers keep a list across devices') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');

    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    // the office summarises the conversation first, keeping the goal
    await until(() => leads().length === 2);
    expect(leads()[1].req.prompt).toMatch(/^\/compact Summarise this conversation for the lead of the goal "Saved items"/);
    expect(leads()[1].req.prompt).toContain('> Shoppers keep a list across devices');
    leads()[1].end({ ok: true, summary: 'Compacted' });

    await until(() => leads().length === 3);
    const next = leads()[2].req;
    expect(next.resumeSessionId).toBe('session-1');
    expect(next.prompt).toMatch(/^Slice 2 starts on fresh code/);
    expect(next.prompt).toContain('The office summarised your conversation to make room for this slice');
    expect(next.prompt).toContain('The goal: Saved items\n\nAs the captain first put it:\n> Saved items\n> Shoppers keep a list across devices');
    expect(next.prompt).toMatch(/\[Office\] Slice 1 has landed/);
  });

  it('tells a lead whose conversation can’t be picked back up where the goal stands', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items\nShoppers keep a list across devices') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.prompt).not.toContain('new conversation');
    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');

    store.agent(lead.id).sessionId = undefined;
    agents.message(lead.id, 'Go ahead');
    await until(() => claude.turns.length === 2);
    const fresh = claude.turns[1].req;
    expect(fresh.resumeSessionId).toBeUndefined();
    expect(fresh.prompt).toContain("You're carrying on with this goal in a new conversation");
    expect(fresh.prompt).toContain('> Shoppers keep a list across devices');
    expect(fresh.prompt).toMatch(/Go ahead$/);
  });

  it('says why when a goal can’t have the station it asked for, and queues one when every station is taken', () => {
    const { agents, project } = office();
    agents.startGoal(project.id, 'One', { station: 1 });
    expect(() => agents.startGoal(project.id, 'Two', { station: 1 })).toThrow('Team station 2 already has a goal: One');
    expect(() => agents.startGoal(project.id, ' ')).toThrow('Tell them what you’re after');
    for (const goal of ['Two', 'Three', 'Four']) agents.startGoal(project.id, goal);
    expect(agents.startGoal(project.id, 'Five')).toMatchObject({ queued: { text: 'Five' } });
  });
});
