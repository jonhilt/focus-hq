import { describe, expect, it } from 'vitest';
import type { ServerEvent, StudioTake } from '../../shared/types';
import { currentTake } from '../../shared/takeScript';
import type { Hub } from '../hub';
import { freshStudio, type Store } from '../store';
import { applyRetime, applyTake, STUDIO_LIMITS, studioPrompt, studioSystemPrompt, type TakeInput } from './studio';
import type { ShipStatus } from './numberOne';
import { sheetData, type Staged, StudioComputer, type StudioOfficer, type StudioTurn } from './studioComputer';

const ok = <T>(result: T | { error: string }): T => {
  if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error);
  return result;
};

describe('applyTake', () => {
  const take = (more: Partial<TakeInput> = {}): TakeInput => ({ id: 'a', label: 'Crew at consoles', seconds: 10, script: 'function render(t) {}', ...more });

  it('adds a new take last, at version 1', () => {
    const takes = ok(applyTake([], take({ id: ' A ' }), 5));
    expect(takes).toEqual([{ id: 'a', label: 'Crew at consoles', seconds: 10, script: 'function render(t) {}', version: 1, at: 5 }]);
  });

  it('revises one under the same id in place, counting its version up and forgetting its error', () => {
    const before: StudioTake[] = [{ id: 'a', label: 'A', seconds: 5, script: '', version: 2, at: 1, error: 'boom' }, { id: 'b', label: 'B', seconds: 5, script: '', version: 1, at: 2 }];
    const after = ok(applyTake(before, take({ label: 'Slower' }), 9));
    expect(after.map((t) => [t.id, t.version, t.label, t.error])).toEqual([['a', 3, 'Slower', undefined], ['b', 1, 'B', undefined]]);
  });

  it('keeps the latest scenes, the oldest going once there are too many, and the one staged last stands in the hall', () => {
    let takes: StudioTake[] = [];
    for (let i = 0; i < STUDIO_LIMITS.takes; i++) takes = ok(applyTake(takes, take({ id: `t${i}` }), i));
    const more = ok(applyTake(takes, take({ id: 'more' }), 99));
    expect(more).toHaveLength(STUDIO_LIMITS.takes);
    expect(more.map((t) => t.id)).not.toContain('t0');
    expect(currentTake(more)?.id).toBe('more');
    const again = ok(applyTake(more, take({ id: 't3', label: 'Again' }), 100));
    expect(again).toHaveLength(STUDIO_LIMITS.takes);
    expect(currentTake(again)?.id).toBe('t3');
  });

  it('keeps its metaphor and phases, and refuses phases that don’t fit its seconds', () => {
    const [made] = ok(applyTake([], take({ metaphor: ' Runners   sent to stations ', phases: { send: [0, 4], back: [4, 10] } }), 1));
    expect(made).toMatchObject({ metaphor: 'Runners sent to stations', phases: { send: [0, 4], back: [4, 10] } });
    expect(applyTake([], take({ phases: { send: [0, 12] } }), 1)).toEqual({ error: expect.stringContaining('Phase send runs [0, 12]') });
    expect(applyTake([], take({ phases: { 'two words': [0, 1] } }), 1)).toHaveProperty('error');
  });

  it('refuses a script that doesn’t parse, a bad id, or a length out of range', () => {
    expect(applyTake([], take({ script: 'function render(t) {' }), 1)).toEqual({ error: expect.stringContaining('doesn\'t parse') });
    expect(applyTake([], take({ id: 'Take One' }), 1)).toHaveProperty('error');
    expect(applyTake([], take({ seconds: 0.5 }), 1)).toHaveProperty('error');
    expect(ok(applyTake([], take({ id: 'fan-out' }), 1))[0].id).toBe('fan-out');
  });
});

describe('sheetData', () => {
  it('takes a JPEG data URL’s base64, and nothing else', () => {
    expect(sheetData('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe('/9j/4AAQSkZJRg==');
    expect(sheetData('data:image/png;base64,iVBORw0KGgo=')).toBeUndefined();
    expect(sheetData('data:image/jpeg;base64,<script>')).toBeUndefined();
    expect(sheetData(42)).toBeUndefined();
  });
});

describe('applyRetime', () => {
  const staged: StudioTake[] = [{ id: 'b', label: 'B', seconds: 10, phases: { send: [0, 4], back: [4, 10] }, script: 'function render(t) {}', version: 2, at: 1, error: 'boom' }];

  it('plays a take slower by stretching its length and every phase, its script untouched, a version on', () => {
    const [b] = ok(applyRetime(staged, { id: 'B', speed: 0.5 }, 9));
    expect(b).toEqual({ id: 'b', label: 'B', seconds: 20, phases: { send: [0, 8], back: [8, 20] }, script: 'function render(t) {}', version: 3, at: 9 });
  });

  it('sets new phases and length as given, and refuses ones that don’t fit or a take that isn’t there', () => {
    expect(ok(applyRetime(staged, { id: 'b', seconds: 12, phases: { send: [0, 2], back: [2, 12] } }, 9))[0]).toMatchObject({ seconds: 12, phases: { send: [0, 2], back: [2, 12] } });
    expect(applyRetime(staged, { id: 'b', seconds: 3 }, 9)).toEqual({ error: expect.stringContaining('Phase send') });
    expect(applyRetime(staged, { id: 'z', speed: 2 }, 9)).toEqual({ error: expect.stringContaining('Kept: b') });
    expect(applyRetime(staged, { id: 'b', speed: 0.01 }, 9)).toHaveProperty('error');
  });
});

describe('studioPrompt', () => {
  const messages = [
    { from: 'captain' as const, text: 'Show me subagents fanning out', at: 1 },
    { from: 'computer' as const, text: 'It’s up.', at: 2 },
    { from: 'captain' as const, text: 'Slower', at: 3 },
  ];
  const kept: StudioTake[] = [
    { id: 'fan-out', label: 'Fan out', seconds: 5, script: '', version: 2, at: 4 },
    { id: 'pipeline', label: 'Track and gates', seconds: 5, script: '', version: 1, at: 3 },
  ];

  it('sends a resumed session only what the captain said since its last reply', () => {
    expect(studioPrompt(messages, true, kept)).toBe('Slower');
  });

  it('recaps the conversation and the scenes it built, and which is in the hall, for a session that starts afresh', () => {
    const prompt = studioPrompt(messages, false, kept);
    expect(prompt).toContain('Captain: Show me subagents fanning out\nYou: It’s up.');
    expect(prompt).toContain('fan-out (Fan out, in the hall now), pipeline (Track and gates)');
    expect(prompt.endsWith('The captain: Slower')).toBe(true);
    expect(studioPrompt(messages, false)).not.toContain('scenes you');
  });
});

describe('studioSystemPrompt', () => {
  it('lists the projects aboard and where their code goes once opened, and says to read the real thing first', () => {
    const prompt = studioSystemPrompt({ projects: [{ id: 'p1', name: 'Thomas', repos: ['jonhilt/thomas'] }], planning: '/data/planning' });
    expect(prompt).toContain('- Thomas, id `p1`: `/data/planning/p1/thomas/` (jonhilt/thomas)');
    expect(prompt).toContain('open_project');
    expect(prompt).toContain('ship_status');
  });
});

describe('StudioComputer', () => {
  const setup = (turn: (req: StudioTurn) => Promise<string>) => {
    const store = { studio: freshStudio(), settings: {}, projects: [], save: () => undefined } as unknown as Store;
    const sent: ServerEvent[] = [];
    const hub = { send: (e: ServerEvent) => sent.push(e) } as unknown as Hub;
    const officer: StudioOfficer = { turn: async (req) => ({ text: await turn(req), sessionId: 's1', costUsd: 0.1, model: req.model ?? 'claude-sonnet-5-5' }) };
    return { store, sent, computer: new StudioComputer(store, hub, officer, async (): Promise<ShipStatus> => ({ projects: [] }), 50) };
  };
  const settled = (store: Store) => new Promise<void>((resolve) => {
    const check = () => (store.studio.status === 'thinking' ? setTimeout(check, 5) : resolve());
    check();
  });

  it('hands each turn the projects aboard, hidden ones left out, and the ship as it stands', async () => {
    const asked: StudioTurn[] = [];
    const { store, computer } = setup(async (req) => {
      asked.push(req);
      return 'ok';
    });
    store.projects = [{ id: 'p1', name: 'Thomas', repos: ['jonhilt/thomas'] }, { id: 'p2', name: 'Secret', repos: ['x/y'], hidden: true }] as unknown as Store['projects'];
    computer.say('Show me how proposals move through Thomas');
    await settled(store);
    expect(asked[0].projects).toEqual([{ id: 'p1', name: 'Thomas', repos: ['jonhilt/thomas'] }]);
    expect(await asked[0].shipStatus()).toEqual({ projects: [] });
  });

  it('builds a scene with its tools on a turn, and replies', async () => {
    const { store, computer, sent } = setup(async (req) => {
      await req.tools.take({ id: 'fan-out', label: 'Fan out', seconds: 5, script: 'function render(t) {}' });
      return 'It’s up.';
    });
    computer.say('Show me subagents');
    await settled(store);
    expect(store.studio.takes.map((t) => t.id)).toEqual(['fan-out']);
    expect(store.studio.messages.map((m) => m.from)).toEqual(['captain', 'computer']);
    expect(store.studio.sessionId).toBe('s1');
    expect(sent.at(-1)).toMatchObject({ type: 'studio', session: { status: 'waiting' } });
    expect(sent.some((e) => e.type === 'studio' && 'sessionId' in e.session)).toBe(false);
  });

  it('tells the session whether the room ran its take, or that no one was watching', async () => {
    const heard: string[] = [];
    const { store, computer } = setup(async (req) => {
      const staged = req.tools.take({ id: 'a', label: 'A', seconds: 5, script: 'function render(t) {}' });
      setTimeout(() => computer.report('a', 1, 'kit.boxx is not a function'), 10);
      heard.push((await staged).text);
      heard.push((await req.tools.take({ id: 'b', label: 'B', seconds: 5, script: 'function render(t) {}' })).text);
      return 'done';
    });
    computer.say('Show me');
    await settled(store);
    expect(heard[0]).toContain('failed there: kit.boxx is not a function');
    expect(heard[1]).toContain('no one\'s in the studio');
    expect(store.studio.takes.find((t) => t.id === 'a')?.error).toBe('kit.boxx is not a function');
  });

  it('hands the computer the room’s contact sheet of a scene that ran', async () => {
    let staged: Staged | undefined;
    const { store, computer } = setup(async (req) => {
      const take = req.tools.take({ id: 'a', label: 'A', seconds: 5, script: 'function render(t) {}' });
      setTimeout(() => computer.report('a', 1, undefined, 'data:image/jpeg;base64,/9j/4AAQ'), 10);
      staged = await take;
      return 'Pitched';
    });
    computer.say('Workflows');
    await settled(store);
    expect(staged).toMatchObject({ sheet: '/9j/4AAQ' });
    expect(staged?.text).toContain('contact sheet');
  });

  it('runs its turns at the model and effort picked, keeps them when it starts over, and says what it ran on', async () => {
    const asked: StudioTurn[] = [];
    const { store, computer } = setup(async (req) => {
      asked.push(req);
      return 'ok';
    });
    computer.tune(' claude-opus-5-5 ', 'high');
    computer.say('Go');
    await settled(store);
    expect(asked[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    expect(store.studio.ranOn).toBe('claude-opus-5-5');
    computer.startOver();
    expect(computer.current()).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', messages: [] });
    computer.tune('', undefined);
    expect(computer.current().model).toBeUndefined();
  });

  it('starts over afresh, dropping a turn still under way', async () => {
    let finish!: () => void;
    const { store, computer } = setup(() => new Promise((resolve) => (finish = () => resolve('late'))));
    computer.say('First idea');
    computer.startOver();
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.studio.messages).toEqual([]);
    expect(store.studio.status).toBe('waiting');
  });
});
