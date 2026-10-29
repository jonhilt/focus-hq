import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, PluginState, ShipSessionRun } from '../../plugin-api/server';
import { focus } from '../../plugin-api/testing';
import { ClaudeLine } from './claudeLine';
import { DemoLine } from './demoLine';
import { DirectLine, type LineHost, type LineOfficer, linePrompt, type LineTurn } from './line';
import type { CosLive, CosState, LineStart } from './shared';

afterEach(() => vi.unstubAllEnvs());

const lead = (id: string, title: string, marks?: unknown) =>
  ({ id, name: `Lt. ${id}`, task: 'lead', projectId: 'p', status: 'done', lead: { title, ...(marks !== undefined && { marks: { 'chief-of-staff': marks } }) } }) as unknown as Agent;
const projects = [{ id: 'p', name: 'Web shop', repos: [] }, { id: 'q', name: 'API', repos: [] }];

describe('what the chief of staff reads each turn on its line', () => {
  it('is the user’s words, the projects on the line with their open goals and what waits on the user, and the goals it started', () => {
    const waiting = lead('lead-1', 'Saved items', { at: 1, judged: { route: 2, ask: 'Filters first?', why: '', message: '' } });
    const started: LineStart[] = [
      { key: 'p|x', leadId: 'lead-1', projectId: 'p', project: 'Web shop', text: 'Saved items', why: 'y', at: 1 },
      { key: 'p|y', leadId: 'lead-7', projectId: 'p', project: 'Web shop', text: 'Old one', why: 'y', at: 1, closed: 2 },
    ];
    const prompt = linePrompt({ messages: [{ from: 'user', text: 'Add dark mode', at: 1 }], projects, goals: [waiting], started });
    expect(prompt).toBe([
      'The user says:\n"""\nAdd dark mode\n"""',
      'The projects on your line, and their open goals:\n- Web shop (id p):\n  - lead-1: “Saved items” (Lt. lead-1, between turns; waiting on the user: Filters first?)\n- API (id q): no open goals',
      'Goals you\'ve started from this line:\n- “Saved items” in Web shop (lead-1): open\n- “Old one” in Web shop (lead-7): closed by the user',
    ].join('\n\n'));
  });

  it('recaps the conversation without a session, and only what’s new with one', () => {
    const messages = [{ from: 'user' as const, text: 'Hi', at: 1 }, { from: 'cos' as const, text: 'Hello', at: 2 }, { from: 'user' as const, text: 'Add search', at: 3 }];
    expect(linePrompt({ messages, projects: [], goals: [], started: [] })).toContain('Here\'s the conversation so far:\n"""\nThe user: Hi\n\nYou: Hello\n"""');
    expect(linePrompt({ messages, resumeSessionId: 's', projects: [], goals: [], started: [] })).toMatch(/^The user says:\n"""\nAdd search\n"""/);
    expect(linePrompt({ messages, projects: [], goals: [], started: [] })).toContain('None: the chief of staff isn’t switched on for any project');
  });
});

/** A line on a stand-in Focus, its officer `officer`; what it told and started goes in `world`. */
function aLine(officer: LineOfficer, world = { leads: [lead('lead-0', 'Saved items')], told: [] as string[], costly: false }) {
  let kept: CosState = { autoSend: {} };
  let live: CosLive = { lineActivity: '' };
  const host: LineHost = {
    projects: () => projects as never,
    on: (id) => id === 'p',
    agents: () => world.leads,
    settings: () => focus().store.settings,
    shipStatus: () => Promise.resolve({ projects: [] }),
    goals: {
      start: (projectId, text) => {
        const agent = { ...lead(`lead-${world.leads.length}`, text), projectId };
        world.leads.push(agent);
        return { agent };
      },
      message: (_id, text) => {
        if (world.costly) return { costly: { tokens: 1, usd: 1 } } as never;
        world.told.push(text);
        return { sent: true };
      },
      closeGoal: () => Promise.resolve({ warn: ['1 open pull request'] }),
    },
    saved: { get: () => kept, set: (p) => void (kept = { ...kept, ...p }) } satisfies PluginState<CosState>,
    live: { get: () => live, set: (p) => void (live = { ...live, ...p }) } satisfies PluginState<CosLive>,
  };
  return { line: new DirectLine(host, officer), world };
}

const tool = (req: LineTurn, name: string) => req.tools.find((t) => t.name === name);

describe('the direct line’s tools', () => {
  it('starts a goal only in a project on the line, and says so', async () => {
    const answers: string[] = [];
    const { line } = aLine({
      turn: async (req) => {
        answers.push(await tool(req, 'start_goal')?.run({ projectId: 'q', text: 'x', why: 'y' }).catch((e: Error) => e.message) ?? '');
        answers.push(await tool(req, 'start_goal')?.run({ projectId: 'p', text: 'Add search', why: 'You asked' }) ?? '');
        return { text: 'Done' };
      },
    });
    line.say('Add search');
    await line.settled();
    expect(answers[0]).toContain('There\'s no project q on your line');
    expect(answers[1]).toContain('Started “Add search” in Web shop');
    expect(line.current().started.map((s) => s.text)).toEqual(['Add search']);
  });

  it('doesn’t tell a lead when it would cost on the API key, and says why', async () => {
    let said = '';
    const { line, world } = aLine({ turn: async (req) => ({ text: (said = await tool(req, 'tell_goal')?.run({ leadId: 'lead-0', text: 'Hi' }).catch((e: Error) => e.message) ?? '') }) });
    world.costly = true;
    line.say('Tell saved items hi');
    await line.settled();
    expect(said).toContain('Not sent');
    expect(world.told).toEqual([]);
  });

  it('hands the warning back when the goal it started has work to lose, closing nothing', async () => {
    const { line } = aLine({ turn: async (req) => ({ text: (await tool(req, 'start_goal')?.run({ projectId: 'p', text: 'Add search', why: 'You asked' })) ?? '' }) });
    line.say('Add search');
    await line.settled();
    const key = line.current().started[0]?.key ?? '';
    expect(await line.close(key)).toEqual({ warn: ['1 open pull request'] });
    expect(line.current().started[0]?.closed).toBeUndefined();
  });

  it('acknowledges a goal it started (Got it in the muster): marked, the goal running on, refused a second time', async () => {
    const { line, world } = aLine({ turn: async (req) => ({ text: (await tool(req, 'start_goal')?.run({ projectId: 'p', text: 'Add search', why: 'You asked' })) ?? '' }) });
    line.say('Add search');
    await line.settled();
    const key = line.current().started[0]?.key ?? '';
    expect(line.acknowledge(key).started[0]).toMatchObject({ key, acked: expect.any(Number) });
    expect(line.current().started[0]?.closed).toBeUndefined();
    expect(world.leads.map((l) => l.id)).toContain(line.current().started[0]?.leadId);
    expect(() => line.acknowledge(key)).toThrow('no longer waiting');
  });

  it('refuses a word while it’s thinking, and ends a failed turn failed', async () => {
    const { line } = aLine({ turn: () => Promise.reject(new Error('Gave up after 8 minutes')) });
    line.say('Hi');
    expect(() => line.say('Again')).toThrow('still thinking');
    await line.settled();
    expect(line.current()).toMatchObject({ status: 'failed', error: 'Gave up after 8 minutes' });
  });

  it('drops a reply that comes after a new conversation, keeping what it started', async () => {
    let reply = (_: string) => undefined as unknown;
    const { line } = aLine({ turn: (req) => tool(req, 'start_goal')?.run({ projectId: 'p', text: 'Add search', why: 'y' }).then(() => new Promise((r) => (reply = () => r({ text: 'Late' })))) as never });
    line.say('Add search');
    await new Promise((r) => setTimeout(r, 1));
    line.newConversation();
    reply('');
    await line.settled();
    expect(line.current()).toMatchObject({ status: 'waiting', messages: [] });
    expect(line.current().started).toHaveLength(1);
  });
});

describe('the line’s Claude Code session', () => {
  it('is a ship session with the code tools and the line’s own, resuming its session', async () => {
    let seen: ShipSessionRun | undefined;
    const claude = new ClaudeLine((run) => {
      seen = run;
      return Promise.resolve({ text: 'Hello', structured: undefined, sessionId: 's2', costUsd: 0.02 });
    });
    const req = { system: 'sys', prompt: 'p', resumeSessionId: 's1', projects: [], shipStatus: () => Promise.resolve({ projects: [] }), tools: [], settings: focus().store.settings, signal: new AbortController().signal };
    expect(await claude.turn(req, () => undefined)).toEqual({ text: 'Hello', sessionId: 's2', costUsd: 0.02 });
    expect(seen).toMatchObject({ builtins: ['Read', 'Glob', 'Grep'], resume: 's1', prompt: 'p' });
    expect(seen?.systemAppend({ workspaces: '/w' })).toBe('sys');
  });
});

describe('the demo’s line', () => {
  it('tells the open goal named, starts a goal when asked to build something (once), and otherwise talks', async () => {
    vi.stubEnv('FOCUS_DEMO_SPEED', '1000');
    const { line, world } = aLine(new DemoLine());
    const say = async (text: string) => {
      line.say(text);
      await line.settled();
      return line.current().messages.at(-1)?.text ?? '';
    };
    expect(await say('About saved items: mind the footer')).toContain('told its lead');
    expect(world.told).toEqual(['About saved items: mind the footer']);
    expect(await say('Let’s add search to the web shop')).toContain('I started it in Web shop');
    expect(await say('How are things?')).toContain('Understood');
    expect(line.current().started).toHaveLength(1);
  });
});
