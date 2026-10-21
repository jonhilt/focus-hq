import { describe, expect, it } from 'vitest';
import type { Agent, FocusPlugin } from '../../plugin-api/server';
import { focus, until } from '../../plugin-api/testing';
import { ChiefOfStaff, type Judge } from './chief';
import { CHIEF_OF_STAFF } from './shared';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const said = (uuid: string, text: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });
const captain = (uuid: string, text: string) => ({ type: 'user', uuid, message: { content: text } });

/** A Focus with the chief of staff on for its project, a judge that sends every turn back to the lead, and a lead at work. */
async function aboard(answer: unknown = { route: 4, ask: 'Run the tests first', why: 'It can check itself.', message: 'Run the tests first.' }, held: Promise<void> = Promise.resolve()) {
  const o = focus();
  o.project.plugins = [CHIEF_OF_STAFF];
  const asked: { system: string; prompt: string }[] = [];
  const judge: Judge = {
    model: 'haiku',
    judge: (req) => (asked.push(req), held.then(() => ({ structured: answer, costUsd: 0.001, model: 'claude-haiku-4-5' }))),
  };
  const transcript = { jsonl: jsonl([captain('a', 'Build saved items'), said('b', 'Slice 1 is up. Shall I start slice 2?')]) };
  let chief: ChiefOfStaff | undefined;
  const plugin: FocusPlugin = {
    id: CHIEF_OF_STAFF,
    start: (host) => {
      const c = new ChiefOfStaff(host, judge, () => 'STANDING ORDERS\nSay yes.');
      chief = c;
      return { judgesTurns: (agent) => c.judges(agent), turn: (agent, phase) => void c.turn(agent, phase), leadNoted: (lead, note) => c.noted(lead, note) };
    },
  };
  o.agents.startPlugins([plugin], { demo: false, ownRepo: () => undefined, transcript: () => Promise.resolve(transcript.jsonl) });
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1 && !!o.store.agents.get(agent.id)?.sessionId);
  const lead = (): Agent => o.store.agents.get(agent.id)!;
  const verdicts = () => o.store.ledger.filter((e) => e.kind === 'cos-verdict');
  return { ...o, asked, transcript, chief: chief!, lead, verdicts };
}

describe('the chief of staff', () => {
  it('judges a lead’s turn as it ends and writes the verdict in the ledger, saying nothing to anyone', async () => {
    const o = await aboard();
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => o.verdicts().length === 1);
    expect(o.verdicts()[0]).toMatchObject({
      kind: 'cos-verdict', projectId: o.project.id, sessionId: 'session-1', agent: o.lead().name, goal: o.lead().lead?.title, turnUuid: 'b',
      route: 4, why: 'It can check itself.', message: 'Run the tests first.', model: 'claude-haiku-4-5', version: 'v7', costUsd: 0.001,
    });
    expect(o.asked[0].prompt).toBe(`Goal: ${o.lead().lead?.title}\n\nThe end of what the lead said:\n<<<\nSlice 1 is up. Shall I start slice 2?\n>>>`);
    expect(o.asked[0].system).toContain('past replies:\nSTANDING ORDERS\nSay yes.');
    // nothing was sent to the lead
    expect(o.claude.turns[0].sent).toEqual([]);
  });

  it('holds the lead’s ended turn back from the captain while it reads it, then files it by its verdict', async () => {
    const o = await aboard();
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => !!o.lead().lead?.cos);
    await until(() => !!o.lead().lead?.cos?.judged);
    expect(o.lead().lead?.cos?.judged).toEqual({ route: 4, ask: 'Run the tests first', why: 'It can check itself.', message: 'Run the tests first.' });
    // the lead's next turn starts: what it read of the last is over
    o.agents.message(o.lead().id, 'Go on');
    await until(() => o.claude.turns.length === 2);
    expect(o.lead().lead?.cos).toBeUndefined();
  });

  it('drops a verdict that comes after the lead’s next turn has started', async () => {
    let answer = () => undefined as void;
    const o = await aboard(undefined, new Promise((resolve) => (answer = resolve)));
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up.' });
    await until(() => o.asked.length === 1 && o.lead().status === 'done');
    expect(o.lead().lead?.cos).toMatchObject({ at: expect.any(Number) });
    o.agents.message(o.lead().id, 'Go on');
    await until(() => o.claude.turns.length === 2);
    answer();
    await until(() => o.verdicts().length === 1);
    expect(o.lead().lead?.cos).toBeUndefined();
  });

  it('marks nothing as read for a project it’s off for', async () => {
    const o = await aboard();
    o.project.plugins = [];
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up.' });
    await until(() => o.lead().status === 'done');
    expect(o.lead().lead?.cos).toBeUndefined();
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
    /** The lead ships its slice and ends its turn: the captain's to read. */
    async function shipped() {
      const o = await aboard();
      o.project.autoSendBack = true;
      await o.claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
      o.claude.turns[0].end({ ok: true, summary: 'Shipped' });
      await until(() => o.lead().status === 'done');
      return o;
    }

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
  });
});
