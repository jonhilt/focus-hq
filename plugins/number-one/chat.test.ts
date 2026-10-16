import { describe, expect, it, vi } from 'vitest';
import { asNumberOneReply, NumberOne, type NumberOneOfficer, numberOnePrompt, numberOneReplySchema, numberOneSystemPrompt } from './chat';
import { chatAfterRestart, chatNow, freshChat, type NumberOneChat } from './shared';
import { type PluginState, type Project, type ShipStatus } from '../../plugin-api/server';

const project = { id: 'p1', name: 'Shop', repos: ['acme/shop', 'acme/shop-api'] } as Project;
describe('numberOneSystemPrompt', () => {
  const prompt = numberOneSystemPrompt({ projects: [project], workspaces: '/ws' });

  it('lists each project’s id and where its repos are checked out', () => {
    expect(prompt).toContain('Shop, id `p1`: `p1/shop/` (acme/shop), `p1/shop-api/` (acme/shop-api)');
  });

  it('keeps worktrees for what an agent has done, not how the code works', () => {
    expect(prompt).toContain('/ws');
    expect(prompt).toMatch(/half-finished work/);
    expect(prompt).toMatch(/never to explain how the code works/);
  });

  it('says Number One never acts, only suggests, and relays a failed checkout', () => {
    expect(prompt).toMatch(/never file, push, edit, start agents, draft issues or talk to the lead/);
    expect(prompt).toMatch(/the checkout failed and for which project/);
  });
});

describe('numberOnePrompt', () => {
  const messages: NumberOneChat['messages'] = [
    { from: 'manager', text: 'What’s going on?', at: 0 },
    { from: 'number-one', text: 'All quiet.', at: 1 },
    { from: 'manager', text: 'How does auth work?', at: 2 },
  ];

  it('sends only the new message when resuming the session', () => {
    expect(numberOnePrompt({ messages, resumeSessionId: 's1' })).toBe('The captain says:\n"""\nHow does auth work?\n"""');
  });

  it('recaps the conversation without a session', () => {
    const prompt = numberOnePrompt({ messages });
    expect(prompt).toContain('Captain: What’s going on?\n\nYou: All quiet.');
    expect(prompt).toMatch(/How does auth work\?\n"""$/);
  });

  it('carries messages left unanswered by a failed turn', () => {
    const prompt = numberOnePrompt({ messages: [...messages, { from: 'manager', text: 'And payments?', at: 3 }], resumeSessionId: 's1' });
    expect(prompt).toContain('How does auth work?\n\nAnd payments?');
  });
});

describe('Number One’s reply', () => {
  it('offers `suggest` only for the projects aboard', () => {
    const schema = numberOneReplySchema(['p1']) as { properties: Record<string, { properties?: Record<string, { enum?: string[] }> }>; required: string[] };
    expect(schema.required).toEqual(['reply', 'spoken']);
    expect(schema.properties.suggest.properties!.projectId.enum).toEqual(['p1']);
    expect(numberOneReplySchema([])).not.toHaveProperty('properties.suggest');
  });

  it('decodes a reply with a suggestion for a real project', () => {
    expect(asNumberOneReply({ reply: ' Yes. ', spoken: 'Yes.', suggest: { projectId: 'p1', idea: ' Add wishlists ' } }, 'fallback', ['p1'])).toEqual({
      text: 'Yes.',
      spoken: 'Yes.',
      suggest: { projectId: 'p1', idea: 'Add wishlists' },
    });
  });

  it('has no suggestion on an ordinary reply, or one for an unknown project', () => {
    expect(asNumberOneReply({ reply: 'Hi', spoken: 'Hi' }, '', ['p1'])).not.toHaveProperty('suggest');
    expect(asNumberOneReply({ reply: 'Hi', spoken: 'Hi', suggest: { projectId: 'nope', idea: 'x' } }, '', ['p1'])).not.toHaveProperty('suggest');
    expect(asNumberOneReply({ reply: 'Hi', spoken: 'Hi', suggest: { projectId: 'p1', idea: ' ' } }, '', ['p1'])).not.toHaveProperty('suggest');
  });

  it('falls back to the session’s text without a structured result', () => {
    expect(asNumberOneReply(undefined, 'Plain text', [])).toEqual({ text: 'Plain text', spoken: undefined });
  });
});

describe('NumberOne', () => {
  const ship: ShipStatus = { projects: [] };

  /** A plugin state slot in memory, counting how often it's set. */
  function slot<S extends object>(start: S): PluginState<S> & { sets: number } {
    let state = start;
    const s = { sets: 0, get: () => state, set: (patch: Partial<S>) => ((state = { ...state, ...patch }), s.sets++) };
    return s;
  }

  function setup(officer: NumberOneOfficer['turn']) {
    const store = { projects: [project] };
    const saved = slot({ chat: freshChat() });
    const live = slot({ activity: '' });
    const turn = vi.fn(officer);
    const numberOne = new NumberOne({ projects: () => store.projects, settings: () => ({ maxConcurrent: 2 }) as never, shipStatus: async () => ship, saved, live }, { turn });
    const settled = () => vi.waitFor(() => expect(numberOne.current().status).not.toBe('thinking'));
    return { store, saved, live, numberOne, turn, settled };
  }

  it('clears what Number One is doing only when there is something to clear, so a message sends one event', async () => {
    const { numberOne, live, settled } = setup(async (_req, activity) => {
      activity('Reading the code');
      return { text: 'Done.', spoken: 'Done.' };
    });
    numberOne.say('Look at p1');
    await settled();
    // the activity, then its clearing as the reply is saved; saying it cleared nothing
    expect(live.sets).toBe(2);
    expect(live.get().activity).toBe('');
  });

  it('answers, keeping the session, and resumes it on the next message', async () => {
    const { numberOne, turn, settled } = setup(async () => ({ text: 'All quiet.', spoken: 'All quiet, Captain.', sessionId: 's1', costUsd: 0.1, suggest: { projectId: 'p1', idea: 'x' } }));
    numberOne.say('What’s going on?');
    await settled();
    expect(numberOne.current().messages.map((m) => m.from)).toEqual(['manager', 'number-one']);
    expect(numberOne.current().messages[1]).toMatchObject({ text: 'All quiet.', spoken: 'All quiet, Captain.', suggest: { projectId: 'p1', idea: 'x' } });
    expect(numberOne.current().sessionId).toBe('s1');
    numberOne.say('And now?');
    await settled();
    expect(turn.mock.calls[0][0].resumeSessionId).toBeUndefined();
    expect(turn.mock.calls[1][0].resumeSessionId).toBe('s1');
    expect(turn.mock.calls[1][0].projects).toEqual([{ id: 'p1', name: 'Shop', repos: ['acme/shop', 'acme/shop-api'] }]);
    expect(numberOne.current().costUsd).toBeCloseTo(0.2);
  });

  it('keeps hidden projects out of the chat', async () => {
    const { store, numberOne, turn, settled } = setup(async () => ({ text: 'Aye.', sessionId: 's1' }));
    store.projects = [project, { id: 'p2', name: 'Secret', repos: ['acme/secret'], hidden: true } as Project];
    numberOne.say('What projects are aboard?');
    await settled();
    expect(turn.mock.calls[0][0].projects.map((p) => p.id)).toEqual(['p1']);
  });

  it('refuses a message while still thinking', () => {
    const { numberOne } = setup(() => new Promise(() => undefined));
    numberOne.say('Hello');
    expect(() => numberOne.say('Hello again')).toThrow(/still thinking/);
  });

  it('starts a new conversation with a clear log and a fresh session, dropping the reply in flight', async () => {
    let answer: (text: string) => void = () => undefined;
    const { numberOne, turn, settled } = setup(async (req) => {
      if (req.messages.at(-1)!.text === 'One') return { text: 'first', sessionId: 's1' };
      return new Promise((resolve) => (answer = (text) => resolve({ text, sessionId: 's2' })));
    });
    numberOne.say('One');
    await settled();
    numberOne.say('Two');
    numberOne.newConversation();
    answer('too late');
    await new Promise((resolve) => setTimeout(resolve));
    expect(numberOne.current().messages).toEqual([]);
    expect(numberOne.current().status).toBe('waiting');
    expect(turn.mock.calls[1][0].signal.aborted).toBe(true);
    numberOne.say('Three');
    expect(turn.mock.calls[2][0].resumeSessionId).toBeUndefined();
  });

  it('keeps the chat usable after a failed turn', async () => {
    let fail = true;
    const { numberOne, settled } = setup(async () => {
      if (fail) throw new Error('Offline');
      return { text: 'Back again', sessionId: 's1' };
    });
    numberOne.say('Hello');
    await settled();
    expect(numberOne.current()).toMatchObject({ status: 'failed', error: 'Offline' });
    fail = false;
    numberOne.say('Hello?');
    await settled();
    expect(numberOne.current()).toMatchObject({ status: 'waiting', error: undefined });
  });

  it('says what Number One is doing as they read, without saving each step', async () => {
    let read: () => void = () => undefined;
    const { numberOne, saved, live, settled } = setup((_req, activity) => new Promise((resolve) => {
      activity('Reading src/cart.ts');
      activity('Reading src/store.ts');
      read = () => resolve({ text: 'Done.', sessionId: 's1' });
    }));
    numberOne.say('How does the cart work?');
    const sets = saved.sets;
    expect(live.get().activity).toBe('Reading src/store.ts');
    expect(chatNow({ ...saved.get(), activity: live.get().activity, call: { call: null } })?.activity).toBe('Reading src/store.ts');
    read();
    await settled();
    expect(saved.sets).toBe(sets + 1);
    expect(live.get().activity).toBe('');
    expect(numberOne.current().activity).toBe('Waiting for you');
  });

  it('ends a turn interrupted by a restart, keeping the session for the next message', () => {
    const saved = { status: 'thinking' as const, activity: 'Reading', messages: [{ from: 'manager' as const, text: 'Hi', at: 0 }], updatedAt: 0, costUsd: 0, sessionId: 's1' };
    expect(chatAfterRestart(saved)).toMatchObject({ status: 'failed', sessionId: 's1', messages: saved.messages, error: expect.stringMatching(/Interrupted/) });
    const waiting = { ...saved, status: 'waiting' as const };
    expect(chatAfterRestart(waiting)).toBe(waiting);
  });
});

describe('chatNow', () => {
  const chat = (patch: Partial<NumberOneChat>): NumberOneChat => ({ ...freshChat(), ...patch });

  it('says what Number One is doing this moment only while they think', () => {
    expect(chatNow({ chat: chat({ status: 'thinking', activity: 'Thinking it over' }), activity: 'Reading a file' })?.activity).toBe('Reading a file');
    expect(chatNow({ chat: chat({ status: 'thinking', activity: 'Thinking it over' }), activity: '' })?.activity).toBe('Thinking it over');
    expect(chatNow({ chat: chat({ status: 'waiting', activity: 'Waiting for you' }), activity: 'Reading a file' })?.activity).toBe('Waiting for you');
  });

  it('has no chat before the plugin’s state arrives', () => {
    expect(chatNow(undefined)).toBeNull();
    expect(chatNow({ activity: '' })).toBeNull();
  });
});
