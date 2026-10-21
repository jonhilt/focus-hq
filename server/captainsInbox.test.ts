import { describe, expect, it } from 'vitest';
import { office, until } from './agents/fakeOffice';
import type { CosRead } from '../shared/types';
import { Inbox } from './captainsInbox';
import { AUTO_SEND_MS } from '../shared/tricorder';
import type { FocusPlugin } from './plugins/contract';

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

/** An office whose leads' turns a plugin judges, as the chief of staff does, with `judged` for each. */
async function judgedLead(judged: NonNullable<CosRead['judged']>, { autoSend = false, since = Date.now }: { autoSend?: boolean; since?: () => number } = {}) {
  const o = office();
  o.project.cosAutoSend = autoSend;
  const judge: FocusPlugin = {
    id: 'judge',
    start: (host) => ({
      judgesTurns: (agent) => agent.task === 'lead',
      turn: (agent, phase) => void (phase === 'end' && host.goals.judged(agent.id, judged, since())),
    }),
  };
  o.agents.startPlugins([judge], { demo: false, ownRepo: () => undefined });
  const inbox = new Inbox(o.store, { agents: o.agents, githubLogin: undefined });
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1);
  o.claude.turns[0].end({ ok: true, summary: 'Settings page next.' });
  await until(() => o.store.agent(agent.id).status === 'done');
  return { ...o, inbox, id: agent.id, decisions: () => o.store.ledger.filter((e) => e.kind === 'captain-decision') };
}

describe('the captain’s inbox, with a chief of staff reading the leads’ turns', () => {
  it('files a turn it would carry on as ready, and sends its words to the lead, from it, when the captain says', async () => {
    const { inbox, claude, decisions } = await judgedLead({ route: 1, ask: 'Carry on to the settings page', why: 'Progress.', message: 'Go on to the settings page.' });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ kind: 'turn', lane: 'ready', what: 'Carry on to the settings page', cos: { route: 1 } });
    await inbox.decide(item.id, { send: true }, 'office');
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('[Chief of Staff] Go on to the settings page.');
    expect(decisions()).toMatchObject([{ item: { id: item.id, what: 'Carry on to the settings page' }, answer: 'Sent the chief of staff’s words' }]);
  });

  it('files a card under needs you, headed by its line, and won’t send words it has none ready for', async () => {
    const { inbox } = await judgedLead({ route: 2, ask: 'Slice 2: filters or drag-reorder first?', why: 'A pick.', message: 'Filters, the lead says.' });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ lane: 'needs-you', what: 'Slice 2: filters or drag-reorder first?' });
    await expect(inbox.decide(item.id, { send: true }, 'office')).rejects.toThrow(/words ready/);
  });
});


describe('the chief of staff’s words, sent by themselves where the captain lets it', () => {
  const carryOn = { route: 1 as const, ask: 'Carry on to the settings page', why: 'Progress.', message: 'Go on to the settings page.' };

  it('sends them once they’re due, recorded as sent by the chief of staff', async () => {
    const { inbox, claude, decisions, store, id } = await judgedLead(carryOn, { autoSend: true });
    const sendsAt = store.agent(id).lead?.cos?.sendsAt ?? 0;
    expect(sendsAt - Date.now()).toBeGreaterThan(AUTO_SEND_MS - 5000);
    await inbox.autoSend(sendsAt - 1);
    expect(claude.turns).toHaveLength(1);
    await inbox.autoSend(sendsAt);
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('[Chief of Staff] Go on to the settings page.');
    expect(decisions()).toMatchObject([{ answer: 'Sent the chief of staff’s words', via: 'chief-of-staff' }]);
  });

  it('holds them for the captain when they say so, and when the project stops letting it', async () => {
    const held = await judgedLead(carryOn, { autoSend: true });
    held.inbox.hold(held.inbox.view().open[0].id);
    expect(held.store.agent(held.id).lead?.cos).toMatchObject({ judged: { route: 1 } });
    expect(held.store.agent(held.id).lead?.cos?.sendsAt).toBeUndefined();
    await held.inbox.autoSend(Date.now() + AUTO_SEND_MS);
    expect(held.claude.turns).toHaveLength(1);

    const off = await judgedLead(carryOn, { autoSend: true });
    off.project.cosAutoSend = false;
    await off.inbox.autoSend(Date.now() + AUTO_SEND_MS);
    expect(off.claude.turns).toHaveLength(1);
  });

  it('never sends by itself what it would put to the captain, or where it isn’t let', async () => {
    const card = await judgedLead({ route: 2, ask: 'Filters or drag-reorder?', why: 'A pick.', message: 'Filters.' }, { autoSend: true });
    expect(card.store.agent(card.id).lead?.cos?.sendsAt).toBeUndefined();
    const notLet = await judgedLead(carryOn);
    expect(notLet.store.agent(notLet.id).lead?.cos?.sendsAt).toBeUndefined();
  });

  it('drops a verdict on an earlier turn, judged from before this one ended', async () => {
    const { store, id } = await judgedLead(carryOn, { since: () => 0 });
    expect(store.agent(id).lead?.cos?.judged).toBeUndefined();
  });
});
