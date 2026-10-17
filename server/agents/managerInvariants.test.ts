import { describe, expect, it, vi } from 'vitest';
import { keyFallback } from './apiKey';
import { office, restarted } from './fakeOffice';
import type { Agent } from '../../shared/types';
import { type Action, checkRestart, now, type Running, type Subject } from './invariants';

// A goal's lead, under the office's rule that a restart is atomic (docs/invariants.md): what's said of a lead (held for
// the plan's limit, where its run is, what's waiting in its inbox, and that nothing it was told is lost) is the same
// after the office goes down and starts again as before. Its run journal (runJournal.ts) is what it keeps of its turns
// and inbox. Described here (what can happen to a lead, what must survive), not told what to expect.

// the office falls back on an API key while the plan's usage limit is reached, as in runRecovery.limit.test.ts
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.FOCUS_USE_API_KEY = 'fallback';
});
vi.setConfig({ testTimeout: 60_000 });

/** Until what `read` says stops changing (three looks 5 ms apart, a second at most): the manager's own async work done. */
const steady = async (read: () => unknown) => {
  let last = JSON.stringify(read());
  for (let same = 0, i = 0; same < 3 && i < 200; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const now = JSON.stringify(read());
    same = now === last ? same + 1 : 0;
    last = now;
  }
};

interface Said {
  phase: string;
  held: boolean;
  /** What's waiting for the lead's next turn, and for the end of the one in hand. */
  inbox: string[];
  later: string[];
  /** Every message the lead has been sent, heard (in a turn's prompt, or into a session that ran on) or still waiting: none lost. */
  told: string[];
}

/** The office's note for a lead that needn't cost a turn (a QA verdict that passes, the star chart): it waits for the
 *  end of the turn in hand, or for whatever they hear next. Only the manager's own parts send one. */
const noteForLead = (agents: ReturnType<typeof office>['agents'], lead: Agent, text: string) =>
  (Reflect.get(agents, 'core') as { leads: { noteForLead(lead: Agent, from: string, text: string): void } }).leads.noteForLead(lead, 'Office', text);

/** A goal's lead; `only`, the actions offered, by name, when a check is after one thing. */
const leadOf = (only?: RegExp): Subject<Said> => ({
  name: 'lead',
  start: async () => {
    // the limit is the office's own, kept between tests: each run starts with it not reached
    Reflect.set(keyFallback, 'spell', undefined);
    const first = office();
    const started = first.agents.startGoal(first.project.id, 'Saved items');
    if (!('agent' in started)) throw new Error('the goal was queued');
    const id = started.agent.id;
    // every life's Claude Code, for what the lead heard in each
    const claudes = [first.claude];
    // messages are numbered as they're sent, so each is told apart from the others
    let sent = 0;
    const said = (): Said => {
      const run = first.store.run(id);
      // a turn's prompt is in its conversation once it starts; what went into its session while it ran, only if it ran
      // on (a turn stopped as the office went down may never have read it: the resumed turn hears it again)
      const heard = claudes.flatMap((c) => c.turns.flatMap((t) => [t.req.prompt, ...(t.stopped ? [] : t.sent)]));
      // not what was just taken for a turn that was never asked for: once settled, nothing will hear that
      const waiting = [...run.inbox, ...run.later];
      return {
        phase: JSON.stringify(run.phase),
        held: !!first.store.agent(id).held,
        inbox: [...run.inbox],
        later: [...run.later],
        told: Array.from({ length: sent }, (_, i) => `Message ${i + 1}`).filter((m) => [...heard, ...waiting].some((h) => h.includes(m))),
      };
    };
    await steady(said);
    const life = (o: Pick<ReturnType<typeof office>, 'agents' | 'claude'>): Running<Said> => {
      // the turns this life's Claude Code has had ended: a turn ends once
      const ended = new Set<number>();
      // the lead's turn under way, ended once: with none under way, there's nothing to end
      const turn = () => {
        const at = o.claude.turns.findIndex((t, i) => !t.stopped && !ended.has(i));
        const t = o.claude.turns[at];
        if (!t) throw new Error('no turn under way');
        ended.add(at);
        return t;
      };
      return {
        actions: () => ([
          { name: 'the turn ends', run: () => turn().end({ ok: true, summary: 'done', started: true }) },
          {
            name: 'the turn ends on the plan’s limit',
            run: () => {
              const t = turn();
              // a long conversation: picking it up on the key would cost too much
              t.hooks.context?.({ percent: 60, tokens: 600_000, max: 1_000_000 });
              keyFallback.limitHit(Date.now() + 60 * 60_000);
              t.end({ ok: false, summary: '', limited: true, started: true });
            },
          },
          { name: 'the captain writes', run: () => o.agents.message(id, `And the header: Message ${++sent}`) },
          // news that waits for the turn in hand to end, or goes with what they hear next
          { name: 'the office leaves a note', run: () => noteForLead(o.agents, first.store.agent(id), `QA passed it: Message ${++sent}`) },
          { name: 'the captain stops them', run: () => o.agents.stop(id) },
        ] satisfies Action[]).filter((a) => !only || only.test(a.name)),
        durable: said,
        settle: () => steady(said),
        close: () => o.agents.shutDown(),
        restart: () => {
          o.agents.shutDown();
          const after = restarted(first.store);
          claudes.push(after.claude);
          after.agents.recover();
          return life(after);
        },
      };
    };
    return life(first);
  },
});
const lead = leadOf();

describe('a goal’s lead, under the office’s rule for a restart', () => {
  // a description that never got a message into a turn, or one waiting for it to end, would prove nothing of the inbox
  it('reaches messages sent into a turn, waiting for it to end, and waiting for the next, taken one at a time', async () => {
    const l = await lead.start(now);
    const seen: Said[] = [];
    for (const name of ['the captain writes', 'the office leaves a note', 'the turn ends', 'the turn ends', 'the office leaves a note', 'the captain writes']) {
      await Promise.resolve().then(() => l.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await l.settle();
      seen.push(l.durable());
    }
    l.close?.();
    // into the turn in hand; waiting for it to end; then, with no turn, waiting for what they hear next, which takes them
    expect(seen.map((s) => s.told.length)).toEqual([1, 2, 2, 2, 3, 4]);
    expect(seen[1].later).toEqual([expect.stringContaining('Message 2')]);
    expect(seen[4]).toMatchObject({ later: [], inbox: [expect.stringContaining('Message 2'), expect.stringContaining('Message 3')] });
    expect(seen[5].inbox).toEqual([]);
  });

  it('is said to be where it was, and held if it was, after the office goes down and starts again', async () => {
    await checkRestart(lead, { runs: 15 });
  });

  // what the lead's told, kept through a restart: messages into a turn, notes waiting for it to end, and the next turn
  it('loses nothing it was told, and keeps what’s waiting where it was, after the office goes down and starts again', async () => {
    await checkRestart(leadOf(/writes|note|turn ends$/), { runs: 15 });
  });
});
