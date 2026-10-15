import { afterEach, describe, expect, it, vi } from 'vitest';
import { office, until } from '../../server/agents/fakeOffice';
import numberOnePlugin from './server';
import { freshChat, NUMBER_ONE, type NumberOneChat, type NumberOneState } from './shared';

/** The office with Number One switched on: its routes, and its state as the browser has it. */
function aboard(opts: { demo?: boolean; saved?: NumberOneChat } = {}) {
  const o = office();
  if (opts.saved) o.store.plugins[NUMBER_ONE] = { chat: opts.saved };
  o.agents.startPlugins([numberOnePlugin], { demo: opts.demo ?? false, ownRepo: () => undefined, shipStatus: () => Promise.resolve({ projects: [] }) });
  const route = (path: string) => {
    const found = o.agents.plugins.routes().find((r) => r.route.path === path)?.route;
    if (!found) throw new Error(`no route ${path}`);
    return (body: Record<string, unknown> = {}) => found.handle({ body, query: {} });
  };
  const state = () => o.agents.plugins.stateOf(NUMBER_ONE) as NumberOneState;
  return { ...o, route, state };
}

afterEach(() => vi.unstubAllEnvs());

describe('the number-one plugin', () => {
  it('answers on its routes, and keeps the chat in its slot once there’s one, and the call beside it, unsaved', () => {
    vi.stubEnv('FOCUS_DEMO_SPEED', '1000');
    const o = aboard({ demo: true });
    expect(o.agents.plugins.routes().map((r) => `${r.route.method} ${r.route.path}`)).toEqual(['post /say', 'post /new', 'post /call', 'post /hang-up']);
    // nothing's saved until the captain says something, so an office that never talks to Number One has nothing waiting
    expect(o.store.plugins).toEqual({});
    expect(o.state()).toEqual({ activity: '', call: { call: null } });
    o.route('/say')({ text: 'Hello' });
    expect(Object.keys(o.store.plugins[NUMBER_ONE] as object)).toEqual(['chat']);
    expect(o.state()).toMatchObject({ chat: { status: 'thinking' }, call: { call: null } });
  });

  it('ends a turn that was under way when the office shut down, keeping the session', () => {
    const saved: NumberOneChat = { ...freshChat(), status: 'thinking', activity: 'Reading', messages: [{ from: 'manager', text: 'Hi', at: 0 }], sessionId: 's1' };
    const o = aboard({ saved });
    expect(o.state().chat).toMatchObject({ status: 'failed', activity: 'Interrupted', sessionId: 's1' });
  });

  it('chats with the demo’s Number One, and starts afresh on /new', async () => {
    vi.stubEnv('FOCUS_DEMO_SPEED', '1000');
    const o = aboard({ demo: true });
    expect(o.route('/say')({ text: 'What’s going on?' })).toMatchObject({ status: 'thinking' });
    expect(() => o.route('/say')({ text: 'Hello?' })).toThrow('Cmdr. Adair is still thinking');
    await until(() => o.state().chat.status === 'waiting');
    expect(o.state().chat.messages.map((m) => m.from)).toEqual(['manager', 'number-one']);
    expect(o.route('/new')()).toMatchObject({ messages: [] });
  });

  it('says why it can’t take a call without the keys, and takes the demo’s', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const live = aboard();
    expect(live.state().call.missing).toMatch(/Calls need OPENAI_API_KEY and TYPESAFE_API_KEY/);
    expect(() => live.route('/call')({})).toThrow('Send the WebRTC offer');
    await expect(live.route('/call')({ sdp: 'v=0' })).rejects.toThrow(/Calls need/);

    const demo = aboard({ demo: true });
    const session = await (demo.route('/call')({ sdp: 'demo' }) as Promise<{ id: string }>);
    expect(demo.state().call.call).toMatchObject({ id: session.id, step: 'listening' });
    demo.route('/hang-up')({ id: session.id });
    expect(demo.state().call.call?.step).toBe('ended');
  });
});
