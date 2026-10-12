import { describe, expect, it } from 'vitest';
import type { ServerEvent, StudioTake, StudioVideo } from '../../shared/types';
import type { Hub } from '../hub';
import { freshStudio, type Store } from '../store';
import { applyPitch, applyRetime, applyTake, applyVideo, STUDIO_LIMITS, studioPrompt, type TakeInput, videoReply } from './studio';
import { sheetData, type Staged, StudioComputer, type StudioOfficer, type StudioTurn } from './studioComputer';

const started = (more: Partial<StudioVideo> = {}): StudioVideo => ({ premise: 'How Claude delegates', beats: [], threads: [], ...more });
const ok = <T>(result: T | { error: string }): T => {
  if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error);
  return result;
};

describe('applyVideo', () => {
  it('starts with the premise, and refuses anything before it', () => {
    expect(applyVideo(undefined, { thread: 'What does /batch cost?' }, 5)).toEqual({ error: expect.stringContaining('Start with the premise') });
    expect(applyVideo(undefined, { premise: '  How   Claude delegates ' }, 5)).toEqual({ premise: 'How Claude delegates', beats: [], threads: [] });
  });

  it('replaces what it’s sent and keeps the rest, beats with their lines', () => {
    const video = ok(applyVideo(started({ takeaway: 'Reach for the smallest rung' }), { beats: [{ title: 'Alone', point: 'One context fills up', lines: 'Here’s Claude on its own.' }, { title: 'Subagents', point: ' ' }] }, 7));
    expect(video).toEqual({ premise: 'How Claude delegates', takeaway: 'Reach for the smallest rung', beats: [{ title: 'Alone', point: 'One context fills up', lines: 'Here’s Claude on its own.' }, { title: 'Subagents' }], threads: [] });
  });

  it('refuses parts that are too long, too many beats, or a beat without a title', () => {
    expect(applyVideo(undefined, { premise: 'x'.repeat(STUDIO_LIMITS.premise + 1) }, 1)).toHaveProperty('error');
    expect(applyVideo(started(), { beats: Array.from({ length: STUDIO_LIMITS.beats + 1 }, (_, i) => ({ title: `B${i}` })) }, 1)).toHaveProperty('error');
    expect(applyVideo(started(), { beats: [{ title: '' }] }, 1)).toHaveProperty('error');
  });

  it('logs threads with the next id and closes them answered or dropped', () => {
    const one = ok(applyVideo(started(), { thread: 'How many agents can a workflow run at once?' }, 2));
    const two = ok(applyVideo(one, { thread: 'Does /batch need a clean tree?' }, 3));
    expect(two.threads.map((t) => t.id)).toEqual(['t1', 't2']);
    const answered = ok(applyVideo(two, { closeThread: { id: 't1', as: 'answered', answer: 'Up to 16 in a wave' } }, 4));
    expect(answered.threads[0].closed).toEqual({ as: 'answered', answer: 'Up to 16 in a wave', at: 4 });
    expect(applyVideo(answered, { closeThread: { id: 't1', as: 'dropped' } }, 5)).toEqual({ error: 'Thread t1 was already answered.' });
    expect(applyVideo(answered, { closeThread: { id: 't9', as: 'dropped' } }, 5)).toEqual({ error: expect.stringContaining('Open threads: t2') });
    expect(ok(applyVideo(answered, { thread: 'Another?' }, 6)).threads.at(-1)!.id).toBe('t3');
    expect(applyVideo(answered, { thread: 'does /BATCH need a clean tree?' }, 6)).toEqual({ error: 'That\'s already open as t2.' });
  });

  it('says back which thread it logged and which are open', () => {
    const after = started({ threads: [{ id: 't1', text: 'Cost?', at: 1 }] });
    expect(videoReply(started(), after)).toBe('The holodeck shows it. Logged thread t1. Open threads: t1 (Cost?).');
    expect(videoReply(after, after)).toBe('The holodeck shows it. Open threads: t1 (Cost?).');
  });
});

describe('applyTake', () => {
  const take = (more: Partial<TakeInput> = {}): TakeInput => ({ id: 'a', label: 'Crew at consoles', seconds: 10, script: 'function render(t) {}', ...more });

  it('adds a new take last, at version 1', () => {
    const takes = ok(applyTake([], take({ id: ' A ' }), 0, 5));
    expect(takes).toEqual([{ id: 'a', label: 'Crew at consoles', seconds: 10, script: 'function render(t) {}', version: 1, at: 5 }]);
  });

  it('revises one under the same id in place, counting its version up and forgetting its error', () => {
    const before: StudioTake[] = [{ id: 'a', label: 'A', seconds: 5, script: '', version: 2, at: 1, error: 'boom' }, { id: 'b', label: 'B', seconds: 5, script: '', version: 1, at: 2 }];
    const after = ok(applyTake(before, take({ label: 'Slower' }), 0, 9));
    expect(after.map((t) => [t.id, t.version, t.label, t.error])).toEqual([['a', 3, 'Slower', undefined], ['b', 1, 'B', undefined]]);
  });

  it('keeps every take on the floor, and refuses a new one once it is full rather than dropping one', () => {
    let takes: StudioTake[] = [];
    for (let i = 0; i < STUDIO_LIMITS.takes; i++) takes = ok(applyTake(takes, take({ id: `t${i}` }), 0, i));
    expect(applyTake(takes, take({ id: 'more' }), 0, 99)).toEqual({ error: expect.stringContaining('drop one first') });
    expect(ok(applyTake(takes, take({ id: 't0', label: 'Again' }), 0, 99))).toHaveLength(STUDIO_LIMITS.takes);
  });

  it('keeps its metaphor and phases, and refuses phases that don’t fit its seconds', () => {
    const [made] = ok(applyTake([], take({ metaphor: ' Runners   sent to stations ', phases: { send: [0, 4], back: [4, 10] } }), 0, 1));
    expect(made).toMatchObject({ metaphor: 'Runners sent to stations', phases: { send: [0, 4], back: [4, 10] } });
    expect(applyTake([], take({ phases: { send: [0, 12] } }), 0, 1)).toEqual({ error: expect.stringContaining('Phase send runs [0, 12]') });
    expect(applyTake([], take({ phases: { 'two words': [0, 1] } }), 0, 1)).toHaveProperty('error');
  });

  it('refuses a script that doesn’t parse, a bad id, a beat that isn’t there, or a length out of range', () => {
    expect(applyTake([], take({ script: 'function render(t) {' }), 0, 1)).toEqual({ error: expect.stringContaining('doesn\'t parse') });
    expect(applyTake([], take({ id: 'Take One' }), 0, 1)).toHaveProperty('error');
    expect(applyTake([], take({ beat: 2 }), 2, 1)).toEqual({ error: expect.stringContaining('no beat 2') });
    expect(applyTake([], take({ seconds: 0.5 }), 0, 1)).toHaveProperty('error');
    expect(ok(applyTake([], take({ beat: 1 }), 2, 1))[0].beat).toBe(1);
  });
});

describe('applyPitch', () => {
  const way = (title: string) => ({ title, metaphor: `${title}: what moves, and what it means`, scale: 'the room round you' });

  it('numbers a beat’s pitches in order, and replaces the beat’s last pitches but no other beat’s', () => {
    const first = ok(applyPitch([], { beat: 0, pitches: [way('Pattern buffer'), way('Tactical table')] }, 2, 1));
    const second = ok(applyPitch(first, { beat: 1, pitches: [way('Shuttlebay'), way('Duty roster'), way('Conveyor')] }, 2, 2));
    const again = ok(applyPitch(second, { beat: 0, pitches: [way('Glass columns'), way('Away team')] }, 2, 3));
    expect(again.map((p) => [p.beat, p.pitches.map((x) => x.title)])).toEqual([[1, ['Shuttlebay', 'Duty roster', 'Conveyor']], [0, ['Glass columns', 'Away team']]]);
  });

  it('keeps each pitch’s scale and check, tidied', () => {
    const [set] = ok(applyPitch([], { pitches: [{ ...way('A'), check: '  Holds for   1000 agents ' }, way('B')] }, 0, 1));
    expect(set.beat).toBeUndefined();
    expect(set.pitches[0]).toMatchObject({ scale: 'the room round you', check: 'Holds for 1000 agents' });
  });

  it('refuses too few or too many, a beat that isn’t there, or a pitch without a metaphor or scale', () => {
    expect(applyPitch([], { beat: 0, pitches: [way('A')] }, 1, 1)).toHaveProperty('error');
    expect(applyPitch([], { beat: 0, pitches: Array.from({ length: STUDIO_LIMITS.maxPitches + 1 }, (_, i) => way(`P${i}`)) }, 1, 1)).toHaveProperty('error');
    expect(applyPitch([], { beat: 3, pitches: [way('A'), way('B')] }, 2, 1)).toHaveProperty('error');
    expect(applyPitch([], { pitches: [way('A'), { ...way('B'), metaphor: ' ' }] }, 0, 1)).toHaveProperty('error');
    expect(applyPitch([], { pitches: [way('A'), { ...way('B'), scale: '' }] }, 0, 1)).toHaveProperty('error');
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
    expect(applyRetime(staged, { id: 'z', speed: 2 }, 9)).toEqual({ error: expect.stringContaining('On the floor: b') });
    expect(applyRetime(staged, { id: 'b', speed: 0.01 }, 9)).toHaveProperty('error');
  });
});

describe('studioPrompt', () => {
  const messages = [
    { from: 'captain' as const, text: 'A video on subagents', at: 1 },
    { from: 'computer' as const, text: 'The premise is up.', at: 2 },
    { from: 'captain' as const, text: 'Make b slower', at: 3 },
  ];

  it('sends a resumed session only what the captain said since its last reply', () => {
    expect(studioPrompt(messages, true, started())).toBe('Make b slower');
  });

  it('recaps the conversation and the video for a session that starts afresh', () => {
    const prompt = studioPrompt(messages, false, started());
    expect(prompt).toContain('Captain: A video on subagents\nYou: The premise is up.');
    expect(prompt).toContain('"premise":"How Claude delegates"');
    expect(prompt.endsWith('The captain: Make b slower')).toBe(true);
  });

  it('recaps what it pitched for a session that starts afresh', () => {
    const prompt = studioPrompt(messages, false, started(), [{ beat: 0, pitches: [{ title: 'Pattern buffer', metaphor: 'Agents wait', scale: 'the room' }], at: 1 }]);
    expect(prompt).toContain('What you\'ve pitched (numbered from 1 per beat): [{"beat":0,"pitches":[{"title":"Pattern buffer"');
  });
});

describe('StudioComputer', () => {
  const setup = (turn: (req: StudioTurn) => Promise<string>) => {
    const store = { studio: freshStudio(), settings: {}, save: () => undefined } as unknown as Store;
    const sent: ServerEvent[] = [];
    const hub = { send: (e: ServerEvent) => sent.push(e) } as unknown as Hub;
    const officer: StudioOfficer = { turn: async (req) => ({ text: await turn(req), sessionId: 's1', costUsd: 0.1, model: req.model ?? 'claude-sonnet-5-5' }) };
    return { store, sent, computer: new StudioComputer(store, hub, officer, 50) };
  };
  const settled = (store: Store) => new Promise<void>((resolve) => {
    const check = () => (store.studio.status === 'thinking' ? setTimeout(check, 5) : resolve());
    check();
  });

  it('builds the video with its tools on a turn, and replies', async () => {
    const { store, computer, sent } = setup(async (req) => {
      req.tools.video({ premise: 'Subagents' });
      return 'It’s up.';
    });
    computer.say('A video on subagents');
    await settled(store);
    expect(store.studio.video?.premise).toBe('Subagents');
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
    expect(heard[0]).toContain('failed in the room: kit.boxx is not a function');
    expect(heard[1]).toContain('no one\'s in the studio');
    expect(store.studio.takes.find((t) => t.id === 'a')?.error).toBe('kit.boxx is not a function');
  });

  it('hands the computer the room’s contact sheet of a take that ran, and shows its pitches to the captain', async () => {
    let staged: Staged | undefined;
    let pitched = '';
    const { store, computer } = setup(async (req) => {
      req.tools.video({ premise: 'Workflows', beats: [{ title: 'Fan out' }] });
      pitched = req.tools.pitch({ beat: 0, pitches: [{ title: 'Pattern buffer', metaphor: 'Agents wait in the buffer', scale: 'the room' }, { title: 'Tactical table', metaphor: 'Ships on a table', scale: 'tabletop' }] });
      const take = req.tools.take({ id: 'a', label: 'A', seconds: 5, script: 'function render(t) {}' });
      setTimeout(() => computer.report('a', 1, undefined, 'data:image/jpeg;base64,/9j/4AAQ'), 10);
      staged = await take;
      return 'Pitched';
    });
    computer.say('Workflows');
    await settled(store);
    expect(pitched).toContain('numbered 1 to 2');
    expect(store.studio.pitches?.[0].pitches.map((p) => p.title)).toEqual(['Pattern buffer', 'Tactical table']);
    expect(staged).toMatchObject({ sheet: '/9j/4AAQ' });
    expect(staged?.text).toContain('contact sheet');
  });

  it('runs its turns at the model and effort picked, keeps them for the next video, and says what it ran on', async () => {
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
    computer.newVideo();
    expect(computer.current()).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', messages: [] });
    computer.tune('', undefined);
    expect(computer.current().model).toBeUndefined();
  });

  it('starts a new video afresh, dropping a turn still under way', async () => {
    let finish!: () => void;
    const { store, computer } = setup(() => new Promise((resolve) => (finish = () => resolve('late'))));
    computer.say('First idea');
    computer.newVideo();
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.studio.messages).toEqual([]);
    expect(store.studio.status).toBe('waiting');
  });
});
