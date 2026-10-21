import { describe, expect, it } from 'vitest';
import { office, until } from './agents/fakeOffice';
import { Inbox } from './captainsInbox';

/** An office with a lead whose first turn has ended, waiting on the captain, and its inbox. */
async function waitingLead() {
  const o = office();
  const inbox = new Inbox(o.store, { agents: o.agents, githubLogin: undefined });
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1);
  o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
  await until(() => o.store.agent(agent.id).status === 'done');
  const decisions = () => o.store.ledger.filter((e) => e.kind === 'captain-decision');
  return { ...o, inbox, id: agent.id, decisions };
}

describe('the captain’s inbox, as the API serves it', () => {
  it('lists a lead waiting for a reply, with its goal and an id that stays the same', async () => {
    const { inbox, id, store } = await waitingLead();
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ kind: 'turn', agentId: id, goal: 'Saved items', who: store.agent(id).name, id: `turn:${id}:${store.agent(id).finishedAt}` });
    expect(inbox.view().open[0].id).toBe(item.id);
  });

  it('answers an item by its id: the lead hears it, the item goes, and the decision is in the ledger', async () => {
    const { inbox, claude, decisions } = await waitingLead();
    const [item] = inbox.view().open;
    await inbox.decide(item.id, { text: 'Yes, start slice 2' }, 'api');
    await until(() => claude.turns.length === 2);
    expect(inbox.view().open).toEqual([]);
    expect(decisions()).toMatchObject([{ agent: item.who, goal: 'Saved items', item: { id: item.id, kind: 'turn', what: item.what }, answer: 'Yes, start slice 2', via: 'api' }]);
    expect(inbox.view().decided).toMatchObject([{ answer: 'Yes, start slice 2' }]);
  });

  it('refuses what doesn’t answer the item, and what’s no longer waiting', async () => {
    const { inbox, decisions } = await waitingLead();
    const [item] = inbox.view().open;
    await expect(inbox.decide(item.id, { allow: true }, 'api')).rejects.toThrow(/raised hand/);
    await expect(inbox.decide('turn:gone:1', { text: 'hi' }, 'api')).rejects.toThrow(/no longer waiting/);
    expect(decisions()).toEqual([]);
  });

  it('records the captain answering from Comms or a panel, but not a message to a lead at work', async () => {
    const { inbox, agents, claude, id, decisions } = await waitingLead();
    await inbox.answering(id, { text: 'Go on' }, 'office', () => agents.message(id, 'Go on'));
    await until(() => claude.turns.length === 2);
    await inbox.answering(id, { text: 'And add tests' }, 'office', () => agents.message(id, 'And add tests'));
    expect(decisions()).toMatchObject([{ answer: 'Go on', via: 'office' }]);
  });

  it('records a raised hand’s answer, and not a message sent while it’s up', async () => {
    const { inbox, agents, claude, id, store, decisions } = await waitingLead();
    await inbox.answering(id, { text: 'Go on' }, 'office', () => agents.message(id, 'Go on'));
    await until(() => claude.turns.length === 2);
    const answer = claude.turns[1].hooks.permission('Bash', 'npm publish', new AbortController().signal);
    await inbox.answering(id, { text: 'Careful' }, 'office', () => agents.message(id, 'Careful'));
    const [hand] = inbox.view().open;
    expect(hand.kind).toBe('hand');
    await inbox.decide(hand.id, { allow: false }, 'office');
    expect(await answer).toBe(false);
    expect(store.agent(id).permission).toBeUndefined();
    expect(decisions().map((d) => [d.item.kind, d.answer])).toEqual([['turn', 'Go on'], ['hand', 'Declined']]);
  });
});
