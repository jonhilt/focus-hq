import { describe, expect, it } from 'vitest';
import type { ServerEvent, StudioTake, StudioVideo } from '../../shared/types';
import type { Hub } from '../hub';
import { freshStudio, type Store } from '../store';
import { applyTake, applyVideo, STUDIO_LIMITS, studioPrompt, type TakeInput, videoReply } from './studio';
import { StudioComputer, type StudioOfficer, type StudioTurn } from './studioComputer';

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

  it('keeps only the newest takes on the floor', () => {
    let takes: StudioTake[] = [];
    for (let i = 0; i < STUDIO_LIMITS.takes + 2; i++) takes = ok(applyTake(takes, take({ id: `t${i}` }), 0, i));
    expect(takes.map((t) => t.id)).toEqual(['t2', 't3', 't4', 't5', 't6', 't7']);
  });

  it('refuses a script that doesn’t parse, a bad id, a beat that isn’t there, or a length out of range', () => {
    expect(applyTake([], take({ script: 'function render(t) {' }), 0, 1)).toEqual({ error: expect.stringContaining('doesn\'t parse') });
    expect(applyTake([], take({ id: 'Take One' }), 0, 1)).toHaveProperty('error');
    expect(applyTake([], take({ beat: 2 }), 2, 1)).toEqual({ error: expect.stringContaining('no beat 2') });
    expect(applyTake([], take({ seconds: 0.5 }), 0, 1)).toHaveProperty('error');
    expect(ok(applyTake([], take({ beat: 1 }), 2, 1))[0].beat).toBe(1);
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
      heard.push(await staged);
      heard.push(await req.tools.take({ id: 'b', label: 'B', seconds: 5, script: 'function render(t) {}' }));
      return 'done';
    });
    computer.say('Show me');
    await settled(store);
    expect(heard[0]).toContain('failed in the room: kit.boxx is not a function');
    expect(heard[1]).toContain('no one\'s in the studio');
    expect(store.studio.takes.find((t) => t.id === 'a')?.error).toBe('kit.boxx is not a function');
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
