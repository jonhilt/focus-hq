// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TermLine } from '../../plugin-api/shared';

const said: string[] = [];
let lines: ((id: string, lines: readonly TermLine[]) => void) | undefined;
const callPlugin = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const askResume = vi.fn<(...args: unknown[]) => Promise<unknown>>();

// the browser's plugin API brings every plugin's client part with it: asking needs the office's word, a voice and a mic
vi.mock('../../plugin-api/client', async () => ({
  ...(await import('../../plugin-api/shared')),
  callPlugin: (...args: unknown[]) => callPlugin(...args),
  askResume: (...args: unknown[]) => askResume(...args),
  office: {
    agent: () => ({ name: 'Lt. Adeyemi' }),
    onLines: (fn: typeof lines) => {
      lines = fn;
      return () => (lines = undefined);
    },
  },
  CrewSpeaker: class {
    say(text: string) {
      said.push(text);
    }
    hush() {}
  },
  micPerRecording: {},
  // the field it dictates into, as the real one wraps it
  withMic: (_ui: unknown, field: HTMLElement) => field,
  h: (tag: string, props: Record<string, unknown> | null, ...children: (Node | string | null)[]) => {
    const el = document.createElement(tag);
    if (props?.class) el.className = String(props.class);
    if (typeof props?.onclick === 'function') el.addEventListener('click', props.onclick as EventListener);
    for (const child of children) if (child !== null) el.append(child);
    return el;
  },
}));

const { BriefingAsk } = await import('./ask');

const narrator = { pause: vi.fn(), spot: { beat: 1, title: 'The outage' } };
const ui = { error: vi.fn() };

/** Asking the lead about their briefing, typed: `voiced` with the briefing's Voice on. */
function asking(voiced = false) {
  localStorage.setItem('focus.explainer.voice', voiced ? '1' : '0');
  const ask = new BriefingAsk(ui as never, 'lead1', { id: 'save-journey', title: 'How a save travels' }, narrator as never);
  // typed, and sent with Enter
  const type = async (question: string) => {
    const input = ask.el.querySelector('input');
    if (!input) throw new Error('No field to ask in');
    input.value = question;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(callPlugin).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
  };
  return { ask, type, text: () => ask.el.textContent ?? '' };
}

describe('asking a lead about their briefing', () => {
  beforeEach(() => {
    said.length = 0;
    callPlugin.mockReset();
    askResume.mockReset();
    narrator.pause.mockReset();
  });

  it('sends the question with the beat you were on, pausing the briefing', async () => {
    callPlugin.mockResolvedValue({ by: 'lead' });
    const { type, text } = asking();
    await type('Why wait?');
    expect(callPlugin).toHaveBeenCalledWith('briefings', '/ask', { lead: 'lead1', briefing: 'save-journey', spot: { beat: 1, title: 'The outage' }, question: 'Why wait?', how: undefined });
    expect(narrator.pause).toHaveBeenCalled();
    expect(text()).toContain('Waiting for Lt. Adeyemi…');
  });

  it('shows what the lead writes back, and says it with the Voice on', async () => {
    callPlugin.mockResolvedValue({ by: 'lead' });
    const { type, text } = asking(true);
    await type('Why wait?');
    lines?.('someone-else', [{ t: 0, kind: 'text', text: '⏺ Not for you.' }]);
    lines?.('lead1', [{ t: 0, kind: 'text', text: '⏺ Because the database is down.' }]);
    expect(text()).toContain('Because the database is down.');
    expect(text()).not.toContain('Not for you.');
    expect(text()).toMatch(/First reply after \d/);
    expect(said).toEqual(['Because the database is down.']);
  });

  it('shows the quick answer while the lead is busy', async () => {
    callPlugin.mockResolvedValue({ by: 'quick', text: 'It retries.' });
    const { type, text } = asking(true);
    await type('Why wait?');
    expect(text()).toContain('Quick answer: It retries.');
    expect(said).toEqual(['It retries.']);
  });

  it('asks the captain first when it would cost on the key, and sends it their way', async () => {
    callPlugin.mockResolvedValueOnce({ costly: { usd: 2 } }).mockResolvedValueOnce({ by: 'lead' });
    askResume.mockResolvedValue('key');
    const { type } = asking();
    await type('Why wait?');
    await vi.waitFor(() => expect(callPlugin).toHaveBeenCalledTimes(2));
    expect(callPlugin.mock.calls[1][2]).toMatchObject({ how: 'key' });
  });

  it('sends nothing when the captain would rather not pay for it', async () => {
    callPlugin.mockResolvedValue({ costly: { usd: 2 } });
    askResume.mockResolvedValue(undefined);
    const { type, text } = asking();
    await type('Why wait?');
    await vi.waitFor(() => expect(text()).toContain('Not sent.'));
    expect(callPlugin).toHaveBeenCalledTimes(1);
  });

  it('says why when the question couldn’t go', async () => {
    callPlugin.mockRejectedValue(new Error('Nothing called save-journey is on the screen'));
    const { type, text } = asking();
    await type('Why wait?');
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith('Nothing called save-journey is on the screen'));
    expect(text()).toContain('Not sent.');
  });

  it('asks nothing for a blank question', () => {
    const { ask } = asking();
    ask.el.querySelector('button')?.click();
    expect(callPlugin).not.toHaveBeenCalled();
    ask.end();
  });
});
