import { describe, expect, it } from 'vitest';
import { demoWorkspace } from './demoRunner';
import { focus, restarted, until } from './fakeFocus';
import { RESUMED_NOTE } from './runJournal';

// A lead's slices after Focus restarts, from their slice journal (sliceJournal.ts): each starts with Focus shutting
// down on purpose, the path a crash and an update both end up on.

const never = () => new Promise<never>(() => undefined);

describe('a lead’s slice after Focus restarts', () => {
  it('finishes a ship Focus cut off, then picks the lead’s turn back up, telling them', async () => {
    // the push never comes back: Focus shuts down while the slice is going out
    const before = focus({ ...demoWorkspace, push: never });
    const { agent } = before.agents.startGoal(before.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].hooks.session('lead-session');
    void before.claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    await until(() => before.store.agent(agent.id).status === 'pushing');
    expect(before.store.slice(agent.id)).toMatchObject({ phase: 'shipping', ship: { title: 'Saved items, first slice' } });

    before.agents.shutDown();
    const after = restarted(before.store);
    after.agents.recover();
    await until(() => before.store.slice(agent.id).phase === 'in-review');
    const lead = () => before.store.agent(agent.id).lead!;
    expect(lead().prs.map((p) => p.repo).sort()).toEqual(['demo/webshop-api', 'demo/webshop-frontend']);
    expect(before.store.slice(agent.id).prs).toHaveLength(2);
    // QA has them, from the commit the ship pushed
    for (const pr of lead().prs) expect(before.store.reviews.get(`${pr.repo}#${pr.number}`)?.shippedHead).toBe(pr.sha);

    // only then does the lead's turn pick back up, hearing what Ops did
    const turn = () => after.claude.turns.find((t) => t.req.agentId === agent.id);
    await until(() => !!turn());
    expect(turn()!.req).toMatchObject({ resumeSessionId: 'lead-session', prompt: expect.stringContaining(RESUMED_NOTE) });
    expect(turn()!.req.prompt).toMatch(/Focus restarted while your slice was shipping, so Ops finished it/);
  });

  it('finishes a move to fresh code Focus cut off, bringing the commits that never shipped', async () => {
    let moving = false;
    const picked: string[][] = [];
    const before = focus({
      ...demoWorkspace,
      // the move's checkout never finishes: Focus shuts down part way through it
      create: async (_repo, id) => (moving ? never() : `/demo/${id}`),
      unshippedCommits: async () => ['c1'],
    });
    const { agent } = before.agents.startGoal(before.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => before.claude.turns.length === 1);
    await before.claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    before.claude.turns[0].end({ ok: true, summary: 'Shipped' });
    await until(() => before.store.agent(agent.id).status === 'done');
    for (const pr of before.store.agent(agent.id).lead!.prs) before.agents.prClosed(pr.repo, pr.number, true);
    expect(before.store.slice(agent.id).phase).toBe('landed');

    moving = true;
    before.agents.message(agent.id, 'On to the next one');
    await until(() => before.store.slice(agent.id).phase === 'moving');
    expect(before.store.slice(agent.id).moving).toMatchObject({ slice: 2, carry: [{ commits: ['c1'] }, { commits: ['c1'] }] });

    before.agents.shutDown();
    const after = restarted(before.store, { ...demoWorkspace, cherryPick: async (_dir, commits) => void picked.push(commits) });
    after.agents.recover();
    await until(() => before.store.slice(agent.id).phase === 'working');
    const lead = before.store.agent(agent.id);
    expect(lead.lead).toMatchObject({ slice: 2, prs: [] });
    expect(lead.lead!.repos).toHaveLength(2);
    expect(lead.branch).toBe(before.store.slice(agent.id).branch);
    expect(picked).toEqual([['c1'], ['c1']]);
    // they hear it with the message that was waiting
    const turn = () => after.claude.turns.find((t) => t.req.agentId === agent.id);
    await until(() => !!turn() || before.store.run(agent.id).inbox.length > 0);
    const heard = turn()?.req.prompt ?? before.store.run(agent.id).inbox.join('\n\n');
    expect(heard).toMatch(/so Ops finished the move/);
    expect(heard).toContain('On to the next one');
  });

  it('watches a pull request again that the saved state lost', async () => {
    const before = focus();
    const { agent } = before.agents.startGoal(before.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => before.claude.turns.length === 1);
    await before.claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const shipped = before.store.agent(agent.id).lead!.prs;
    // Focus went down before the state with them in was saved
    before.store.putAgent({ ...before.store.agent(agent.id), lead: { ...before.store.agent(agent.id).lead!, prs: [] } });

    before.agents.shutDown();
    const after = restarted(before.store);
    after.agents.recover();
    expect(before.store.agent(agent.id).lead!.prs.map((p) => p.number).sort()).toEqual(shipped.map((p) => p.number).sort());
    expect(after.agents.leadPrs(before.project.id)).toHaveLength(2);
  });
});

describe('a lead’s slice when a pull request lands as they ship', () => {
  // A ship works from the slice's pull requests as they were when it started: one the captain merges while it's pushing
  // stays merged, and what was pushed onto its branch is carried as unshipped (docs/invariants.md#found-on-main).
  it('still knows a pull request merged that merged while the lead was shipping', async () => {
    // the push to hold up, once one's asked for: the others go straight through
    let hold = false;
    let release = () => undefined as void;
    const o = focus({ ...demoWorkspace, push: () => (hold ? ((hold = false), new Promise<void>((resolve) => (release = resolve))) : Promise.resolve()) });
    o.project.autoQa = false;
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => o.claude.turns.length === 1);
    const { tools } = o.claude.turns[0].req;
    const ship = (input: { title: string; summary: string }) => tools!.ship(input);
    await ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [first] = o.store.agent(agent.id).lead!.prs;

    // they ship again, and the captain merges the first pull request while the push is under way
    hold = true;
    const again = ship({ title: 'Saved items, first slice', summary: 'More of it.' });
    await until(() => o.store.agent(agent.id).status === 'pushing');
    o.agents.prClosed(first.repo, first.number, true);
    release();
    await again;
    expect(o.store.slice(agent.id).prs.find((p) => p.repo === first.repo && p.number === first.number)?.outcome).toBe('merged');
    expect(o.store.agent(agent.id).lead!.prs.find((p) => p.repo === first.repo && p.number === first.number)?.outcome).toBe('merged');
    // what was pushed onto its branch hasn't shipped: the shipped commit is still the one that merged
    expect(o.store.slice(agent.id).prs.find((p) => p.repo === first.repo && p.number === first.number)?.sha).toBe(first.sha);
    expect(await again).toContain(`${first.repo}#${first.number} was merged while the ship was pushing to it`);
  });
});

