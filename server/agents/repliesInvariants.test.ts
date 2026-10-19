import { describe, expect, it } from 'vitest';
import type { SessionFacts } from '../../shared/ledger';
import type { Store } from '../store';
import { office, restarted } from './fakeOffice';
import { checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';

// The captain's replies to leads kept in the ledger (docs/ledger.md), under the office's two rules (docs/invariants.md):
// the leads' spans digested before replies were kept get theirs from the transcripts on disk as the office starts, each
// span once, whether the office goes down part way through or two backfills run at once.

const facts: SessionFacts = { minutes: 1, turns: 1, toolCalls: 0, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 1, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0 };
const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const said = (uuid: string, text: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });
const captain = (uuid: string, text: string) => ({ type: 'user', uuid, message: { content: text } });

/** Two lead sessions (one digested in two spans) and a developer's, digested before replies were kept. */
const transcripts = {
  'lead-a': jsonl([said('a1', 'Grid or list?'), captain('a2', 'List'), said('a3', 'Ship it?'), captain('a4', 'ship it')]),
  'lead-b': jsonl([said('b1', 'Done.')]),
  dev: jsonl([said('d1', 'Fixed.'), captain('d2', 'thanks')]),
};

function seed(store: Store) {
  const digest = (sessionId: string, task: 'lead' | 'issue', toUuid: string, afterUuid?: string) =>
    store.record({ kind: 'session-digest', key: `${sessionId}:${toUuid}`, sessionId, agentId: sessionId, agent: sessionId, task, prs: [], goal: 'G', afterUuid, toUuid, facts, at: 1, projectId: 'p' });
  digest('lead-a', 'lead', 'a2');
  digest('lead-a', 'lead', 'a4', 'a2');
  digest('lead-b', 'lead', 'b1');
  digest('dev', 'issue', 'd2');
}

/** Each span's kept replies, as many times as the ledger has them: once each, or a span read twice. */
type Kept = string[];

const replies: Subject<Kept> = {
  name: 'captain replies',
  start: (later) => {
    const first = office();
    seed(first.store);
    const store = first.store;
    const kept = (): Kept => store.ledger.flatMap((e) => (e.kind === 'captain-replies' ? [`${e.key} ${e.replies.map((r) => `${r.lead} → ${r.captain}`).join(' | ')}`] : [])).sort();
    const life = (agents: typeof first.agents, later: Later, starting = false): Running<Kept> => {
      // each transcript read from disk is a step out there: a restart can fall between them
      agents.transcripts = () => Promise.resolve(Object.entries(transcripts).map(([sessionId, text]) => ({
        name: sessionId, kind: sessionId === 'dev' ? 'agent' as const : 'lead' as const, sessionId, read: () => later('read', () => Promise.resolve(text)),
      })));
      // as the office starts again, it keeps what a backfill cut off left (server/index.ts)
      let going: Promise<unknown> = starting ? agents.backfillReplies() : Promise.resolve();
      return {
        actions: () => [{ name: 'the office keeps older replies', run: () => (going = Promise.all([going, agents.backfillReplies()])) }],
        durable: kept,
        settle: async () => void (await going),
        close: () => agents.shutDown(),
        restart: (later) => {
          agents.shutDown();
          return life(restarted(store).agents, later, true);
        },
      };
    };
    return life(first.agents, later);
  },
};

describe('the captain’s replies to leads, under the office’s two rules', () => {
  it('reaches every lead span’s replies kept once, the developer’s left out', async () => {
    const r = await replies.start(now);
    await Promise.resolve(r.actions()[0].run());
    await r.settle();
    expect(r.durable()).toEqual([
      'lead-a:a2 Grid or list? → List',
      'lead-a:a4 Ship it? → ship it',
      'lead-b:b1 ',
    ]);
    // again: nothing more
    await Promise.resolve(r.actions()[0].run());
    await r.settle();
    expect(r.durable()).toHaveLength(3);
    r.close?.();
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(replies, { runs: 15, prefix: 2 });
  });

  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(replies, { runs: 15, prefix: 2 });
  });
});
