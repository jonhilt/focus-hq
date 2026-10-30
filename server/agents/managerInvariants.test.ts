import { describe, expect, it, vi } from 'vitest';
import { keyFallback } from './apiKey';
import { focus, restarted } from './fakeFocus';
import type { Agent } from '../../shared/types';
import type { FocusPlugin, PluginHost } from '../plugins/contract';
import { type Action, checkRestart, now, type Running, type Subject } from './invariants';

// A goal's lead, under Focus's rule that a restart is atomic (docs/invariants.md): what's said of a lead (held for
// the plan's limit, where its run is, what's waiting in its inbox, and that nothing it was told is lost) is the same
// after Focus goes down and starts again as before. Its run journal (runJournal.ts) is what it keeps of its turns
// and inbox. Described here (what can happen to a lead, what must survive), not told what to expect.

// Ops falls back on an API key while the plan's usage limit is reached, as in runRecovery.limit.test.ts
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
  /** A plugin's mark on the lead's latest turn: none, or what it noted. */
  mark: string;
  /** The captain has read the lead's latest turn (`readTurn`): it stops hailing them until the next ends. */
  read: boolean;
  held: boolean;
  /** The lead proposed closing the goal (`lead.closing`): the user is asked to close it, until the lead carries on. */
  closing: boolean;
  /**
   * What's waiting for the lead's next turn, and for the end of the one in hand. Not their notes: a turn a restart
   * picks back up hears them with its note that it was cut off (the next message they hear), so where they are isn't
   * kept as it was. That none is lost is `told`'s to say; `notesNow` reads them for the reach tests.
   */
  inbox: string[];
  later: string[];
  /** Every message the lead has been sent, heard (in a turn's prompt, or into a session that ran on) or still waiting: none lost. */
  told: string[];
}

/** Ops' note for a lead (a QA verdict, a slice landing, the star chart): it goes with whatever they hear next, and
 *  never starts or carries on a turn by itself. Only the manager's own parts leave one. */
const noteForLead = (agents: ReturnType<typeof focus>['agents'], lead: Agent, text: string) =>
  (Reflect.get(agents, 'core') as { leads: { noteForLead(lead: Agent, from: string, text: string): void } }).leads.noteForLead(lead, 'Ops', text);

/**
 * A plugin that marks the leads' turns, as one judging them would: `ended` as each ends, from then (`since`), and
 * whatever the description has it note later.
 */
const marking = (hosts: PluginHost[]): FocusPlugin => ({
  id: 'judge',
  start: (host) => {
    hosts.push(host);
    return { turn: (agent, phase) => void (phase === 'end' && agent.task === 'lead' && host.goals.mark(agent.id, 'ended', Date.now())) };
  },
});
const startMarking = (agents: ReturnType<typeof focus>['agents'], hosts: PluginHost[]) =>
  agents.startPlugins([marking(hosts)], { demo: false, ownRepo: () => undefined });

/** The latest lead's notes waiting now. */
let notesNow: () => string[] = () => [];

/**
 * The lead's proposal to close and news from aboard that wakes them: checked on their own (`closingLead`), so the
 * checks of everything else take the paths they did before them.
 */
const CLOSING = /proposes closing|chief of staff writes/;

/** A goal's lead; `only`, the actions offered, by name, when a check is after one thing (all but `CLOSING` without). */
const leadOf = (only?: RegExp): Subject<Said> => ({
  name: 'lead',
  start: async () => {
    // the limit is Ops' own, kept between tests: each run starts with it not reached
    Reflect.set(keyFallback, 'spell', undefined);
    const first = focus();
    // each life's plugin, the latest last
    const hosts: PluginHost[] = [];
    startMarking(first.agents, hosts);
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
      // on (a turn stopped as Focus went down may never have read it: the resumed turn hears it again)
      const heard = claudes.flatMap((c) => c.turns.flatMap((t) => [t.req.prompt, ...(t.stopped ? [] : t.sent)]));
      // not what was just taken for a turn that was never asked for: once settled, nothing will hear that
      const waiting = [...run.inbox, ...run.later, ...run.notes];
      const mark = first.store.agent(id).lead?.marks?.judge;
      return {
        phase: JSON.stringify(run.phase),
        mark: typeof mark === 'string' ? mark : 'none',
        read: first.store.agent(id).lead?.readTurn !== undefined && first.store.agent(id).lead?.readTurn === first.store.agent(id).finishedAt,
        held: !!first.store.agent(id).held,
        closing: !!first.store.agent(id).lead?.closing,
        inbox: [...run.inbox],
        later: [...run.later],
        told: Array.from({ length: sent }, (_, i) => `Message ${i + 1}`).filter((m) => [...heard, ...waiting].some((h) => h.includes(m))),
      };
    };
    notesNow = () => [...first.store.run(id).notes];
    await steady(said);
    const life = (o: Pick<ReturnType<typeof focus>, 'agents' | 'claude'>): Running<Said> => {
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
          // news from someone else aboard: it wakes the lead as the user's word does, but isn't the user's answer
          { name: 'the chief of staff writes', run: () => o.agents.message(id, `Carry on: Message ${++sent}`, 'Chief of Staff') },
          {
            name: 'the lead proposes closing the goal',
            run: async () => {
              const t = o.claude.turns.find((t, i) => !t.stopped && !ended.has(i));
              if (!t?.req.tools) throw new Error('no turn under way');
              await t.req.tools.proposeClose({ reason: 'It works end to end' });
            },
          },
          // news that goes with what they hear next
          { name: 'Ops leaves a note', run: () => noteForLead(o.agents, first.store.agent(id), `QA passed it: Message ${++sent}`) },
          { name: 'the captain stops them', run: () => o.agents.stop(id) },
          // its mark on the lead's turn, whenever it comes: kept until their next turn starts
          { name: 'the plugin marks the turn', run: () => hosts[hosts.length - 1]?.goals.mark(id, 'judged', Date.now()) },
          // about a turn from before the lead's latest started: it's an earlier turn's
          { name: 'a mark on an earlier turn comes', run: () => hosts[hosts.length - 1]?.goals.mark(id, 'late', 0) },
          { name: 'the plugin takes its mark away', run: () => hosts[hosts.length - 1]?.goals.mark(id, undefined) },
          { name: 'the captain reads the turn', run: () => o.agents.readTurn(id) },
        ] satisfies Action[]).filter((a) => (only ? only.test(a.name) : !CLOSING.test(a.name))),
        durable: said,
        settle: () => steady(said),
        close: () => o.agents.shutDown(),
        restart: () => {
          o.agents.shutDown();
          const after = restarted(first.store);
          startMarking(after.agents, hosts);
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
/** The actions a lead's proposal to close is about, described on their own (`leadOf` leaves them out by default). */
const closingLead = leadOf(/proposes closing|writes|turn ends$/);

describe('a goal’s lead, under Focus’s rule for a restart', () => {
  // a description that never got a message into a turn, or a note waiting for the next, would prove nothing of the inbox
  it('reaches messages sent into a turn, notes waiting for the next message and going into a turn with it, and a turn taking them', async () => {
    const l = await lead.start(now);
    const seen: (Said & { notes: string[] })[] = [];
    for (const name of ['the captain writes', 'Ops leaves a note', 'the captain writes', 'Ops leaves a note', 'the turn ends', 'the turn ends', 'the captain writes']) {
      await Promise.resolve().then(() => l.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await l.settle();
      seen.push({ ...l.durable(), notes: notesNow() });
    }
    l.close?.();
    // into the turn in hand; a note waiting; into the turn with the next message; a note waiting as the turn ends, and
    // still waiting with no turn; then taken with the captain's next message
    expect(seen.map((s) => s.told.length)).toEqual([1, 2, 3, 4, 4, 4, 5]);
    expect(seen[1]).toMatchObject({ notes: [expect.stringContaining('Message 2')], later: [], inbox: [] });
    expect(seen[2].notes).toEqual([]);
    expect(seen[4]).toMatchObject({ notes: [expect.stringContaining('Message 4')], later: [], inbox: [] });
    expect(seen[6]).toMatchObject({ notes: [], inbox: [] });
  });

  // docs/goals.md: only the captain starts a goal lead's next turn; Ops' and QA's news is a note heard with their next message
  it('never starts or carries on a turn for a note', async () => {
    const l = await lead.start(now);
    const phases: string[] = [];
    for (const name of ['Ops leaves a note', 'the turn ends', 'Ops leaves a note', 'Ops leaves a note']) {
      await Promise.resolve().then(() => l.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await l.settle();
      phases.push(l.durable().phase);
    }
    l.close?.();
    // the note left mid-turn doesn't carry it on, and those left after it ends don't start one
    expect(phases.slice(1)).toEqual(Array(3).fill(phases[1]));
    expect(JSON.parse(phases[1])).toBe('ended');
    expect(notesNow()).toHaveLength(3);
  });

  // docs/plugins.md: a plugin's mark on a lead's turn lasts until their next turn starts, and one on an earlier turn is refused
  it('reaches a turn marked as it ends and again later, its mark ended by the next turn, and refuses a mark on an earlier turn', async () => {
    const l = await lead.start(now);
    const seen: string[] = [];
    for (const name of ['the turn ends', 'a mark on an earlier turn comes', 'the plugin marks the turn', 'the plugin takes its mark away', 'the plugin marks the turn', 'the captain writes', 'the turn ends']) {
      await Promise.resolve().then(() => l.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await l.settle();
      seen.push(l.durable().mark);
    }
    l.close?.();
    expect(seen).toEqual(['ended', 'ended', 'judged', 'none', 'judged', 'none', 'ended']);
  });

  // docs/goals.md: the question whether to close stands only until the lead carries on: their next turn sets it aside,
  // whoever woke them, and a proposal in that turn asks again
  it('keeps a proposal to close past its turn’s end and news mid-turn, sets it aside as the next turn starts, and asks again in it', async () => {
    const l = await closingLead.start(now);
    const seen: boolean[] = [];
    for (const name of ['the lead proposes closing the goal', 'the chief of staff writes', 'the turn ends', 'the chief of staff writes', 'the lead proposes closing the goal', 'the turn ends']) {
      await Promise.resolve().then(() => l.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await l.settle();
      seen.push(l.durable().closing);
    }
    l.close?.();
    expect(seen).toEqual([true, true, true, false, true, true]);
  });

  // docs/goals.md: a turn Focus picks back up after a restart cut it off is the same turn, so its question stands
  it('keeps a proposal to close made in a turn a restart cut off, as that turn carries on', async () => {
    const l = await closingLead.start(now);
    await l.actions().find((a) => a.name === 'the lead proposes closing the goal')?.run();
    await l.settle();
    const after = await l.restart(now);
    await after.settle();
    expect(after.durable()).toMatchObject({ closing: true, phase: JSON.stringify({ turn: 'started' }) });
    after.close?.();
  });

  // docs/goals.md: the lead hears their brief again once their conversation's compacted, and asks with their office
  // tools, in a conversation agent-host carries on after a restart as in any other (before a turn of theirs brings them)
  it('gives the host a lead’s office tools and brief for a conversation it resumes after a restart, and no one else extras', async () => {
    const first = focus();
    const started = first.agents.startGoal(first.project.id, 'Saved items');
    if (!('agent' in started)) throw new Error('the goal was queued');
    first.agents.shutDown();
    const after = restarted(first.store);
    const extras = after.agents.sessionExtras(started.agent.id);
    expect(extras?.cwd).toBeTruthy();
    expect(extras?.brief?.afterCompact()).toContain('Saved items');
    expect(Object.keys(extras?.tools ?? {})).toEqual(['recap', 'show', 'ask', 'proposeClose', 'extra']);
    expect(after.agents.sessionExtras('nobody')).toBeUndefined();
    after.agents.shutDown();
  });

  it('is said to be where it was, and held if it was, after Focus goes down and starts again', async () => {
    await checkRestart(lead, { runs: 15 });
  });

  // what the lead's told, kept through a restart: messages into a turn, notes waiting for it to end, and the next turn
  it('loses nothing it was told, and keeps what’s waiting where it was, after Focus goes down and starts again', async () => {
    await checkRestart(leadOf(/captain writes|note|turn ends$/), { runs: 15 });
  });

  // whether the lead's proposing to close, kept through a restart: made, set aside by news that wakes them, made again
  it('is said to propose closing the goal, or not, as it was, after Focus goes down and starts again', async () => {
    await checkRestart(closingLead, { runs: 15 });
  });
});
