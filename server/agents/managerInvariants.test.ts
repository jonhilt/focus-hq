import { describe, it, vi } from 'vitest';
import { keyFallback } from './apiKey';
import { office, restarted } from './fakeOffice';
import { checkRestart, type Running, type Subject } from './invariants';

// A goal's lead, under the office's rule that a restart is atomic (docs/invariants.md): what's said of a lead (held for
// the plan's limit, where its run is) is the same after the office goes down and starts again as before. Described here
// (what can happen to a lead, what must survive), not told what to expect.

// the office falls back on an API key while the plan's usage limit is reached, as in runRecovery.limit.test.ts
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.FOCUS_USE_API_KEY = 'fallback';
});
vi.setConfig({ testTimeout: 60_000 });

/** Until what `read` says stops changing (three looks 10 ms apart, a second at most): the manager's own async work done. */
const steady = async (read: () => unknown) => {
  let last = JSON.stringify(read());
  for (let same = 0, i = 0; same < 3 && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 10));
    const now = JSON.stringify(read());
    same = now === last ? same + 1 : 0;
    last = now;
  }
};

interface Said {
  phase: string;
  held: boolean;
}

const lead: Subject<Said> = {
  name: 'lead',
  start: async () => {
    // the limit is the office's own, kept between tests: each run starts with it not reached
    Reflect.set(keyFallback, 'spell', undefined);
    const first = office();
    const started = first.agents.startGoal(first.project.id, 'Saved items');
    if (!('agent' in started)) throw new Error('the goal was queued');
    const id = started.agent.id;
    const said = (): Said => ({ phase: JSON.stringify(first.store.run(id).phase), held: !!first.store.agent(id).held });
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
        actions: () => [
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
          { name: 'the captain writes', run: () => o.agents.message(id, 'And the header') },
          { name: 'the captain stops them', run: () => o.agents.stop(id) },
        ],
        durable: said,
        settle: () => steady(said),
        close: () => o.agents.shutDown(),
        restart: () => {
          o.agents.shutDown();
          const after = restarted(first.store);
          after.agents.recover();
          return life(after);
        },
      };
    };
    return life(first);
  },
};

describe('a goal’s lead, under the office’s rule for a restart', () => {
  it('is said to be where it was, and held if it was, after the office goes down and starts again', async () => {
    await checkRestart(lead, { runs: 20 });
  });
});
