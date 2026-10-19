// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogLine } from './shared';

// the browser's plugin API brings every plugin's client part with it: the panel's kit stands in for itself here
type Child = Node | string | null | undefined | false;
const add = (el: Element, children: Child[]) => el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
const calls: { path: string; body: unknown }[] = [];
let answer: () => Promise<LogLine[]> = () => Promise.resolve([]);
vi.mock('../../plugin-api/client', async () => ({
  ...(await import('../../plugin-api/shared')),
  LCARS: { peach: '#f90', periwinkle: '#99f', lilac: '#c9f', sky: '#9cf' },
  office: {
    agents: [{ name: 'Lt. Reyes', permission: { tool: 'Bash' } }, { name: 'Ens. Park', status: 'error' }, { name: 'Ens. Idle', status: 'idle' }],
    projects: [{ id: 'p', name: 'Shop' }, { id: 'q', name: 'Hidden', hidden: true }],
  },
  callPlugin: (_id: string, path: string, body: unknown) => {
    calls.push({ path, body });
    return answer();
  },
  h: (tag: string, props: { class?: string; style?: string; value?: string } | null, ...children: Child[]) => {
    const el = document.createElement(tag);
    if (props?.class) el.className = props.class;
    if (props?.style) el.setAttribute('style', props.style);
    if (props?.value !== undefined) el.setAttribute('value', props.value);
    add(el, children);
    return el;
  },
  fill: (el: Element, ...children: Child[]) => {
    el.replaceChildren();
    add(el, children);
  },
}));

const { openCaptainsLogPanel } = await import('./panel');

const DAY = 86_400_000;
const now = Date.now();
const line = (over: Partial<LogLine>): LogLine => ({ t: now - 60_000, who: 'Lt. Oyelaran', source: 'slice', kind: 'shipped', tag: 'Shipped', tone: 'ok', text: 'Shipped slice 1', projectId: 'p', goal: 'Saved items', ...over });
const LINES = [
  line({}),
  line({ t: now - 50_000, source: 'review', kind: 'testing', who: 'Lt. Quintero', tag: 'QA', text: 'Testing web#4', goal: undefined }),
  line({ t: now - 40_000, source: 'ledger', kind: 'merged', who: 'Office', tag: 'Merged', text: 'web #4', projectId: 'q' }),
];

/** Opens the panel: its body, as the panels have it. */
function opening(): () => HTMLElement | undefined {
  let body: HTMLElement | undefined;
  openCaptainsLogPanel({ panels: { open: (p: { body: HTMLElement }) => (body = p.body) } } as never);
  return () => body;
}

/** Opens the panel and waits for its lines. */
async function open(): Promise<HTMLElement> {
  const body = opening();
  await vi.waitFor(() => expect(body()?.querySelectorAll('.captains-log-row').length).toBeGreaterThan(0));
  const opened = body();
  if (!opened) throw new Error('no panel');
  return opened;
}

const rows = (body: HTMLElement) => [...body.querySelectorAll('.captains-log-row')].map((r) => r.querySelector('strong')?.textContent);
const button = (body: HTMLElement, text: string) => [...body.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text));
const pick = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new Event('change'));
};

describe('the captain’s log panel', () => {
  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    answer = () => Promise.resolve(LINES);
  });

  it('reads the last day the first time, newest first, and says what happened and who’s waiting', async () => {
    const body = await open();
    expect(calls[0].path).toBe('/log');
    expect((calls[0].body as { since: number }).since).toBeLessThanOrEqual(now - DAY + 1000);
    expect(body.querySelector('.captains-log-away p')?.textContent).toBe('1 slice shipped · 1 merged');
    expect(body.querySelector('.captains-log-waiting')?.textContent).toBe('Waiting on you: Lt. Reyes (hand up), Ens. Park (hit a problem)');
    expect(rows(body)).toEqual(['Office', 'Lt. Quintero', 'Lt. Oyelaran']);
    // what's new since you last looked is lit
    expect(body.querySelector('.captains-log-row.new')).not.toBeNull();
    // there's no "since you last looked" until you have
    expect(button(body, 'Since you last looked')).toBeUndefined();
  });

  it('filters by where a line came from, the room, the goal and who', async () => {
    const body = await open();
    button(body, 'QA')?.click();
    expect(rows(body)).toEqual(['Office', 'Lt. Oyelaran']);
    button(body, 'QA')?.click();
    expect(rows(body)).toHaveLength(3);
    const [room, goal, who] = [...body.querySelectorAll('select')];
    // a hidden room isn't offered
    expect([...room.options].map((o) => o.textContent)).toEqual(['Every room', 'Shop']);
    pick(room, 'p');
    expect(rows(body)).toEqual(['Lt. Quintero', 'Lt. Oyelaran']);
    pick(goal, 'Saved items');
    expect(rows(body)).toEqual(['Lt. Oyelaran']);
    pick(who, 'Lt. Quintero');
    expect(body.querySelector('.ledger-log')?.textContent).toBe('Nothing in the log for that window and those filters.');
  });

  it('reads another window, and from since you last looked once you have', async () => {
    await open();
    const body = await open();
    button(body, 'Since you last looked')?.click();
    button(body, 'Last week')?.click();
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect((calls[3].body as { since: number }).since).toBeLessThan(now - 6 * DAY);
  });

  it('says why when it can’t read the log, and that nothing happened when nothing did', async () => {
    answer = () => Promise.reject(new Error('Not switched on'));
    const failed = opening();
    await vi.waitFor(() => expect(failed()?.querySelector('.ledger-log')?.textContent).toBe('Couldn’t read the log: Not switched on'));
    answer = () => Promise.resolve([]);
    const quiet = opening();
    await vi.waitFor(() => expect(quiet()?.querySelector('.captains-log-away p')?.textContent).toBe('Nothing worth a line.'));
  });

  it('shows only the newest lines, and says so', async () => {
    answer = () => Promise.resolve(Array.from({ length: 501 }, (_, i) => line({ t: now - 2 * DAY + i })));
    const body = await open();
    expect(body.querySelectorAll('.captains-log-row')).toHaveLength(500);
    expect(body.textContent).toContain('The newest 500 of 501');
  });
});
