import { describe, expect, it } from 'vitest';
import type { Agent, FocusPlugin } from '../../plugin-api/server';
import { office, until } from '../../plugin-api/testing';
import { ChiefOfStaff, type Judge } from './chief';
import { CHIEF_OF_STAFF, type LatestVerdict, onTurn } from './shared';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const said = (uuid: string, text: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });
const captain = (uuid: string, text: string) => ({ type: 'user', uuid, message: { content: text } });

/** An office with the chief of staff on for its project, a judge that sends every turn back to the lead, and a lead at work. */
async function aboard(answer: unknown = { route: 4, why: 'It can check itself.', message: 'Run the tests first.' }) {
  const o = office();
  o.project.plugins = [CHIEF_OF_STAFF];
  const asked: { system: string; prompt: string }[] = [];
  const judge: Judge = {
    model: 'haiku',
    judge: (req) => (asked.push(req), Promise.resolve({ structured: answer, costUsd: 0.001, model: 'claude-haiku-4-5' })),
  };
  const transcript = { jsonl: jsonl([captain('a', 'Build saved items'), said('b', 'Slice 1 is up. Shall I start slice 2?')]) };
  let chief: ChiefOfStaff | undefined;
  const kept: [string, LatestVerdict][] = [];
  const plugin: FocusPlugin = {
    id: CHIEF_OF_STAFF,
    start: (host) => {
      const c = new ChiefOfStaff(host, judge, () => 'STANDING ORDERS\nSay yes.', (id, v) => kept.push([id, v]));
      chief = c;
      return { turn: (agent, phase) => void c.turn(agent, phase) };
    },
  };
  o.agents.startPlugins([plugin], { demo: false, ownRepo: () => undefined, transcript: () => Promise.resolve(transcript.jsonl) });
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1 && !!o.store.agents.get(agent.id)?.sessionId);
  const lead = (): Agent => o.store.agents.get(agent.id)!;
  const verdicts = () => o.store.ledger.filter((e) => e.kind === 'cos-verdict');
  return { ...o, asked, transcript, chief: chief!, lead, verdicts, kept };
}

describe('the chief of staff, in shadow mode', () => {
  it('judges a lead’s turn as it ends and writes the verdict in the ledger, saying nothing to anyone', async () => {
    const o = await aboard();
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => o.verdicts().length === 1);
    expect(o.verdicts()[0]).toMatchObject({
      kind: 'cos-verdict', projectId: o.project.id, sessionId: 'session-1', agent: o.lead().name, goal: o.lead().lead?.title, turnUuid: 'b',
      route: 4, why: 'It can check itself.', message: 'Run the tests first.', model: 'claude-haiku-4-5', version: 'v5', costUsd: 0.001,
    });
    expect(o.asked[0].prompt).toBe(`Goal: ${o.lead().lead?.title}\n\nThe end of what the lead said:\n<<<\nSlice 1 is up. Shall I start slice 2?\n>>>`);
    expect(o.asked[0].system).toContain('past replies:\nSTANDING ORDERS\nSay yes.');
    // nothing was sent to the lead
    expect(o.claude.turns[0].sent).toEqual([]);
  });

  it('keeps the lead’s latest verdict for the browser, said once the captain answers that turn and no other', async () => {
    const o = await aboard();
    o.claude.turns[0].end({ ok: true, summary: 'Slice 1 is up. Shall I start slice 2?' });
    await until(() => o.kept.length === 1);
    const [id, verdict] = o.kept[0];
    expect(id).toBe(o.lead().id);
    expect(verdict).toMatchObject({ route: 4, why: 'It can check itself.' });
    await until(() => o.lead().status === 'done');
    expect(onTurn(verdict, o.lead())).toBe(true);
    // a later turn, or a hand raised mid-turn, isn't the turn it judged
    expect(onTurn(verdict, { ...o.lead(), finishedAt: verdict.endedAt + 60_000 })).toBe(false);
    expect(onTurn(verdict, { ...o.lead(), status: 'working' })).toBe(false);
    expect(onTurn(undefined, o.lead())).toBe(false);
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
});
