import { describe, expect, it } from 'vitest';
import type { Agent, PluginState } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, focus, type Later, type Running, type Subject } from '../../plugin-api/testing';
import { DirectLine, type LineHost, type LineOfficer } from './line';
import type { CosLive, CosState } from './shared';

// The chief of staff's direct line (README.md#the-direct-line) under Focus's two rules (docs/invariants.md): a restart
// ends as if an action had never started or had finished, and two at once as one after the other would. What it keeps
// across a restart is its state (the conversation, and the goals it started and told from it); the goals themselves are
// Focus's, out here in `world`, carrying on through a restart as Focus's goals do.
//
// Its stand-ins: Claude Code answering is a step through `later`, twice a turn (before its tools run, and its reply),
// so a restart can fall before it starts a goal or after; its tools run in the part, as Ops runs a session's tools in
// Focus, so none runs once Focus has gone down. Starting a goal and telling a lead are Focus's and answer at once
// (`host.goals.start`, `message`); closing one waits (`later`), and may land as Focus goes down. A goal closed that way
// reads as closed on the line too (its lead gone), as the line reads it.
//
// Breaks seen caught: `lineAfterRestart` left out fails the restart check (the line stays thinking) and both promises
// about a restart; `startStep` starting a goal it started already fails the reach test and the promise that a retried
// turn starts it once (not the rules: the reference runs share the flaw); and `close` without its `closing` guard fails
// the check for two at once (both presses close the goal) and the promise that Close closes it once.

/** What must survive: the goals started from the line (out in Focus), each as the line has it, what leads were told, and whether it's stuck thinking. */
interface Kept {
  goals: string[];
  closed: string[];
  line: string[];
  told: string[];
  thinking: boolean;
}

const TOLD_ABOUT = 'Mind the footer on saved items';

/** The direct line over a stand-in Focus: `world` (its goals, and what's kept of the plugin's state) is what a restart keeps. */
function lineLife(later: Later, world: { leads: Agent[]; started: string[]; closed: string[]; told: string[]; kept: CosState; n: number }): Running<Kept> {
  const saved: PluginState<CosState> = { get: () => world.kept, set: (patch) => void (world.kept = { ...world.kept, ...patch }) };
  let activity: CosLive = { lineActivity: '' };
  const live: PluginState<CosLive> = { get: () => activity, set: (patch) => void (activity = { ...activity, ...patch }) };
  const host: LineHost = {
    projects: () => [{ id: 'p', name: 'Web shop', repos: [] } as never],
    on: () => true,
    agents: () => world.leads,
    settings: () => focus().store.settings,
    shipStatus: () => Promise.resolve({ projects: [] }),
    goals: {
      start: (projectId, text) => {
        const agent = { id: `lead-${++world.n}`, name: 'Cmdr. Vale', task: 'lead', projectId, status: 'working', lead: { title: text } } as unknown as Agent;
        world.leads.push(agent);
        world.started.push(text);
        return { agent };
      },
      message: (_id, text) => {
        world.told.push(text);
        return { sent: true };
      },
      closeGoal: (id) => later('closing the goal', () => {
        world.leads = world.leads.filter((l) => l.id !== id);
        world.closed.push(id);
        return Promise.resolve({ closed: true as const });
      }),
    },
    saved,
    live,
  };
  // Claude Code: asked for dark mode it starts that goal, told about the footer it tells the open goal, and replies
  const officer: LineOfficer = {
    turn: async (req) => {
      await later('the model reads it', () => Promise.resolve());
      const tool = (name: string) => req.tools.find((t) => t.name === name);
      if (req.prompt.includes('dark mode')) await tool('start_goal')?.run({ projectId: 'p', text: 'Add dark mode', why: 'You asked for it' }).catch(() => undefined);
      if (req.prompt.includes('footer')) await tool('tell_goal')?.run({ leadId: 'lead-0', text: TOLD_ABOUT }).catch(() => undefined);
      return later('the model replies', () => Promise.resolve({ text: 'Done.', sessionId: 's1' }));
    },
  };
  const line = new DirectLine(host, officer);
  const aboard = () => new Set(world.leads.map((l) => l.id));
  return {
    actions: () => [
      { name: 'the user asks for dark mode', run: () => line.say('Add dark mode please') },
      { name: 'the user asks for it again', run: () => line.say('Did you start dark mode?') },
      { name: 'the user mentions the footer', run: () => line.say('Saved items: mind the footer') },
      {
        name: 'the user closes what it started',
        run: () => {
          const open = line.current().started.find((s) => s.closed === undefined);
          if (!open) throw new Error('nothing to close');
          return line.close(open.key);
        },
      },
      { name: 'a new conversation', run: () => line.newConversation() },
    ],
    durable: () => ({
      goals: [...world.started],
      closed: [...world.closed],
      line: line.current().started.map((s) => `${s.text} ${s.closed !== undefined || !aboard().has(s.leadId) ? 'closed' : 'open'}`),
      told: line.current().told.map((t) => t.text),
      thinking: line.current().status === 'thinking',
    }),
    settle: () => line.settled(),
    restart: (l) => lineLife(l, world),
  };
}

const subject: Subject<Kept> = {
  name: 'the direct line',
  start: (later) => {
    const saved = { id: 'lead-0', name: 'Lt. Reyes', task: 'lead', projectId: 'p', status: 'done', lead: { title: 'Saved items' } } as unknown as Agent;
    return lineLife(later, { leads: [saved], started: [], closed: [], told: [], kept: { autoSend: {} }, n: 0 });
  },
};

const answersAtOnce: Later = (_label, work) => work();
const take = async (r: Running<Kept>, name: string) => {
  await r.actions().find((a) => a.name === name)?.run();
  await r.settle();
};

describe('the direct line, under Focus’s two rules', () => {
  it('ends a restart as if a turn or a close had never started, or had finished', async () => {
    await checkRestart(subject, { runs: 20 });
  });

  it('ends two actions at once as one after the other would', async () => {
    await checkAtOnce(subject, { runs: 100 });
  });

  it('reaches a goal started, found again, closed, and started again; and a goal told', async () => {
    const r = await subject.start(answersAtOnce);
    await take(r, 'the user asks for dark mode');
    await take(r, 'the user asks for it again');
    expect(r.durable()).toMatchObject({ goals: ['Add dark mode'], line: ['Add dark mode open'] });
    await take(r, 'the user closes what it started');
    await take(r, 'the user asks for dark mode');
    await take(r, 'the user mentions the footer');
    expect(r.durable()).toEqual({ goals: ['Add dark mode', 'Add dark mode'], closed: ['lead-1'], line: ['Add dark mode closed', 'Add dark mode open'], told: [TOLD_ABOUT], thinking: false });
  });

  // README.md: "it starts a goal once, however often a turn asks for it: a retried turn, or one resumed after a restart"
  it('starts a goal once through a turn retried after a restart cut it', async () => {
    let cut = false;
    const stopsAfterTools: Later = (label, work) => (cut && label === 'the model replies' ? new Promise<never>(() => undefined) : work());
    cut = true;
    const r = await subject.start(stopsAfterTools);
    void r.actions()[0]?.run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const after = await r.restart(answersAtOnce);
    await take(after, 'the user asks for dark mode');
    expect(after.durable()).toMatchObject({ goals: ['Add dark mode'], line: ['Add dark mode open'], thinking: false });
  });

  // README.md: "a turn a restart cut ends failed, saying so, and the line takes the next message"
  it('ends a turn a restart cut as failed, and takes the next message', async () => {
    const r = await subject.start(() => new Promise<never>(() => undefined));
    await r.actions()[2]?.run();
    expect(r.durable().thinking).toBe(true);
    const after = await r.restart(answersAtOnce);
    expect(after.durable().thinking).toBe(false);
    await take(after, 'the user mentions the footer');
    expect(after.durable().told).toEqual([TOLD_ABOUT]);
  });

  // README.md: "Close closes the goal it started, once however often it's pressed"
  it('closes the goal it started once, however often Close is pressed', async () => {
    // the goal's close takes a while, so the second press comes while the first is out
    const out: (() => void)[] = [];
    const slowClose: Later = (label, work) => (label === 'closing the goal' ? new Promise<void>((resolve) => out.push(resolve)).then(work) : work());
    const r = await subject.start(slowClose);
    await take(r, 'the user asks for dark mode');
    const close = r.actions().find((a) => a.name === 'the user closes what it started');
    const presses = Promise.allSettled([close?.run(), close?.run()]);
    for (const done of out.splice(0)) done();
    await presses;
    expect(r.durable()).toMatchObject({ closed: ['lead-1'], line: ['Add dark mode closed'] });
  });
});
