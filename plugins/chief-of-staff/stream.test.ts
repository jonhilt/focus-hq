// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// Comms as the captain uses it (README.md#the-watch): an empty table with nobody at the conn, a berth pressed (or its
// number) takes the conn and opens the goal's sheet with its decision on it, another goal's card is a count on its
// berth, a hail drops over the sheet until it's put on screen and stood by, the Muster chip (or M) stands down and the
// muster comes up, and the lead's name (or T) slides in the panel to talk to them.
const fake = vi.hoisted((): { threads: Record<string, ThreadEntry[]>; conn?: string; stoodBy?: string[]; line?: unknown; lineActivity?: string; said: unknown[]; state?: () => void; open: unknown[]; waiting: unknown[]; preview?: unknown } => ({ threads: {}, open: [], waiting: [], said: [] }));
const agent = (id: string): Agent => ({
  id, name: `Lt. ${id}`, projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: {
    title: `Goal ${id}`, repos: [], slice: 2, prs: [], note: { done: 'Saved items survive a reload', learned: [], next: ['Sharing'] },
    waypoints: [{ slice: 1, title: 'Quick wins', startedAt: 1 }, { slice: 2, heading: 'Saved list', startedAt: 2 }],
    artifacts: [{ id: 'fees', title: 'Fee table', at: 5, slice: 1 }, { id: 'flow', title: 'Flow', at: 6, slice: 2 }],
  },
});
const leads = [agent('a'), agent('b')];
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], project: () => ({ id: 'p', name: 'Shop', color: '#fff' }), leadsIn: () => leads, preview: () => fake.preview, reviews: new Map(), lines: () => [], shownPrs: () => [], agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: () => () => undefined, onAgent: () => () => undefined },
    goalTags: () => [],
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac', sky: 'sky', peach: 'peach' },
    markdownHtml: (text: string) => text,
    busy: async (_b: HTMLButtonElement, run: () => Promise<unknown>) => { await run(); },
    fill: (el: HTMLElement, ...children: (Node | null)[]) => el.replaceChildren(...children.flatMap((c) => (c ? [c] : []))),
    messageAgent: vi.fn(() => Promise.resolve()),
    // the watch as Focus keeps it: taking the conn is kept at once, and heard as the plugin's state changing
    pluginState: () => ({ autoSend: {}, conn: fake.conn, stoodBy: fake.stoodBy, line: fake.line, lineActivity: fake.lineActivity }),
    confirmDialog: vi.fn(() => Promise.resolve(true)),
    onPluginState: (_id: string, f: () => void) => { fake.state = f; return () => undefined; },
    callPlugin: vi.fn((_p: string, path: string, body: { lead?: string | null; key?: string; force?: boolean }) => {
      if (path === '/conn') fake.conn = body.lead ?? undefined;
      if (path.startsWith('/line/')) fake.said.push({ path, ...body });
      // closing a goal with work to lose warns first, until it's forced
      if (path === '/line/close' && !body.force) return Promise.resolve({ warn: ['1 open pull request'] });
      if (path === '/stand-by' && body.key) fake.stoodBy = [...(fake.stoodBy ?? []), body.key];
      fake.state?.();
      return Promise.resolve({});
    }),
    readPlugin: (_p: string, path: string) => Promise.resolve({ entries: fake.threads[decodeURIComponent(path.split('/').pop() ?? '')] ?? [] }),
  };
});
vi.mock('./here', () => ({ waitingNow: () => fake.waiting }));
vi.mock('./inboxApi', () => ({ inbox: { view: () => Promise.resolve({ open: fake.open, landed: [], decided: [] }), decide: vi.fn(() => Promise.resolve({ ok: true })) } }));
const { openStream } = await import('./stream');
const { messageAgent } = await import('../../plugin-api/client');
const { inbox } = await import('./inboxApi');
const { CHIEF_OF_STAFF } = await import('./shared');

let cleanups: (() => void)[] = [];
const ui = {
  panels: { open: vi.fn((opts: { body: HTMLElement }) => document.body.replaceChildren(opts.body)), own: (c: () => void) => cleanups.push(c), backTo: vi.fn() },
  openAgent: vi.fn(), goToAgent: vi.fn(), error: vi.fn(),
};
const settle = () => new Promise((r) => setTimeout(r, 50));
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  fake.conn = undefined;
  fake.stoodBy = undefined;
  fake.open = [];
  fake.waiting = [];
  fake.threads = {};
  fake.preview = undefined;
  fake.line = undefined;
  fake.lineActivity = undefined;
  fake.said = [];
});
const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const parts = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-part=${name}]`)];
const berth = (goal: string) => parts('berth').find((r) => r.textContent?.includes(goal));
const shown = (name: string) => !part(name)?.classList.contains('tw:hidden');
const press = (code: string, key = '') => window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
const open = async () => {
  localStorage.clear();
  openStream(ui as never);
  await settle();
};

// a card of goal b's lead waits on the captain, and an interrupt from goal a's that can't be undone
const card = { id: 'turn:b:1000', kind: 'turn', projectId: 'p', agentId: 'b', who: 'Lt. b', goal: 'Goal b', what: 'Filters first?', lane: 'needs-you', cos: { route: 2, asks: [{ ask: 'Filters first?' }], ask: 'Filters first?', why: 'A pick.', says: 'Filters or sorting next.', message: '' } };
const hail = { id: 'turn:a:1000', kind: 'turn', projectId: 'p', agentId: 'a', who: 'Lt. a', goal: 'Goal a', what: 'Read production?', lane: 'needs-you', cos: { route: 3, check: 'irreversible', asks: [{ ask: 'Read production?' }], ask: 'Read production?', why: '', message: 'One read-only query.' } };

describe('the bridge with nobody at the conn', () => {
  it('is an empty table, every goal in its berth with what waits on it counted, the muster chip counting it all', async () => {
    fake.open = [card];
    await open();
    expect(shown('empty')).toBe(true);
    expect(shown('sheet')).toBe(false);
    expect(document.body.textContent).toContain('No watch');
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.textContent).toBe('1');
    expect(part('chip')?.textContent).toBe('Muster1');
  });

  it('brings the muster up from the chip, by what each unblocks, and puts it away again', async () => {
    fake.open = [card];
    await open();
    part('chip')?.click();
    expect(shown('muster')).toBe(true);
    expect(part('row')?.textContent).toContain('Filters first?');
    expect(part('row')?.textContent).toContain('b idle until you answer');
    press('KeyM');
    expect(shown('muster')).toBe(false);
  });
});

describe('taking the conn', () => {
  it('opens the goal’s sheet: its head, no orders, the other berths dimmed with their counts', async () => {
    fake.open = [card];
    await open();
    berth('Goal a')?.click();
    await settle();
    expect(fake.conn).toBe('a');
    expect(shown('sheet')).toBe(true);
    expect(shown('empty')).toBe(false);
    expect(document.body.textContent).toContain('On watch · Goal a');
    expect(part('sheet')?.textContent).not.toContain('Done: Saved items survive a reload');
    expect(berth('Goal b')?.className).toContain('tw:opacity-50');
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.textContent).toBe('1');
  });

  it('counts the goal’s exhibits in its head, lists them in a panel beside the sheet by slice or newest, and opens one on the sheet', async () => {
    await open();
    berth('Goal a')?.click();
    await settle();
    expect(part('exhibits')?.textContent).toBe('Exhibits · 2');
    part('exhibits')?.click();
    expect(shown('gallery')).toBe(true);
    expect(parts('group').map((g) => g.firstElementChild?.textContent)).toEqual(['2 · Saved list · now', '1 · Quick wins']);
    part('by-newest')?.click();
    expect(parts('card').map((c) => c.dataset.id)).toEqual(['flow', 'fees']);
    parts('card')[1]?.click();
    expect(part('exhibit')?.textContent).toContain('Exhibit · Fee table · slice 1');
    expect(part('exhibit')?.querySelector('iframe')?.getAttribute('src')).toContain('fees.html');
    // talking puts the panel away: one panel beside the sheet at a time
    part('who')?.click();
    expect(shown('gallery')).toBe(false);
    press('KeyE');
    expect(shown('gallery')).toBe(true);
    press('Escape', 'Escape');
    expect(part('exhibit')).toBeNull();
    press('Escape', 'Escape');
    expect(shown('gallery')).toBe(false);
  });

  it('links each system their preview runs, named as the preview names it', async () => {
    const work = leads[0]?.lead;
    if (!work) throw new Error('no lead');
    work.prs = [{ repo: 'acme/shop', number: 7, url: '' }];
    fake.preview = { repo: 'acme/shop', number: 7, status: 'running', links: [{ name: 'web', url: 'http://localhost:5173/', health: 'up' }, { name: 'admin', url: 'http://localhost:5174/' }, { url: 'http://localhost:4000/' }] };
    fake.conn = 'a';
    await open();
    work.prs = [];
    expect([...(part('preview')?.querySelectorAll('a') ?? [])].map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['web', 'http://localhost:5173/'], ['admin', 'http://localhost:5174/'], ['localhost:4000', 'http://localhost:4000/'],
    ]);
  });

  it('views a lead’s goal in its room: the one at the conn from its head or B, any other from its berth', async () => {
    fake.conn = 'a';
    await open();
    part('beam-here')?.click();
    expect(ui.goToAgent).toHaveBeenLastCalledWith('a');
    press('KeyB');
    expect(ui.goToAgent).toHaveBeenLastCalledWith('a');
    berth('Goal b')?.parentElement?.querySelector<HTMLElement>('[data-part=beam]')?.click();
    expect(ui.goToAgent).toHaveBeenLastCalledWith('b');
    expect(fake.conn).toBe('a');
  });

  it('takes it by a berth’s number too', async () => {
    await open();
    press('Digit2');
    await settle();
    expect(fake.conn).toBe('b');
  });

  it('puts the goal’s own decision on its sheet, with the chief of staff’s reading of it', async () => {
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    expect(part('decision')?.textContent).toContain('Decision · from Lt. b');
    expect(part('decision')?.textContent).toContain('Filters or sorting next.');
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.className).toContain('tw:opacity-0');
  });

  it('answers it by pressing a reply, the chief of staff’s pick first and marked, each with the words it sends, then Discuss and Got it', async () => {
    const work = leads[1]?.lead;
    if (!work) throw new Error('no lead');
    work.marks = { [CHIEF_OF_STAFF]: { at: 1000, judged: { route: 2, ask: 'Filters first?', why: 'A pick.', message: '', replies: [{ label: 'Filters', text: 'Filters first.' }, { label: 'Sorting', text: 'Sorting first.' }] } } };
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    delete work.marks;
    expect(parts('choice').map((c) => c.textContent)).toEqual(['FiltersThe pickFilters first.', 'SortingSorting first.']);
    expect([...(part('acts')?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['FiltersThe pickFilters first.', 'SortingSorting first.', 'Discuss', 'Got it']);
    part('acts')?.querySelector('button')?.click();
    await settle();
    expect(inbox.decide).toHaveBeenCalledWith('turn:b:1000', { text: 'Filters first.' });
    // answered: the card stays, faded and out of reach, until the lead's next decision comes
    fake.open = [];
    fake.waiting = [];
    fake.state?.();
    await settle();
    expect(part('decision')).toBeNull();
    expect(part('answered')?.textContent).toContain('Answered · Lt. b is on it');
    expect(part('answered')?.inert).toBe(true);
  });

  it('puts a turn of several asks as a block each, answered on its own and held, with what’s held marked and where they stand', async () => {
    const work = leads[1]?.lead;
    if (!work) throw new Error('no lead');
    const asks = [
      { ask: 'Next slice: shared link or emails?', replies: [{ label: 'Shared link', text: 'Shared link first.' }, { label: 'Emails', text: 'Emails first.' }] },
      { ask: 'Keep the old endpoint for a release?', replies: [{ label: 'Keep it', text: 'Keep it for a release.' }] },
      { ask: 'Rename the setting?' },
    ];
    const cos = { route: 2, asks, ask: 'Next slice: shared link or emails? (+2 more)', why: 'Three calls.', message: 'Three things.' };
    work.marks = { [CHIEF_OF_STAFF]: { at: 1000, judged: cos } };
    fake.conn = 'b';
    fake.open = [{ ...card, what: cos.ask, cos, answers: [{ ask: 0, text: 'Emails first.' }, { ask: 2, text: 'Leave it.' }] }];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    delete work.marks;
    expect(part('decision')?.textContent).toContain('Decisions · 3 from Lt. b');
    expect(parts('ask').map((a) => [a.firstElementChild?.textContent, a.hasAttribute('data-answered')])).toEqual([
      ['Next slice: shared link or emails?Answered', true], ['Keep the old endpoint for a release?To answer', false], ['Rename the setting?Answered', true],
    ]);
    // the reply held is marked as the user's answer, and their own words shown as theirs
    expect(parts('ask')[0]?.querySelector('[data-chosen]')?.textContent).toBe('EmailsYour answerEmails first.');
    expect(parts('ask')[2]?.querySelector('[data-part=held]')?.textContent).toBe('Your answer: Leave it.');
    expect(part('asks-status')?.textContent).toBe('2 of 3 answered · nothing goes to Lt. b until all are, then they go together');
    // the replies are each ask's own: no pick across them, and nothing sent whole
    expect(document.body.textContent).not.toContain('The pick');
    parts('ask')[0]?.querySelectorAll('button')[0]?.click();
    await settle();
    expect(inbox.decide).toHaveBeenLastCalledWith('turn:b:1000', { answer: { ask: 0, text: 'Shared link first.' } });
    const own = parts('ask')[1]?.querySelector('input');
    if (!own) throw new Error('no box for their own words');
    own.value = 'Keep it two releases.';
    own.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(inbox.decide).toHaveBeenLastCalledWith('turn:b:1000', { answer: { ask: 1, text: 'Keep it two releases.' } });
    expect([...(part('acts')?.querySelectorAll('button') ?? [])].map((x) => x.textContent).slice(-2)).toEqual(['Discuss', 'Got it']);
  });

  it('fades a turn of several asks once the last answer sends them, every ask shown answered, the last too', async () => {
    const work = leads[1]?.lead;
    if (!work) throw new Error('no lead');
    const asks = [
      { ask: 'Next slice: shared link or emails?', replies: [{ label: 'Emails', text: 'Emails first.' }] },
      { ask: 'Keep the old endpoint for a release?', replies: [{ label: 'Keep it', text: 'Keep it for a release.' }] },
    ];
    const cos = { route: 2, asks, ask: 'Next slice: shared link or emails? (+1 more)', why: 'Two calls.', message: 'Two things.' };
    work.marks = { [CHIEF_OF_STAFF]: { at: 1000, judged: cos } };
    fake.conn = 'b';
    fake.open = [{ ...card, what: cos.ask, cos, answers: [{ ask: 0, text: 'Emails first.' }] }];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    delete work.marks;
    // the last answer: all of them go together, and the turn leaves the inbox
    fake.open = [];
    fake.waiting = [];
    parts('ask')[1]?.querySelector<HTMLElement>('[data-part=choice]')?.click();
    await settle();
    fake.state?.();
    await settle();
    expect(inbox.decide).toHaveBeenLastCalledWith('turn:b:1000', { answer: { ask: 1, text: 'Keep it for a release.' } });
    expect(part('decision')).toBeNull();
    const faded = part('answered');
    expect(faded?.textContent).toContain('Answered · Lt. b is on it');
    expect([...(faded?.querySelectorAll('[data-part=ask]') ?? [])].map((x) => x.hasAttribute('data-answered'))).toEqual([true, true]);
    expect([...(faded?.querySelectorAll('[data-chosen]') ?? [])].map((x) => x.textContent)).toEqual(['EmailsYour answerEmails first.', 'Keep itYour answerKeep it for a release.']);
    expect(faded?.querySelector('[data-part=asks-status]')?.textContent).toBe('All 2 answered: sending them to Lt. b as one message');
  });

  it('discusses it in the panel: the decision quoted at its top, and what’s said sent to the lead about it', async () => {
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    [...(part('acts')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Discuss')?.click();
    expect(shown('talk')).toBe(true);
    expect(part('topic')?.textContent).toBe('DiscussingFilters first?');
    const box = part('talk')?.querySelector('textarea');
    if (!box) throw new Error('no box to talk to them');
    box.value = 'What would sorting cost?';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(messageAgent).toHaveBeenCalledWith('b', 'Lt. b', 'About “Filters first?”: What would sorting cost?');
    expect(shown('topic')).toBe(false);
  });

  it('keeps another goal’s card off the sheet: a count on its berth, no hail', async () => {
    fake.conn = 'a';
    fake.open = [card];
    await open();
    expect(shown('hail')).toBe(false);
    expect(part('decision')).toBeNull();
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.textContent).toBe('1');
  });
});

describe('a hail on watch', () => {
  it('drops over the sheet, opens in place when pressed, and stands by into the muster', async () => {
    fake.conn = 'b';
    fake.open = [hail];
    await open();
    expect(shown('hail')).toBe(true);
    expect(part('hail')?.textContent).toBe('Hail · Goal aRead production?');
    part('hail')?.click();
    expect(part('hail')?.textContent).toContain('Hail · Goal a · Lt. a');
    expect(part('hail')?.textContent).toContain('One read-only query.');
    [...(part('hail')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Stand by')?.click();
    await settle();
    expect(fake.stoodBy).toEqual(['turn:a:1000']);
    expect(shown('hail')).toBe(false);
    // standing down: the muster comes up, the hail in it, first and said to be stood by
    part('chip')?.click();
    await settle();
    expect(fake.conn).toBeUndefined();
    expect(shown('muster')).toBe(true);
    expect(part('row')?.textContent).toContain('Goal a · hail, stood by');
  });
});

describe('talking to the lead', () => {
  it('slides the panel in from the lead’s name with their conversation, sends what’s written, and goes on Esc', async () => {
    fake.conn = 'a';
    fake.threads.a = [{ kind: 'you', at: 1, text: 'Go' }, { kind: 'ops', at: 2, from: 'Ops', text: 'Following it.' }, { kind: 'lead', at: 3, text: 'Done.' }];
    await open();
    expect(shown('talk')).toBe(false);
    part('who')?.click();
    await settle();
    expect(shown('talk')).toBe(true);
    expect(part('talk')?.textContent).toContain('Done.');
    expect(part('talk')?.textContent).not.toContain('Following it.');
    const box = part('talk')?.querySelector('textarea');
    if (!box) throw new Error('no box to talk to them');
    box.value = 'Ship it';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(messageAgent).toHaveBeenCalledWith('a', 'Lt. a', 'Ship it');
    press('Escape', 'Escape');
    expect(shown('talk')).toBe(false);
  });
});

describe('the bridge while updates stream in', () => {
  it('keeps the berth under the captain’s press through an update, so the press still lands', async () => {
    fake.open = [card];
    await open();
    const pressed = berth('Goal a');
    pressed?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // the plugin's state comes in between the press going down and coming up
    fake.state?.();
    await settle();
    expect(berth('Goal a')).toBe(pressed);
    pressed?.click();
    expect(fake.conn).toBe('a');
  });

  it('keeps a card’s buttons through an update that doesn’t change the card, so a press still lands', async () => {
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    const got = part('acts')?.querySelector('button');
    if (!got) throw new Error('no buttons on the decision card');
    fake.state?.();
    await settle();
    expect(part('acts')?.querySelector('button')).toBe(got);
  });
});

describe('the direct line to the chief of staff', () => {
  const started = { key: 'p|add dark mode', leadId: 'b', projectId: 'p', project: 'Shop', text: 'Add dark mode', why: 'You want it before the launch.', at: 2 };
  const line = {
    status: 'waiting', costUsd: 0, told: [{ leadId: 'a', goal: 'Goal a', text: 'Mind the footer', at: 3 }], started: [started],
    messages: [{ from: 'user', text: 'We need dark mode', at: 1 }, { from: 'cos', text: 'Started it.', at: 4 }],
  };

  it('is at the top of the rail, and taking it (or 0) stands down and shows the conversation in the viewer’s place', async () => {
    fake.conn = 'a';
    await open();
    expect(part('line-berth')?.textContent).toContain('Chief of Staff');
    press('Digit0');
    await settle();
    expect(fake.conn).toBeUndefined();
    expect(shown('line')).toBe(true);
    expect(shown('sheet')).toBe(false);
    expect(shown('empty')).toBe(false);
    expect(document.body.textContent).toContain('Direct line · Chief of Staff');
    // a berth takes the conn again, and the line goes
    berth('Goal a')?.click();
    await settle();
    expect(shown('line')).toBe(false);
  });

  it('says what it started where it happened, with why, and Close closes it, warning first', async () => {
    fake.line = line;
    await open();
    part('line-berth')?.click();
    await settle();
    const said = part('line-said');
    expect([...(said?.children ?? [])].map((c) => c.getAttribute('data-from') ?? c.getAttribute('data-part'))).toEqual(['you', 'line-started', 'line-told', 'cos']);
    expect(part('line-started')?.textContent).toContain('I started Goal b in Shop because you want it before the launch.');
    part('line-close')?.click();
    await settle();
    expect(fake.said).toEqual([{ path: '/line/close', key: started.key }, { path: '/line/close', key: started.key, force: true }]);
  });

  it('sends what’s typed on Enter, and says what it’s doing while it thinks', async () => {
    fake.line = { ...line, status: 'thinking' };
    fake.lineActivity = 'Starting a goal';
    await open();
    press('Digit0');
    expect(part('line-status')?.textContent).toBe('Thinking · Starting a goal');
    fake.line = { ...line, status: 'failed', error: 'Interrupted when Focus shut down. Say it again.' };
    fake.state?.();
    await settle();
    expect(part('line-status')?.textContent).toContain('Interrupted');
    const box = part('line-box');
    if (!(box instanceof HTMLTextAreaElement)) throw new Error('no box');
    box.value = 'Add search to the shop';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(fake.said).toEqual([{ path: '/line/say', text: 'Add search to the shop' }]);
    expect(box.value).toBe('');
  });

  // README.md: "each goal it starts waits in the muster until the user hears of it or closes it"
  it('waits in the muster and on the chip until heard of: Close closes it as the line does, Got it lets it run on', async () => {
    fake.line = line;
    await open();
    expect(part('chip')?.textContent).toBe('Muster1');
    part('chip')?.click();
    expect(part('started')?.textContent).toContain('Chief of Staff started Goal b in Shop: You want it before the launch.');
    expect(part('muster')?.textContent).toContain('Muster · 1 decision');
    const [close, got] = [...(part('started')?.querySelectorAll('button') ?? [])].filter((b) => b.textContent === 'Close' || b.textContent === 'Got it');
    close?.click();
    await settle();
    expect(fake.said).toEqual([{ path: '/line/close', key: started.key }, { path: '/line/close', key: started.key, force: true }]);
    got?.click();
    await settle();
    expect(fake.said.at(-1)).toEqual({ path: '/line/ack', key: started.key });
    fake.line = { ...line, started: [{ ...started, acked: 9 }] };
    fake.state?.();
    await settle();
    expect(part('started')).toBeNull();
    expect(part('chip')?.textContent).toBe('Muster0');
  });

  it('takes the conn of the goal it started when its title is pressed', async () => {
    fake.line = line;
    await open();
    part('chip')?.click();
    [...(part('started')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Goal b')?.click();
    await settle();
    expect(fake.conn).toBe('b');
    expect(shown('sheet')).toBe(true);
  });

  it('is gone from the started notice’s Close once the goal has closed', async () => {
    fake.line = { ...line, started: [{ ...started, closed: 9 }] };
    await open();
    press('Digit0');
    expect(part('line-close')).toBeNull();
    expect(part('line-started')?.textContent).toContain('Started · closed');
  });
});
