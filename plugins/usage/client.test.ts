// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Usage } from './shared';

let usage: Usage | undefined;
const agents = [
  { name: 'Ens. Park', costUsd: 0.5, onKey: true },
  { name: 'Lt. Okoro', costUsd: 2.25 },
  { name: 'Cmdr. Vale', costUsd: 0, cloud: true },
];

// the browser's plugin API brings every plugin's client part with it: the readout needs its state, the agents aboard,
// the UI kit and the LCARS kit
vi.mock('../../plugin-api/client', async () => ({
  ...(await import('../../plugin-api/shared')),
  pluginState: () => usage,
  office: { get agents() {
    return agents;
  } },
  timeAgo: () => '2 min ago',
  fitText: (_ctx: unknown, text: string) => text,
  LCARS: { gold: 'gold', sky: 'sky', red: 'red', peach: 'peach', lilac: 'lilac' },
  LCARS_FONT: 'sans-serif',
  h: (tag: string, props: Record<string, unknown> | null, ...children: (Node | string | null | (Node | string | null)[])[]) => {
    const el = document.createElement(tag);
    if (props?.class) el.className = String(props.class);
    if (props?.title) el.title = String(props.title);
    if (props?.style) el.setAttribute('style', String(props.style));
    for (const child of children.flat()) if (child !== null) el.append(child);
    return el;
  },
}));

const { default: plugin } = await import('./client');

const hour = 60 * 60_000;
const reading = (over: Partial<Usage> = {}): Usage => ({
  plan: {
    at: Date.now(),
    plan: 'max',
    windows: [{ label: 'session', percent: 80, resetsAt: Date.now() + hour }, { label: 'week', percent: 27 }],
    extra: { enabled: true, used: 12.5, limit: 50, currency: 'GBP', percent: 25 },
  },
  signIn: 'fallback',
  onKey: false,
  keySpentUsd: 0,
  keyBudgetUsd: 20,
  ...over,
});

/** A canvas that writes down the text drawn on it. */
function canvas() {
  const said: string[] = [];
  const ctx = new Proxy({ fillText: (text: string) => void said.push(text), measureText: () => ({ width: 10 }) }, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
    set: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, said };
}

const ui = { showOnMsd: vi.fn() };

beforeEach(() => {
  usage = undefined;
  ui.showOnMsd.mockClear();
});

describe('the usage plugin in the browser', () => {
  it('puts each limit on the HUD, gold once one is getting there, and nothing before there’s a plan to read', () => {
    expect(plugin.hud?.()).toBeNull();
    usage = reading();
    expect(plugin.hud?.()).toEqual({ text: '◔ session 80% · week 27%', tone: 'warn', title: 'Your Claude plan’s usage' });
    usage = reading({ plan: { at: 0, windows: [{ label: 'session', percent: 10 }] } });
    expect(plugin.hud?.()).toEqual({ text: '◔ session 10%', title: 'Your Claude plan’s usage' });
  });

  it('opens the engineering overview with a bar per limit, how the office signs in, and who signs in with what', () => {
    usage = reading();
    const top = plugin.engineering?.top?.(ui as never);
    const text = top?.textContent ?? '';
    expect(text).toContain('Plan usage · Max plan · read 2 min ago');
    expect(text).toContain('extra usage');
    expect(text).toContain('Your Claude plan, then your API key (up to $20) when it runs out');
    expect([...(top?.querySelectorAll('.usage-row') ?? [])].map((r) => r.className)).toEqual(['usage-row warn', 'usage-row ok', 'usage-row ok']);
    // the costliest session first, with what each signs in with
    expect([...(top?.querySelectorAll('td') ?? [])].map((td) => td.textContent)).toEqual(['Lt. Okoro', 'plan', '~$2.25', 'Ens. Park', '🔑 key', '~$0.50', 'Cmdr. Vale', '☁ cloud', '–']);
    top?.querySelector('button')?.click();
    expect(ui.showOnMsd).toHaveBeenCalledWith({ plugin: 'usage' });
  });

  it('says why there are no bars, and that the last reading failed while it keeps it', () => {
    usage = reading({ plan: null, signIn: 'key' });
    const top = plugin.engineering?.top?.(ui as never);
    expect(top?.textContent).toContain('Agents use your API key: no plan limits apply');
    expect((top?.querySelector('button') as HTMLButtonElement | null)?.disabled).toBe(true);
    usage = reading({ error: 'timed out' });
    expect(plugin.engineering?.top?.(ui as never)?.textContent).toContain('Last reading failed: timed out');
  });

  it('draws its gauges on the MSD', () => {
    usage = reading({ onKey: true, keySpentUsd: 3.2 });
    const { ctx, said } = canvas();
    plugin.msd?.(ctx, { x: 0, y: 0, w: 600, h: 400 });
    expect(said[0]).toBe('PLAN USAGE · MAX PLAN');
    expect(said).toContain('SESSION');
    expect(said).toContain('27%');
    expect(said.at(-1)).toBe('On your API key while the plan’s limit is reached: $3.20 of $20 spent');
  });
});
