import { describe, expect, it } from 'vitest';
import type { Agent, FocusPlugin } from '../../plugin-api/server';
import { demoWorkspace, focus, until } from '../../plugin-api/testing';
import { ChiefOfStaff, type Judge } from './chief';
import type { Router } from './jevRouter';
import { judgeVersion } from './judge';
import { laneJudgeVersion } from './laneJudge';
import { UNATTENDED_ROUNDS } from './rounds';
import { CHIEF_OF_STAFF, readOf } from './shared';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const said = (uuid: string, text: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });
const captain = (uuid: string, text: string) => ({ type: 'user', uuid, message: { content: text } });

/** A Focus with the chief of staff on for its project, a judge that sends every turn back to the lead, and a lead at work. */
async function aboard(answer: unknown = { route: 4, ask: 'Run the tests first', why: 'It can check itself.', message: 'Run the tests first.' }, held: Promise<void> = Promise.resolve(), jev?: ConstructorParameters<typeof ChiefOfStaff>[4]) {
  const o = focus();
  o.project.plugins = [CHIEF_OF_STAFF];
  const asked: { system: string; prompt: string; schema?: Record<string, unknown> }[] = [];
  const judge: Judge = {
    model: 'haiku',
    judge: (req) => (asked.push(req), held.then(() => ({ structured: answer, costUsd: 0.001, model: 'claude-haiku-4-5' }))),
  };
  const transcript = { jsonl: jsonl([captain('a', 'Build saved items'), said('b', 'Slice 1 is up. Shall I start slice 2?')]) };
  let chief: ChiefOfStaff | undefined;
  const plugin: FocusPlugin = {
    id: CHIEF_OF_STAFF,
    start: (host) => {
      const c = new ChiefOfStaff(host, judge, () => 'STANDING ORDERS\nSay yes.', undefined, jev);
      chief = c;
      return { turn: (agent, phase) => void c.turn(agent, phase), leadNoted: (lead, note) => c.noted(lead, note) };
    },
  };
  o.agents.startPlugins([plugin], { demo: false, ownRepo: () => undefined, transcript: () => Promise.resolve(transcript.jsonl) });
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1 && !!o.store.agents.get(agent.id)?.sessionId);
  const lead = (): Agent => o.store.agents.get(agent.id)!;
  const verdicts = () => o.store.ledger.filter((e) => e.kind === 'cos-verdict');
  const read = () => readOf(lead());
  return { ...o, asked, transcript, chief: chief!, lead, verdicts, read };
}

/** Jev, as a test has it: the route it gives, or why it can't; and what it was asked. */
function fakeJev(answer: 1 | 2 | 3 | 4 | Error) {
  const asked: { state: string; orders: string | undefined }[] = [];
  const router: Router = {
    route: (state, orders) => {
      asked.push({ state, orders });
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ route: answer, how: { model: 'jev-1.14.0', version: 'jev-v1', interrupt: 0.6, choice: 'interrupt', confidence: 0.5, costUsd: 0.0001 } });
    },
  };
  return { router, asked };
}

describe('routing with Jev', () => {
  it('lets Jev pick the route where it’s switched on, Haiku writing the words for that route', async () => {
    const jev = fakeJev(3);
    const o = await aboard(undefined, undefined, { router: jev.router, on: () => true });
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => o.verdicts().length === 1);
    expect(jev.asked[0]).toEqual({ state: o.asked[0].prompt, orders: 'STANDING ORDERS\nSay yes.' });
    expect(o.asked[0].system).toContain('The route is decided already: 3 (interrupt)');
    expect(o.asked[0].schema).toMatchObject({ properties: { route: { enum: [3] } } });
    expect(o.verdicts()[0]).toMatchObject({
      route: 3, model: 'claude-haiku-4-5', version: `${judgeVersion()}+jev-v1`,
      router: { by: 'jev', model: 'jev-1.14.0', version: 'jev-v1', interrupt: 0.6, costUsd: 0.0001 },
    });
    expect(o.read()?.judged).toMatchObject({ route: 3 });
  });

  it('routes as Haiku says when Jev can’t answer, keeping why', async () => {
    const jev = fakeJev(new Error('Jev answered HTTP 529'));
    const o = await aboard(undefined, undefined, { router: jev.router, on: () => true });
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up.' });
    await until(() => o.verdicts().length === 1);
    expect(o.asked[0].system).not.toContain('decided already');
    expect(o.verdicts()[0]).toMatchObject({ route: 4, version: judgeVersion(), routerFailed: 'Jev answered HTTP 529' });
    expect(o.verdicts()[0]).not.toHaveProperty('router');
  });

  it('doesn’t ask Jev in a project it isn’t switched on for', async () => {
    const jev = fakeJev(3);
    const o = await aboard(undefined, undefined, { router: jev.router, on: () => false });
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up.' });
    await until(() => o.verdicts().length === 1);
    expect(jev.asked).toEqual([]);
    expect(o.verdicts()[0]).toMatchObject({ route: 4, version: judgeVersion() });
    expect(o.verdicts()[0]).not.toHaveProperty('routerFailed');
  });
});

describe('the chief of staff', () => {
  it('judges a lead’s turn as it ends and writes the verdict in the ledger, saying nothing to anyone', async () => {
    const o = await aboard();
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => o.verdicts().length === 1);
    expect(o.verdicts()[0]).toMatchObject({
      kind: 'cos-verdict', projectId: o.project.id, sessionId: 'session-1', agent: o.lead().name, goal: o.lead().lead?.title, turnUuid: 'b',
      route: 4, why: 'It can check itself.', message: 'Run the tests first.', model: 'claude-haiku-4-5', version: judgeVersion(), costUsd: 0.001,
    });
    expect(o.asked[0].prompt).toBe(`Goal: ${o.lead().lead?.title}\n\nThe end of what the lead said:\n<<<\nSlice 1 is up. Shall I start slice 2?\n>>>`);
    expect(o.asked[0].system).toContain('past replies:\nSTANDING ORDERS\nSay yes.');
    // nothing was sent to the lead
    expect(o.claude.turns[0].sent).toEqual([]);
  });

  it('holds the lead’s ended turn back from the captain while it reads it, then files it by its verdict', async () => {
    const o = await aboard();
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => !!o.read());
    await until(() => !!o.read()?.judged);
    expect(o.read()?.judged).toEqual({ route: 4, ask: 'Run the tests first', why: 'It can check itself.', message: 'Run the tests first.' });
    // the lead's next turn starts: what it read of the last is over
    o.agents.message(o.lead().id, 'Go on');
    await until(() => o.claude.turns.length === 2);
    expect(o.read()).toBeUndefined();
  });

  it('drops a verdict that comes after the lead’s next turn has started', async () => {
    let answer = () => undefined as void;
    const o = await aboard(undefined, new Promise((resolve) => (answer = resolve)));
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up.' });
    await until(() => o.asked.length === 1 && o.lead().status === 'done');
    expect(o.read()).toMatchObject({ at: expect.any(Number) });
    o.agents.message(o.lead().id, 'Go on');
    await until(() => o.claude.turns.length === 2);
    answer();
    await until(() => o.verdicts().length === 1);
    expect(o.read()).toBeUndefined();
  });

  it('files a turn it would carry on as a card once the lead has gone a few rounds without the captain', async () => {
    const o = await aboard();
    for (let turn = 0; turn <= UNATTENDED_ROUNDS; turn++) {
      if (turn) {
        // nobody's decided anything of theirs: the next turn starts unattended
        o.agents.message(o.lead().id, 'Go on');
        await until(() => o.claude.turns.length === turn + 1);
      }
      o.transcript.jsonl = jsonl([captain(`a${turn}`, 'Go on'), said(`b${turn}`, `Turn ${turn} done.`)]);
      o.claude.turns[turn].end({ ok: true, summary: `Turn ${turn} done.` });
      await until(() => !!o.read()?.judged);
      expect(o.read()?.judged?.route).toBe(turn < UNATTENDED_ROUNDS ? 4 : 2);
    }
    // the ledger keeps what it judged
    expect(o.verdicts().map((v) => v.kind === 'cos-verdict' && v.route)).toEqual(Array(UNATTENDED_ROUNDS + 1).fill(4));
  });

  it('marks nothing as read for a project it’s off for', async () => {
    const o = await aboard();
    o.project.plugins = [];
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up.' });
    await until(() => o.lead().status === 'done');
    expect(o.read()).toBeUndefined();
  });

  it('judges a turn once, however often it ends', async () => {
    const o = await aboard();
    await Promise.all([o.chief.turn(o.lead(), 'end'), o.chief.turn(o.lead(), 'end')]);
    await o.chief.turn(o.lead(), 'end');
    expect(o.verdicts()).toHaveLength(1);
    expect(o.asked).toHaveLength(1);
  });

  it('leaves be a turn your plan’s limit stopped, one the lead said nothing in, and a turn starting', async () => {
    const o = await aboard();
    o.transcript.jsonl = jsonl([said('b', 'Working.\n\nYou’ve hit your session limit · resets 2pm (Europe/London)')]);
    await o.chief.turn(o.lead(), 'end');
    o.transcript.jsonl = jsonl([said('b', 'Shall I?'), captain('c', 'yes')]);
    await o.chief.turn(o.lead(), 'end');
    expect(o.chief.turn(o.lead(), 'start')).toBeUndefined();
    expect(o.asked).toEqual([]);
    expect(o.verdicts()).toEqual([]);
  });

  it('leaves be anyone but a goal’s lead, and a project it’s off for', async () => {
    const o = await aboard();
    expect(o.chief.turn({ ...o.lead(), task: 'issue' }, 'end')).toBeUndefined();
    o.project.plugins = [];
    expect(o.chief.turn(o.lead(), 'end')).toBeUndefined();
    expect(o.asked).toEqual([]);
  });

  it('logs a judge that answers nonsense, and writes nothing', async () => {
    const o = await aboard({ route: 9 });
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (text: string) => void warned.push(text);
    try {
      await o.chief.turn(o.lead(), 'end');
    } finally {
      console.warn = warn;
    }
    expect(o.verdicts()).toEqual([]);
    expect(warned).toEqual([`[chief-of-staff] judging ${o.lead().name}’s turn failed: the judge gave no verdict: {"route":9}`]);
  });

  describe('waking a lead for a note Ops left them', () => {
    /** The lead ships its slice and ends its turn, which the judge sends back to them (or `answer`s) once `held` is over. */
    async function shipped(answer?: unknown, held?: Promise<void>) {
      const o = await aboard(answer, held);
      o.project.autoSendBack = true;
      await o.claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
      o.claude.turns[0].end({ ok: true, summary: 'Shipped' });
      await until(() => o.lead().status === 'done' && (!!held || !!o.read()?.judged));
      return o;
    }
    const land = (o: Awaited<ReturnType<typeof shipped>>) => {
      for (const pr of o.lead().lead!.prs) o.agents.prClosed(pr.repo, pr.number, true);
    };
    const card = { route: 2, ask: 'Slice 2: filters or drag-reorder first?', why: 'A pick.', message: 'Filters, the lead says.' };

    it('carries a lead on once their slice has landed, the note ahead of its words', async () => {
      const o = await shipped();
      for (const pr of o.lead().lead!.prs) o.agents.prClosed(pr.repo, pr.number, true);
      await until(() => o.claude.turns.length === 2);
      expect(o.claude.turns[1].req.prompt).toMatch(/\[Ops\] Slice 1 has landed: .*\n\n\[Ops\] Slice 1 has landed: carry on with what's next, unless it's the captain's call\.$/s);
    });

    it('leaves a landing for the captain in a project it’s off for', async () => {
      const o = await shipped();
      o.project.plugins = [];
      for (const pr of o.lead().lead!.prs) o.agents.prClosed(pr.repo, pr.number, true);
      await new Promise((r) => setTimeout(r, 30));
      expect(o.claude.turns).toHaveLength(1);
    });

    it('sends a QA fail back to the lead as the QA officer, a couple of rounds, then leaves it to the captain', async () => {
      const o = await shipped();
      const verdict = (failedRounds: number, lead = o.lead()) => o.chief.noted(lead, { from: 'QA officer Ada', text: 'QA failed acme/api#7', inTurn: false, about: { kind: 'qa-verdict', repo: 'acme/api', number: 7, verdict: 'fail', advisory: false, failedRounds, behind: false } });
      verdict(3);
      // nor for anyone but a goal's lead
      verdict(1, { ...o.lead(), task: 'issue' });
      await new Promise((r) => setTimeout(r, 30));
      expect(o.claude.turns).toHaveLength(1);
      verdict(1);
      await until(() => o.claude.turns.length === 2);
      expect(o.claude.turns[1].req.prompt).toBe("[QA officer Ada] Fix acme/api#7 and ship again (QA's verdict is just above), or tell the captain why not.");
    });

    it('leaves a lead the captain owes a card: the landing goes with the captain’s next message', async () => {
      const o = await shipped(card);
      land(o);
      await new Promise((r) => setTimeout(r, 30));
      expect(o.claude.turns).toHaveLength(1);
      expect(o.read()?.judged).toMatchObject({ route: 2 });
      o.agents.message(o.lead().id, 'Filters first');
      await until(() => o.claude.turns.length === 2);
      expect(o.claude.turns[1].req.prompt).toMatch(/\[Ops\] Slice 1 has landed: .*Filters first$/s);
    });

    it('carries on a lead whose card the captain acknowledged: Got it owes them nothing, so the landing wakes it', async () => {
      const o = await shipped(card);
      const lead = o.lead();
      o.store.putAgent({ ...lead, lead: { ...lead.lead!, marks: { [CHIEF_OF_STAFF]: { ...o.read(), acked: Date.now() } } } });
      land(o);
      await until(() => o.claude.turns.length === 2);
      expect(o.claude.turns[1].req.prompt).toMatch(/\[Ops\] Slice 1 has landed/);
    });

    it('sends no QA fail back to a lead the captain owes a card, nor one whose turn has ended unjudged', async () => {
      const o = await shipped(card);
      const fail = { from: 'QA officer Ada', text: 'QA failed acme/api#7', inTurn: false, about: { kind: 'qa-verdict' as const, repo: 'acme/api', number: 7, verdict: 'fail' as const, advisory: false, failedRounds: 1, behind: false } };
      o.chief.noted(o.lead(), fail);
      // a turn it never judged, a minute on, needs the captain too
      o.chief.noted({ ...o.lead(), lead: { ...o.lead().lead!, marks: { [CHIEF_OF_STAFF]: { at: 0 } } } }, fail);
      await new Promise((r) => setTimeout(r, 30));
      expect(o.claude.turns).toHaveLength(1);
    });

    it('waits for its verdict on the turn it’s still reading, and wakes the lead then if the captain owes them nothing', async () => {
      let answer = () => undefined as void;
      const o = await shipped(undefined, new Promise((resolve) => (answer = resolve)));
      await until(() => o.asked.length === 1);
      land(o);
      await new Promise((r) => setTimeout(r, 30));
      expect(o.claude.turns).toHaveLength(1);
      answer();
      await until(() => o.claude.turns.length === 2);
      expect(o.claude.turns[1].req.prompt).toMatch(/Slice 1 has landed: carry on with what's next, unless it's the captain's call\.$/);
    });

    it('drops the news it waited with once a verdict makes the turn the captain’s', async () => {
      let answer = () => undefined as void;
      const o = await shipped(card, new Promise((resolve) => (answer = resolve)));
      await until(() => o.asked.length === 1);
      land(o);
      answer();
      await until(() => !!o.read()?.judged);
      await new Promise((r) => setTimeout(r, 30));
      expect(o.claude.turns).toHaveLength(1);
    });
  });
});

// README.md#raising-a-ships-lane: it reads each ship's recap and raises its lane where the captain would want to see it first
describe('the chief of staff reading a ship’s lane', () => {
  /** A lead who shipped a slice in Ship, and a chief of staff whose judge answers its read with `answer` (or fails). */
  async function shipped(answer: unknown) {
    let head = 'first';
    const o = focus({ ...demoWorkspace, head: async () => head, changedFiles: async () => ['src/saved.ts'] });
    o.project.plugins = [CHIEF_OF_STAFF];
    const asked: { system: string; prompt: string; schema?: object }[] = [];
    const judge: Judge = {
      model: 'haiku',
      judge: (req) => (asked.push(req), answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ structured: answer, model: 'claude-haiku-4-5' })),
    };
    let chief: ChiefOfStaff | undefined;
    const plugin: FocusPlugin = {
      id: CHIEF_OF_STAFF,
      start: (host) => {
        const c = new ChiefOfStaff(host, judge, () => undefined);
        chief = c;
        return { mergeHeld: (pr) => c.mergeHeld(pr) };
      },
    };
    o.agents.startPlugins([plugin], { demo: false, ownRepo: () => undefined, transcript: () => Promise.resolve('') });
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => o.claude.turns.length === 1);
    const ship = (lane: 'ship' | 'show') => o.claude.turns[0].req.tools!.ship({
      title: 'Saved items',
      summary: 'A thin first slice.',
      recap: { primitives: [{ id: 'saved', group: 'shop', impact: 'composes', change: 'Wired in', paths: ['webshop-frontend/', 'webshop-api/'] }], lane },
    });
    await ship('ship');
    const lanes = () => o.store.agents.get(agent.id)!.lead!.prs.map((p) => p.lane);
    const pr = () => o.store.agents.get(agent.id)!.lead!.prs[0];
    const read = () => Promise.all(chief!.readShips(o.project.id));
    const lines = (kind: string) => o.store.ledger.filter((e) => e.kind === kind);
    return { ...o, asked, chief: chief!, lanes, pr, read, lines, ship, next: () => (head = 'second') };
  }

  it('holds the lead’s pull requests back from merging by themselves until it has read the ship', async () => {
    const o = await shipped({ lane: 'ship', why: 'It only wires in parts as they are.' });
    expect(o.chief.mergeHeld(o.pr())).toBe('the chief of staff hasn’t read its lane yet');
    await o.read();
    expect(o.chief.mergeHeld(o.pr())).toBeUndefined();
    expect(o.asked[0].prompt).toContain('- saved (shop), composes: Wired in');
  });

  it('keeps the lead’s pick, saying why in the ledger, and reads a ship once', async () => {
    const o = await shipped({ lane: 'ship', why: 'It only wires in parts as they are.' });
    await o.read();
    await o.read();
    expect(o.asked).toHaveLength(1);
    expect(o.lanes()).toEqual(['ship', 'ship']);
    expect(o.lines('cos-lane')).toMatchObject([{ from: 'ship', to: 'ship', why: 'It only wires in parts as they are.', version: laneJudgeVersion(), model: 'claude-haiku-4-5' }]);
    expect(o.lines('lane-raised')).toEqual([]);
  });

  it('raises it where the captain would want to see it first, and a ship after can’t bring it back down', async () => {
    const o = await shipped({ lane: 'ask', why: 'It changes what the captain sees on a card.' });
    await o.read();
    expect(o.lanes()).toEqual(['ask', 'ask']);
    expect(o.pr().raised).toEqual({ lane: 'ask', by: CHIEF_OF_STAFF, why: 'It changes what the captain sees on a card.' });
    expect(o.lines('lane-raised')).toMatchObject([{ from: 'ship', to: 'ask', by: CHIEF_OF_STAFF }, { from: 'ship', to: 'ask', by: CHIEF_OF_STAFF }]);
    o.next();
    await o.ship('ship');
    expect(o.lanes()).toEqual(['ask', 'ask']);
  });

  it('takes a raise again that a restart lost, without reading the ship again', async () => {
    const o = await shipped({ lane: 'ask', why: 'It changes what the captain sees on a card.' });
    await o.read();
    // Focus went down after the ledger had the read, before the raise was saved
    const lead = [...o.store.agents.values()].find((a) => a.lead)!;
    o.store.agents.set(lead.id, { ...lead, lead: { ...lead.lead!, prs: lead.lead!.prs.map(({ raised: _, ...p }) => ({ ...p, lane: 'ship' as const })) } });
    expect(o.chief.mergeHeld(o.pr())).toBe('the chief of staff raised it to Ask');
    await o.read();
    expect(o.asked).toHaveLength(1);
    expect(o.lanes()).toEqual(['ask', 'ask']);
    expect(o.chief.mergeHeld(o.pr())).toBeUndefined();
  });

  it('reads a ship only once Ops has pushed all of it', async () => {
    const o = await shipped({ lane: 'ship', why: 'Safe.' });
    const lead = [...o.store.agents.values()].find((a) => a.lead)!;
    o.store.agents.set(lead.id, { ...lead, status: 'pushing' });
    expect(o.chief.readShips(o.project.id)).toEqual([]);
  });

  it('puts a ship it couldn’t read in Ask: an unread one is the captain’s', async () => {
    const o = await shipped(new Error('Haiku is down'));
    await o.read();
    expect(o.lanes()).toEqual(['ask', 'ask']);
    expect(o.lines('cos-lane')).toMatchObject([{ from: 'ship', to: 'ask', failed: 'Haiku is down' }]);
    expect(o.chief.mergeHeld(o.pr())).toBeUndefined();
  });
});
