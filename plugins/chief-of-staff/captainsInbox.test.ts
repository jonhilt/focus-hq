import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, FocusPlugin, PluginHost } from '../../plugin-api/server';
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
  /** Ops merging one of the lead's pull requests in `lane`, as the ledger has it. */
  const merged = (pr: number, lane: 'ship' | 'show' | 'ask' = 'show', lead = agent.id) =>
    host?.record(o.project.id, { kind: 'merged', repo: 'demo/webshop-frontend', pr, goal: 'Saved items', by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead, lane });
  return { ...o, inbox: inbox.it, id: agent.id, decisions, merged, read: () => readOf(o.store.agent(agent.id)) };
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
    const { inbox, claude, decisions } = await waitingLead({ verdict: { route: 1, ask: 'Carry on to the settings page', why: 'Progress.', message: 'Go on to the settings page.' } });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ kind: 'turn', lane: 'ready', what: 'Carry on to the settings page', cos: { route: 1 } });
    await inbox.decide(item.id, { send: true }, 'office');
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain('[Chief of Staff] Go on to the settings page.');
    expect(decisions()).toMatchObject([{ item: { id: item.id, what: 'Carry on to the settings page' }, answer: 'Sent the chief of staff’s words' }]);
  });

  it('files a card under needs you, headed by its line, and won’t send words it has none ready for', async () => {
    const { inbox } = await waitingLead({ verdict: { route: 2, ask: 'Slice 2: filters or drag-reorder first?', why: 'A pick.', message: 'Filters, the lead says.' } });
    const [item] = inbox.view().open;
    expect(item).toMatchObject({ lane: 'needs-you', what: 'Slice 2: filters or drag-reorder first?' });
    await expect(inbox.decide(item.id, { send: true }, 'office')).rejects.toThrow(/words ready/);
  });
});

describe('acknowledging a lead’s turn (Got it)', () => {
  const card = { route: 2 as const, ask: 'Keep the goal open, or close it?', why: 'A pick.', message: 'Close it, the lead says.', replies: [{ label: 'Close it', text: 'Close it: it’s done.' }] };

  it('reads it and takes it off the queue, sends nothing, and records it as the captain’s', async () => {
    const { inbox, claude, id, store, decisions } = await waitingLead({ verdict: card });
    const [item] = inbox.view().open;
    expect(item.cos?.replies).toEqual(card.replies);
    await inbox.decide(item.id, { ack: true }, 'office');
    expect(inbox.view().open).toEqual([]);
    expect(store.agent(id).lead?.readTurn).toBe(store.agent(id).finishedAt);
    expect(readOf(store.agent(id))).toMatchObject({ judged: card, acked: expect.any(Number) });
    expect(decisions()).toMatchObject([{ item: { id: item.id, kind: 'turn', what: card.ask }, answer: 'Acknowledged', via: 'office' }]);
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
    const { inbox, claude, read } = await waitingLead({ verdict: { route: 4, ask: 'Test it first', why: 'No evidence.', message: 'Test it first.' }, autoSend: true });
    const sendsAt = read()?.sendsAt ?? 0;
    await inbox.decide(inbox.view().open[0].id, { ack: true }, 'office');
    expect(read()?.sendsAt).toBeUndefined();
    await inbox.autoSend(sendsAt + 1);
    expect(claude.turns).toHaveLength(1);
  });
});

describe('the chief of staff’s words, sent by themselves where the captain lets it', () => {
  const sendBack = { route: 4 as const, ask: 'Show the settings page working', why: 'It says it works with nothing behind it.', message: 'Show the settings page working before it goes to the captain.' };
  const carryOn = { route: 1 as const, ask: 'Carry on to the settings page', why: 'Progress.', message: 'Go on to the settings page.' };

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
    const card = await waitingLead({ verdict: { route: 2, ask: 'Filters or drag-reorder?', why: 'A pick.', message: 'Filters.' }, autoSend: true });
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
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: Agent };
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
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: Agent };
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
