import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusPlugin, PluginHost } from '../../plugin-api/server';
import { focus, until } from '../../plugin-api/testing';
import { Inbox } from './captainsInbox';
import { judged, reading } from './laneRules';
import chiefOfStaff from './server';
import { AUTO_SEND_MS, CHIEF_OF_STAFF, type CosState, readOf, type Verdict } from './shared';

afterEach(() => vi.unstubAllEnvs());

/**
 * A Focus with the inbox on, and a lead whose first turn has ended, waiting on the captain. With `verdict`, the turn is
 * judged as it ends (as the chief of staff does, judging from `since`), in a project that lets it send its words by
 * itself or not (`autoSend`).
 */
async function waitingLead({ verdict, autoSend = false, since = Date.now }: { verdict?: Verdict; autoSend?: boolean; since?: () => number } = {}) {
  const o = focus();
  o.project.plugins = [CHIEF_OF_STAFF];
  const inbox: { it?: Inbox; host?: PluginHost } = {};
  const plugin: FocusPlugin = {
    id: CHIEF_OF_STAFF,
    start: (host: PluginHost) => {
      const it = new Inbox(host, () => autoSend);
      inbox.it = it;
      inbox.host = host;
      return {
        captainAnswered: (before, answer) => it.answered(before, answer),
        closeHeld: (lead) => it.closeHeld(lead),
        turn: (agent, phase) => {
          if (phase !== 'end' || !verdict) return;
          const at = Date.now();
          host.goals.mark(agent.id, reading(at), at);
          const read = judged(readOf(host.agent(agent.id)), verdict, since(), autoSend, Date.now());
          if (read) host.goals.mark(agent.id, read, since());
        },
      };
    },
  };
  o.agents.startPlugins([plugin], { demo: false, ownRepo: () => undefined });
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1);
  o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
  await until(() => o.store.agent(agent.id).status === 'done');
  const decisions = () => o.store.ledger.filter((e) => e.kind === 'captain-decision');
  if (!inbox.it) throw new Error('the plugin didn’t start');
  const { host } = inbox;
  if (!host) throw new Error('the plugin didn’t start');
  /** Ops merging one of the lead's pull requests in `lane`, as the ledger has it. */
  const merged = (pr: number, lane: 'ship' | 'show' | 'ask' = 'show', lead = agent.id) =>
    host.record(o.project.id, { kind: 'merged', repo: 'demo/webshop-frontend', pr, goal: 'Saved items', by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead, lane });
  return { ...o, inbox: inbox.it, host, id: agent.id, decisions, merged, read: () => readOf(o.store.agent(agent.id)) };
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

  it('records the captain answering from an agent’s panel, but not a message to a lead at work', async () => {
    const { agents, claude, id, decisions } = await waitingLead();
    await agents.captainAnswers(id, { text: 'Go on' }, () => agents.message(id, 'Go on'));
    await until(() => claude.turns.length === 2);
    await agents.captainAnswers(id, { text: 'And add tests' }, () => agents.message(id, 'And add tests'));
    expect(decisions()).toMatchObject([{ answer: 'Go on', via: 'office' }]);
  });

  it('records a raised hand’s answer, and not a message sent while it’s up', async () => {
    const { inbox, agents, claude, id, store, decisions } = await waitingLead();
    await agents.captainAnswers(id, { text: 'Go on' }, () => agents.message(id, 'Go on'));
    await until(() => claude.turns.length === 2);
    const answer = claude.turns[1].hooks.permission('Bash', 'npm publish', new AbortController().signal);
    await agents.captainAnswers(id, { text: 'Careful' }, () => agents.message(id, 'Careful'));
    const [hand] = inbox.view().open;
    expect(hand.kind).toBe('hand');
    await inbox.decide(hand.id, { allow: false }, 'office');
    expect(await answer).toBe(false);
    expect(store.agent(id).permission).toBeUndefined();
    expect(decisions().map((d) => [d.item.kind, d.answer])).toEqual([['turn', 'Go on'], ['hand', 'Declined']]);
  });

  it('records nothing for an answer Ops came back to ask about', async () => {
    const { agents, id, decisions } = await waitingLead();
    await agents.captainAnswers(id, { text: 'Go on' }, () => ({ costly: { usd: 4 } }));
    expect(decisions()).toEqual([]);
  });
});

describe('the captain’s inbox, with the chief of staff reading the leads’ turns', () => {
  it('files a turn it would carry on as ready, and sends its words to the lead, from it, when the captain says', async () => {
    const { inbox, claude, decisions } = await waitingLead({ verdict: { route: 1, asks: [{ ask: 'Carry on to the settings page' }], why: 'Progress.', message: 'Go on to the settings page.' } });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ kind: 'turn', lane: 'ready', what: 'Carry on to the settings page', cos: { route: 1 } });
    await inbox.decide(item.id, { send: true }, 'office');
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('[Chief of Staff] Go on to the settings page.');
    expect(decisions()).toMatchObject([{ item: { id: item.id, what: 'Carry on to the settings page' }, answer: 'Sent the chief of staff’s words' }]);
  });

  it('files a card under needs you, headed by its line, and won’t send words it has none ready for', async () => {
    const { inbox } = await waitingLead({ verdict: { route: 2, asks: [{ ask: 'Slice 2: filters or drag-reorder first?' }], why: 'A pick.', message: 'Filters, the lead says.' } });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ lane: 'needs-you', what: 'Slice 2: filters or drag-reorder first?' });
    await expect(inbox.decide(item.id, { send: true }, 'office')).rejects.toThrow(/words ready/);
  });
});

describe('acknowledging a lead’s turn (Got it)', () => {
  const replies = [{ label: 'Close it', text: 'Close it: it’s done.' }];
  const card = { route: 2 as const, asks: [{ ask: 'Keep the goal open, or close it?', replies }], why: 'A pick.', message: 'Close it, the lead says.' };

  it('reads it and takes it off the queue, sends nothing, and records it as the captain’s', async () => {
    const { inbox, claude, id, store, decisions } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    expect(item.cos?.replies).toEqual(replies);
    await inbox.decide(item.id, { ack: true }, 'office');
    expect(inbox.view().open).toEqual([]);
    expect(store.agent(id).lead?.readTurn).toBe(store.agent(id).finishedAt);
    expect(readOf(store.agent(id))).toMatchObject({ judged: card, acked: expect.any(Number) });
    expect(decisions()).toMatchObject([{ item: { id: item.id, kind: 'turn', what: 'Keep the goal open, or close it?' }, answer: 'Acknowledged', via: 'office' }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claude.turns).toHaveLength(1);
    await expect(inbox.decide(item.id, { ack: true }, 'office')).rejects.toThrow(/no longer waiting/);
  });

  it('acknowledges a turn nobody judged, and the lead’s next turn brings the queue back', async () => {
    const { inbox, agents, claude, id, store } = await waitingLead();
    const [item] = inbox.view().open;
    await inbox.decide(item.id, { ack: true }, 'api');
    expect(inbox.view().open).toEqual([]);
    expect(readOf(store.agent(id))?.acked).toEqual(expect.any(Number));
    // the captain's next message wakes them, and their next turn starts afresh
    agents.message(id, 'Close it');
    await until(() => claude.turns.length === 2);
    expect(readOf(store.agent(id))).toBeUndefined();
    claude.turns[1].end({ ok: true, summary: 'Closed. Anything else?' });
    await until(() => inbox.view().open.length === 1);
  });

  it('stops its words going by themselves', async () => {
    const { inbox, claude, read } = await waitingLead({ verdict: { route: 4, asks: [{ ask: 'Test it first' }], why: 'No evidence.', message: 'Test it first.' }, autoSend: true });
    const sendsAt = read()?.sendsAt ?? 0;
    await inbox.decide(inbox.view().open[0].id, { ack: true }, 'office');
    expect(read()?.sendsAt).toBeUndefined();
    await inbox.autoSend(sendsAt + 1);
    expect(claude.turns).toHaveLength(1);
  });
});

describe('a turn that asks several things, each answered on its own', () => {
  const asks = [
    { ask: 'Next slice: shared link or emails?', replies: [{ label: 'Shared link', text: 'Shared link first.' }, { label: 'Emails', text: 'Emails first.' }] },
    { ask: 'Keep the old endpoint for a release?', replies: [{ label: 'Keep it', text: 'Keep it for a release.' }] },
    { ask: 'Rename the setting?' },
  ];
  const card = { route: 2 as const, asks, why: 'Three calls.', message: 'Three things to decide.' };
  const answer = (ask: number, text: string) => ({ answer: { ask, text } });

  it('holds each answer on the turn, sending the lead nothing, and lets one be changed', async () => {
    const { inbox, claude, decisions, read } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ what: 'Next slice: shared link or emails? (+2 more)', lane: 'needs-you' });
    expect(await inbox.decide(item.id, answer(0, 'Emails first.'), 'office')).toEqual({ ok: true, held: 1, of: 3 });
    await inbox.decide(item.id, answer(0, 'Shared link first.'), 'office');
    await inbox.decide(item.id, answer(2, 'Yes, call it “Saved lists”.'), 'api');
    expect(read()?.answers).toEqual([{ ask: 0, text: 'Shared link first.' }, { ask: 2, text: 'Yes, call it “Saved lists”.' }]);
    expect(inbox.view().open[0]).toMatchObject({ id: item.id, answers: read()?.answers });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claude.turns).toHaveLength(1);
    expect(decisions()).toEqual([]);
  });

  it('keeps what’s held where the turn’s read is, so an inbox started afresh (a reload, a restart) still has it', async () => {
    const { inbox, host, read } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    await inbox.decide(item.id, answer(1, 'Keep it for a release.'), 'office');
    const afresh = new Inbox(host, () => false);
    expect(afresh.view().open[0]?.answers).toEqual([{ ask: 1, text: 'Keep it for a release.' }]);
    expect(read()?.answers).toEqual([{ ask: 1, text: 'Keep it for a release.' }]);
  });

  it('sends every answer to the lead together, as one message under each ask’s headline, once the last is answered', async () => {
    const { inbox, claude, decisions } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    await inbox.decide(item.id, answer(0, 'Shared link first.'), 'office');
    await inbox.decide(item.id, answer(2, 'Leave it as it is.'), 'office');
    expect(await inbox.decide(item.id, answer(1, 'Keep it for a release.'), 'office')).toEqual({ ok: true });
    await until(() => claude.turns.length === 2);
    const together = '**Next slice: shared link or emails?**\nShared link first.\n\n**Keep the old endpoint for a release?**\nKeep it for a release.\n\n**Rename the setting?**\nLeave it as it is.';
    expect(claude.turns[1].req.prompt).toContain(together);
    expect(claude.turns[1].req.prompt).not.toContain('[Chief of Staff]');
    expect(decisions()).toMatchObject([{ item: { id: item.id, what: item.what }, answer: together, via: 'office' }]);
    expect(inbox.view().open).toEqual([]);
  });

  it('clears the whole turn with Got it, sending nothing of what was held', async () => {
    const { inbox, claude, decisions } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    await inbox.decide(item.id, answer(0, 'Emails first.'), 'office');
    await inbox.decide(item.id, { ack: true }, 'office');
    expect(inbox.view().open).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claude.turns).toHaveLength(1);
    expect(decisions()).toMatchObject([{ answer: 'Acknowledged' }]);
  });

  it('refuses an ask the turn doesn’t have, and an answer on what isn’t a judged turn', async () => {
    const { inbox } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    await expect(inbox.decide(item.id, answer(3, 'x'), 'api')).rejects.toThrow(/no such ask/);
    const unjudged = await waitingLead();
    await expect(unjudged.inbox.decide(unjudged.inbox.view().open[0]?.id ?? '', answer(0, 'x'), 'api')).rejects.toThrow(/ask by ask/);
  });

  it('answers a turn of one ask at once, as its suggested reply always did', async () => {
    const { inbox, claude, decisions } = await waitingLead({ verdict: { ...card, asks: [asks[0] ?? { ask: '' }] } });
    const [item] = inbox.view().open;
    await inbox.decide(item.id, answer(0, 'Emails first.'), 'api');
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('Emails first.');
    expect(decisions()).toMatchObject([{ answer: 'Emails first.', via: 'api' }]);
  });
});

describe('the chief of staff’s words, sent by themselves where the captain lets it', () => {
  const sendBack = { route: 4 as const, asks: [{ ask: 'Show the settings page working' }], why: 'It says it works with nothing behind it.', message: 'Show the settings page working before it goes to the captain.' };
  const carryOn = { route: 1 as const, asks: [{ ask: 'Carry on to the settings page' }], why: 'Progress.', message: 'Go on to the settings page.' };

  it('sends a turn back to the lead once they’re due, recorded as sent by the chief of staff', async () => {
    const { inbox, claude, decisions, read } = await waitingLead({ verdict: sendBack, autoSend: true });
    const sendsAt = read()?.sendsAt ?? 0;
    expect(sendsAt - Date.now()).toBeGreaterThan(AUTO_SEND_MS - 5000);
    await inbox.autoSend(sendsAt - 1);
    expect(claude.turns).toHaveLength(1);
    await inbox.autoSend(sendsAt);
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('[Chief of Staff] Show the settings page working before it goes to the captain.');
    expect(decisions()).toMatchObject([{ answer: 'Sent the chief of staff’s words', via: 'chief-of-staff' }]);
  });

  it('holds them for the captain when they say so', async () => {
    const held = await waitingLead({ verdict: sendBack, autoSend: true });
    held.inbox.hold(held.inbox.view().open[0].id);
    expect(held.read()).toMatchObject({ judged: { route: 4 } });
    expect(held.read()?.sendsAt).toBeUndefined();
    await held.inbox.autoSend(Date.now() + AUTO_SEND_MS);
    expect(held.claude.turns).toHaveLength(1);
  });

  it('never sends by itself what it would put to the captain, words carrying a lead on, or where it isn’t let', async () => {
    const card = await waitingLead({ verdict: { route: 2, asks: [{ ask: 'Filters or drag-reorder?' }], why: 'A pick.', message: 'Filters.' }, autoSend: true });
    expect(card.read()?.sendsAt).toBeUndefined();
    const onwards = await waitingLead({ verdict: carryOn, autoSend: true });
    expect(onwards.read()).toMatchObject({ judged: { route: 1 } });
    expect(onwards.read()?.sendsAt).toBeUndefined();
    const notLet = await waitingLead({ verdict: sendBack });
    expect(notLet.read()?.sendsAt).toBeUndefined();
  });

  it('drops a verdict on an earlier turn, judged from before this one ended', async () => {
    const { read } = await waitingLead({ verdict: carryOn, since: () => 0 });
    expect(read()).toMatchObject({ at: expect.any(Number) });
    expect(read()?.judged).toBeUndefined();
  });
});

describe('the chief of staff plugin’s setting for sending its words by itself', () => {
  const said = (uuid: string, text: string) => JSON.stringify({ type: 'assistant', uuid, timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text }] } });

  /** Focus with the plugin itself switched on (the demo's judge, which carries on a turn that asks nothing), and a lead at work. */
  async function aboard(legacy: boolean) {
    vi.stubEnv('FOCUS_DEMO_SPEED', '1000');
    const o = focus();
    o.project.plugins = [CHIEF_OF_STAFF];
    // what a Focus from before kept on the project, when the setting was the core's
    if (legacy) Reflect.set(o.project, 'cosAutoSend', true);
    o.agents.startPlugins([chiefOfStaff], { demo: true, ownRepo: () => undefined, transcript: () => Promise.resolve(said('t1', 'Slice 1 is up, untested. Writing the settings page next.')) });
    const route = (path: string) => {
      const found = o.agents.plugins.routes().find((r) => r.route.path === path && !r.route.bot)?.route;
      if (!found) throw new Error(`no route ${path}`);
      return (body: Record<string, unknown> = {}, params: Record<string, string> = {}) => found.handle({ body, query: {}, params });
    };
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items');
    await until(() => o.claude.turns.length === 1 && !!o.store.agents.get(agent.id)?.sessionId);
    const read = () => readOf(o.store.agent(agent.id));
    const state = () => o.agents.plugins.stateOf(CHIEF_OF_STAFF) as CosState | undefined;
    return { ...o, id: agent.id, route, read, state };
  }

  it('carries over a project set to auto-send before the setting was the chief of staff’s', async () => {
    const o = await aboard(true);
    o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
    await until(() => !!o.read()?.judged);
    expect(o.read()).toMatchObject({ judged: { route: 4 }, sendsAt: expect.any(Number) });
  });

  it('sends nothing by itself in a project that never said so', async () => {
    const o = await aboard(false);
    o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
    await until(() => !!o.read()?.judged);
    expect(o.read()?.sendsAt).toBeUndefined();
  });

  it('takes the captain’s say over what was carried over, holding words that were counting down once it’s off', async () => {
    const o = await aboard(true);
    o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
    await until(() => o.read()?.sendsAt !== undefined);
    o.route('/auto-send')({ projectId: o.project.id, on: false });
    expect(o.state()).toEqual({ autoSend: { [o.project.id]: false }, jev: {} });
    expect(o.read()).toMatchObject({ judged: { route: 4 } });
    expect(o.read()?.sendsAt).toBeUndefined();
    expect(() => o.route('/auto-send')({ on: true })).toThrow(/projectId/);
  });

  it('keeps the captain’s say on Route with Jev apart from auto-send, each switch leaving the other as it was', async () => {
    const o = await aboard(false);
    o.route('/jev')({ projectId: o.project.id, on: true });
    o.route('/auto-send')({ projectId: o.project.id, on: true });
    expect(o.state()).toEqual({ autoSend: { [o.project.id]: true }, jev: { [o.project.id]: true } });
    expect(() => o.route('/jev')({ on: true })).toThrow(/projectId/);
  });

  it('serves a goal’s thread by its lead’s id: what the lead said and what the chief of staff made of it', async () => {
    const o = await aboard(false);
    o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
    await until(() => !!o.read()?.judged);
    const { entries } = (await o.route('/thread/:id')({}, { id: o.id })) as { entries: { kind: string }[] };
    expect(entries.map((e) => e.kind)).toEqual(expect.arrayContaining(['lead', 'cos']));
    await expect(o.route('/thread/:id')({}, { id: 'nobody' })).rejects.toThrow(/isn’t aboard/);
  });

  it('serves the inbox on its routes, an item answered by its id', async () => {
    const o = await aboard(false);
    o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
    await until(() => !!o.read()?.judged);
    const view = o.route('/inbox')() as { open: { id: string; lane: string }[] };
    expect(view.open).toMatchObject([{ lane: 'ready' }]);
    await o.route('/inbox/:id/decide')({ send: true }, { id: view.open[0].id });
    await until(() => o.claude.turns.length === 2);
    expect(o.claude.turns[1].req.prompt).toContain('[Chief of Staff] Before this goes to the captain, test what you built');
  });

  it('keeps the goal at the conn until the captain stands down, and only a goal aboard', async () => {
    const o = await aboard(false);
    o.route('/conn')({ lead: o.id });
    expect(o.state()?.conn).toBe(o.id);
    expect(() => o.route('/conn')({ lead: 'nobody' })).toThrow(/isn’t aboard/);
    expect(o.state()?.conn).toBe(o.id);
    o.route('/conn')({ lead: null });
    expect(o.state()?.conn).toBeUndefined();
  });

  it('stands a waiting hail by into the muster, and refuses one that isn’t waiting', async () => {
    const o = await aboard(false);
    o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
    await until(() => !!o.read()?.judged);
    const [item] = (o.route('/inbox')() as { open: { id: string }[] }).open;
    o.route('/stand-by')({ key: item.id });
    o.route('/stand-by')({ key: item.id });
    expect(o.state()?.stoodBy).toEqual([item.id]);
    expect(() => o.route('/stand-by')({ key: 'turn:gone:1' })).toThrow(/isn’t waiting/);
  });
  describe('the user’s one-tap word on a turn (README.md#didnt-need-me-and-you-should-have-asked-me)', () => {
    const feedbackLines = (o: Awaited<ReturnType<typeof aboard>>) => o.store.ledger.filter((e) => e.kind === 'captain-feedback');

    it('records a press on a judged turn as a captain-feedback line naming the turn, its verdict and where it was pressed', async () => {
      const o = await aboard(false);
      o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
      await until(() => !!o.read()?.judged);
      // the read names the turn its verdict names, so the card can say which turn it's about
      expect(o.read()?.turnUuid).toBe('t1');
      const verdict = o.store.ledger.find((e) => e.kind === 'cos-verdict');
      const lead = o.store.agent(o.id);
      const got = await o.route('/feedback')({ agentId: o.id, turnUuid: 't1', signal: 'not-needed', via: 'comms' });
      expect(got).toEqual({ pressed: ['not-needed'] });
      const [line] = feedbackLines(o);
      expect(line).toEqual({
        kind: 'captain-feedback', signal: 'not-needed', agent: lead?.name, goal: 'Saved items', sessionId: lead?.sessionId, turnUuid: 't1',
        verdictSeq: verdict?.seq, route: 4, via: 'comms', seq: expect.any(Number), at: expect.any(Number), projectId: o.project.id,
      });
      // every browser hears what's pressed, by the turn
      expect((o.state() as { feedback?: unknown } | undefined)?.feedback).toEqual({ [`${lead?.sessionId}:t1`]: ['not-needed'] });
    });

    it('takes a press back when it’s pressed again, with an undo line, the ledger kept append-only', async () => {
      const o = await aboard(false);
      o.claude.turns[0].end({ ok: true, summary: 'Writing the settings page next.' });
      await until(() => !!o.read()?.judged);
      const press = { agentId: o.id, turnUuid: 't1', signal: 'should-have-asked', via: 'phone' };
      await o.route('/feedback')(press);
      expect(await o.route('/feedback')(press)).toEqual({ pressed: [] });
      expect(feedbackLines(o).map((e) => (e.kind === 'captain-feedback' ? [e.signal, e.via, e.undo ?? false] : []))).toEqual([['should-have-asked', 'phone', false], ['should-have-asked', 'phone', true]]);
      expect(await o.route('/feedback')(press)).toEqual({ pressed: ['should-have-asked'] });
      expect(feedbackLines(o)).toHaveLength(3);
    });

    it('records a lead’s message in Talk by its transcript’s line, with no verdict where the chief of staff never judged it', async () => {
      const o = await aboard(false);
      await expect(o.route('/feedback')({ agentId: o.id, turnUuid: 't1', signal: 'should-have-asked', via: 'talk' })).resolves.toEqual({ pressed: ['should-have-asked'] });
      const [line] = feedbackLines(o);
      expect(line).toMatchObject({ turnUuid: 't1', via: 'talk' });
      expect(line).not.toHaveProperty('verdictSeq');
      expect(line).not.toHaveProperty('route');
    });

    it('refuses a press that doesn’t name a lead’s turn, writing nothing', async () => {
      const o = await aboard(false);
      const ok = { agentId: o.id, turnUuid: 't1', signal: 'not-needed', via: 'comms' };
      await expect(o.route('/feedback')({ ...ok, agentId: 'nobody' })).rejects.toThrow(/isn’t aboard/);
      await expect(o.route('/feedback')({ ...ok, turnUuid: 'made-up' })).rejects.toThrow(/isn’t one of/);
      await expect(o.route('/feedback')({ ...ok, signal: 'meh' })).rejects.toThrow(/signal/);
      await expect(o.route('/feedback')({ ...ok, via: 'email' })).rejects.toThrow(/via/);
      await expect(o.route('/feedback')({ ...ok, turnUuid: '' })).rejects.toThrow(/turnUuid/);
      expect(feedbackLines(o)).toEqual([]);
    });
  });
});

describe('the chief of staff’s inbox for a bot (docs/ledger.md#the-captains-inbox-api)', () => {
  const PUBLIC = 'https://mac.ts.net:4477';

  /** Focus with the plugin on, lent a bot that reaches it at `PUBLIC`, and a lead whose turn ended showing a page. */
  async function forTheBot() {
    const o = focus();
    o.project.plugins = [CHIEF_OF_STAFF];
    o.agents.startPlugins([chiefOfStaff], { demo: false, ownRepo: () => undefined, bot: () => ({ token: 'k', publicUrl: PUBLIC }) });
    const botRoute = (method: string, path: string) => {
      const found = o.agents.plugins.routes().find((r) => r.route.bot && r.route.method === method && r.route.path === path)?.route;
      if (!found) throw new Error(`no bot route ${method} ${path}`);
      return (body: Record<string, unknown> = {}, params: Record<string, string> = {}) => found.handle({ body, query: {}, params });
    };
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items');
    await until(() => o.claude.turns.length === 1);
    o.claude.turns[0].end({ ok: true, summary: 'Here’s the mockup. Shall I build it?' });
    await until(() => o.store.agent(agent.id).status === 'done');
    const lead = o.store.agent(agent.id);
    if (!lead.lead) throw new Error('no lead work');
    o.store.putAgent({ ...lead, lead: { ...lead.lead, artifacts: [{ id: 'mock', title: 'Mockup', at: Date.now(), image: true }] } });
    return { ...o, id: agent.id, botRoute, decisions: () => o.store.ledger.filter((e) => e.kind === 'captain-decision') };
  }

  it('serves what the lead showed as whole links, at Focus’s address as the bot reaches it', async () => {
    const o = await forTheBot();
    const view = o.botRoute('get', '/inbox')() as { open: { shown?: { html: string; image?: string }[] }[] };
    const [shown] = view.open[0]?.shown ?? [];
    expect(shown?.html.startsWith(`${PUBLIC}/api/artifacts/${o.id}/`)).toBe(true);
    expect(shown?.image?.startsWith(`${PUBLIC}/api/artifacts/${o.id}/`)).toBe(true);
    // the captain's own inbox, in Focus, keeps them as they are
    const own = o.agents.plugins.routes().find((r) => !r.route.bot && r.route.path === '/inbox')?.route.handle({ body: {}, query: {}, params: {} }) as { open: { shown?: { html: string }[] }[] };
    expect(own.open[0]?.shown?.[0]?.html.startsWith('/api/artifacts/')).toBe(true);
  });

  it('takes the bot’s acknowledgement, waking nobody', async () => {
    const o = await forTheBot();
    const view = o.botRoute('get', '/inbox')() as { open: { id: string }[] };
    expect(await o.botRoute('post', '/inbox/:id/decide')({ ack: true }, { id: view.open[0]?.id ?? '' })).toEqual({ ok: true });
    expect(o.botRoute('get', '/inbox')()).toMatchObject({ open: [] });
    expect(o.decisions()).toMatchObject([{ answer: 'Acknowledged', via: 'api' }]);
    expect(o.claude.turns).toHaveLength(1);
  });

  it('records the bot’s answers via the API, whatever it says it is', async () => {
    const o = await forTheBot();
    const view = o.botRoute('get', '/inbox')() as { open: { id: string }[] };
    await o.botRoute('post', '/inbox/:id/decide')({ text: 'Build it', via: 'office' }, { id: view.open[0]?.id ?? '' });
    await until(() => o.claude.turns.length === 2);
    expect(o.decisions()).toMatchObject([{ answer: 'Build it', via: 'api' }]);
  });
});

// README.md#landed-in-show: a slice that merged itself in Show is the captain's to hear of, on a card of its own
describe('a slice that landed in Show', () => {
  it('waits in the inbox, off the queue, until the captain says Got it, and nothing goes to the lead', async () => {
    const { inbox, merged, decisions, claude, store, id } = await waitingLead();
    merged(7);
    merged(8, 'ship');
    expect(inbox.view().landed).toMatchObject([{ repo: 'demo/webshop-frontend', number: 7, goal: 'Saved items', who: store.agent(id).name, leadId: id }]);
    expect(inbox.view().open.every((i) => !i.id.startsWith('landed:'))).toBe(true);
    inbox.decideLanded(inbox.view().landed[0].id, { ack: true }, 'office');
    expect(inbox.view().landed).toEqual([]);
    expect(decisions()).toMatchObject([{ item: { kind: 'landed', what: 'webshop-frontend#7 landed in Show' }, answer: 'Got it', via: 'office' }]);
    expect(claude.turns).toHaveLength(1);
  });

  it('sends the lead the captain’s words for a Redirect or a Revert, as the captain', async () => {
    const { inbox, merged, decisions, claude } = await waitingLead();
    merged(7);
    merged(9);
    const [nine, seven] = inbox.view().landed;
    inbox.decideLanded(seven.id, { redirect: 'Use the API instead.' }, 'office');
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('About demo/webshop-frontend#7, which merged in Show: Use the API instead.');
    inbox.decideLanded(nine.id, { revert: 'It broke search' }, 'api');
    expect(decisions().map((d) => d.kind === 'captain-decision' && d.answer)).toEqual(['Redirect: Use the API instead.', 'Revert: It broke search']);
  });

  it('refuses words for a lead whose goal has closed, and leaves the card', async () => {
    const { inbox, merged } = await waitingLead();
    merged(7, 'show', 'lead_gone');
    const [item] = inbox.view().landed;
    expect(() => inbox.decideLanded(item.id, { revert: '' }, 'office')).toThrow('“Saved items” is closed');
    expect(inbox.view().landed).toHaveLength(1);
  });
});

describe('moving work the chief of staff found to another goal, as the captain approves', () => {
  const move = (to: string) => ({ what: 'the retry build', to, brief: 'Retries for failed pushes are built on lindqvist/retries; tests pass.', pick: 'move' as const });
  const card = (to: string): Verdict => ({
    route: 2, why: 'Two calls.', message: 'Two things to decide.',
    asks: [{ ask: 'Next slice: shared link or emails?', replies: [{ label: 'Shared link', text: 'Shared link first.' }] }, { ask: 'Move the retry build to their goal?', replies: [{ label: 'Keep it here', text: 'Keep it here.' }], move: move(to) }],
  });

  /** A lead waiting on `card`, its move to another open goal's lead, whose own turn has ended (or not, `busy`). */
  async function withReceiver(to?: string, busy = false) {
    const o = await waitingLead({ verdict: card('RECEIVER') });
    const { agent: receiver } = o.agents.startGoal(o.project.id, 'Pushes retry');
    await until(() => o.claude.turns.length === 2);
    if (!busy) o.claude.turns[1].end({ ok: true, summary: 'Retries are next.' });
    if (!busy) await until(() => o.store.agent(receiver.id).status === 'done');
    const read = o.read();
    if (!read?.judged) throw new Error('no read');
    o.host.goals.mark(o.id, { ...read, judged: card(to ?? receiver.id) }, read.at);
    const handovers = () => o.store.ledger.filter((e) => e.kind === 'cos-handover');
    return { ...o, receiver: o.store.agent(receiver.id), handovers };
  }

  it('tells the receiving lead as its own words, records it, and tells the sender it’s gone with their other answers', async () => {
    const o = await withReceiver();
    const [item] = o.inbox.view().open.filter((i) => i.agentId === o.id);
    expect(await o.inbox.decide(item.id, { move: 1 }, 'office')).toEqual({ ok: true, held: 1, of: 2 });
    // the receiving lead hears it from the chief of staff, in their log (so their goal's thread) and their conversation
    await until(() => o.claude.turns.length === 3);
    expect(o.claude.turns[2].req.prompt).toContain(`[Chief of Staff] The captain has moved work to your goal from ${o.store.agent(o.id).name}'s goal “Saved items”: the retry build.`);
    expect(o.claude.turns[2].req.prompt).toContain('Retries for failed pushes are built on lindqvist/retries');
    expect((await o.host.allLines(o.receiver.id)).some((l) => l.text.startsWith('▶ Chief of Staff: The captain has moved work'))).toBe(true);
    expect(o.handovers()).toMatchObject([{ from: o.id, to: o.receiver.id, toAgent: o.receiver.name, toGoal: 'Pushes retry', goal: 'Saved items', what: 'the retry build' }]);
    // the sender hears it's gone as that ask's answer, together with the rest once they're answered
    await o.inbox.decide(item.id, { answer: { ask: 0, text: 'Shared link first.' } }, 'office');
    await until(() => o.claude.turns.length === 4);
    expect(o.claude.turns[3].req.prompt).toContain(`**Move the retry build to their goal?**\nMoved to ${o.receiver.name}'s goal “Pushes retry”: the retry build. It's theirs now, so leave it to them.`);
  });

  it('moves the work once, however often it’s approved', async () => {
    const o = await withReceiver();
    const [item] = o.inbox.view().open.filter((i) => i.agentId === o.id);
    await o.inbox.decide(item.id, { move: 1 }, 'office');
    await expect(o.inbox.decide(item.id, { move: 1 }, 'api')).rejects.toThrow(/has moved already/);
    expect(o.handovers()).toHaveLength(1);
  });

  it('starts a goal for work that belongs in a new one, saying where it came from', async () => {
    const o = await withReceiver('new');
    const [item] = o.inbox.view().open.filter((i) => i.agentId === o.id);
    await o.inbox.decide(item.id, { move: 1 }, 'office');
    const started = o.host.agents().find((a) => a.lead?.brief?.startsWith('Retries for failed pushes'));
    expect(started?.lead?.brief).toContain(`(Moved here from ${o.store.agent(o.id).name}'s goal “Saved items” by the chief of staff, as the captain approved.)`);
    expect(o.handovers()).toMatchObject([{ to: started?.id, started: true }]);
    expect(o.read()?.answers).toMatchObject([{ ask: 1, text: expect.stringMatching(/^A new goal was started for the retry build, led by /) }]);
  });

  it('refuses an ask that moves nothing, and a move to a goal that’s closed since', async () => {
    const o = await withReceiver('lead_closed');
    const [item] = o.inbox.view().open.filter((i) => i.agentId === o.id);
    await expect(o.inbox.decide(item.id, { move: 0 }, 'api')).rejects.toThrow(/moves no work/);
    await expect(o.inbox.decide(item.id, { move: 1 }, 'api')).rejects.toThrow(/is closed/);
    expect(o.handovers()).toEqual([]);
  });

  it('holds the sending goal back from proposing to close until the receiving lead has picked the work up', async () => {
    const o = await withReceiver(undefined, true);
    const [item] = o.inbox.view().open.filter((i) => i.agentId === o.id);
    await o.inbox.decide(item.id, { move: 1 }, 'office');
    await o.inbox.decide(item.id, { answer: { ask: 0, text: 'Shared link first.' } }, 'office');
    await until(() => o.claude.turns.length === 3);
    const sender = o.claude.turns[2];
    // the receiving lead was at work, so it reached them mid-turn: not picked up until that turn ends
    expect(o.claude.turns[1].sent.join('\n')).toContain('The captain has moved work to your goal');
    await expect(sender.req.tools?.proposeClose({ reason: 'Done' })).rejects.toThrow(/Not yet: work this goal handed on hasn't been picked up: the retry build \(/);
    expect(o.store.agent(o.id).lead?.closing).toBeUndefined();
    o.claude.turns[1].end({ ok: true, summary: 'Taking the retries.' });
    await until(() => o.store.agent(o.receiver.id).status === 'done');
    await sender.req.tools?.proposeClose({ reason: 'Done' });
    expect(o.store.agent(o.id).lead?.closing).toMatchObject({ reason: 'Done' });
  });
});

