// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// Comms as the captain uses it (README.md#the-watch): an empty table with nobody at the conn, a berth pressed (or its
// number) takes the conn and opens the goal's sheet with its decision on it, another goal's card is a count on its
// berth, a hail drops over the sheet until it's put on screen and stood by, the Muster chip (or M) stands down and the
// muster comes up, and the lead's name (or T) slides in the panel to talk to them.
const fake = vi.hoisted((): { prs: unknown[]; reviews: Map<string, unknown>; threads: Record<string, ThreadEntry[]>; conn?: string; stoodBy?: string[]; line?: unknown; lineActivity?: string; pressed?: Record<string, string[]>; said: unknown[]; state?: () => void; open: unknown[]; waiting: unknown[]; preview?: unknown } => ({ prs: [], reviews: new Map(), threads: {}, open: [], waiting: [], said: [] }));
const agent = (id: string): Agent => ({
  id, name: `Lt. ${id}`, projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: {
    title: `Goal ${id}`, repos: [], slice: 2, prs: [], note: { done: 'Saved items survive a reload', learned: [], next: ['Sharing'] },
    waypoints: [{ slice: 1, title: 'Quick wins', startedAt: 1 }, { slice: 2, heading: 'Saved list', startedAt: 2 }],
    artifacts: [{ id: 'fees', title: 'Fee table', at: 5, slice: 1 }, { id: 'flow', title: 'Flow', at: 6, slice: 2 }, { id: 'system-recap-9', title: 'System recap: #9', at: 7, slice: 2 }],
  },
});
const leads = [agent('a'), agent('b')];
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], project: () => ({ id: 'p', name: 'Shop', color: '#fff' }), leadsIn: () => leads, preview: () => fake.preview, reviews: fake.reviews, mergeMethod: () => 'Squash', lines: () => [], shownPrs: () => fake.prs, agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: () => () => undefined, onAgent: () => () => undefined },
    goalTags: () => [],
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac', sky: 'sky', peach: 'peach' },
    markdownHtml: (text: string) => text,
    busy: async (_b: HTMLButtonElement, run: () => Promise<unknown>) => { await run(); },
    fill: (el: HTMLElement, ...children: (Node | null)[]) => el.replaceChildren(...children.flatMap((c) => (c ? [c] : []))),
    messageAgent: vi.fn(() => Promise.resolve()),
    mergePr: vi.fn(() => Promise.resolve()),
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
vi.mock('./inboxApi', () => ({
  inbox: { view: () => Promise.resolve({ open: fake.open, landed: [], decided: [] }), decide: vi.fn(() => Promise.resolve({ ok: true })) },
  // what's pressed is the plugin's state: a press is heard as it changing
  feedback: { press: vi.fn(() => Promise.resolve({ pressed: [] })), pressed: () => fake.pressed ?? {} },
}));
const { openStream } = await import('./stream');
const { mergePr, messageAgent } = await import('../../plugin-api/client');
const { feedback, inbox } = await import('./inboxApi');
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
  fake.pressed = undefined;
  fake.prs = [];
  fake.reviews.clear();
});
const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const parts = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-part=${name}]`)];
const front = () => document.querySelector<HTMLElement>('[data-front]')?.dataset.part;
/** The cards beside the sheet, oldest first and the front one last, as they're stacked. */
const stackOrder = () => parts('stack').flatMap((s) => [...s.querySelectorAll<HTMLElement>(':scope > [data-key]')]).sort((x, y) => Number(x.style.zIndex) - Number(y.style.zIndex)).map((c) => c.dataset.part);
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

  it('counts the goal’s exhibits in its head, lists them as a card beside the sheet by slice or newest, and opens one as a card over it', async () => {
    await open();
    berth('Goal a')?.click();
    await settle();
    expect(part('exhibits')?.textContent).toBe('Exhibits · 2');
    part('exhibits')?.click();
    expect(front()).toBe('card-exhibits');
    expect(parts('group').map((g) => g.firstElementChild?.textContent)).toEqual(['2 · Saved list · now', '1 · Quick wins']);
    part('by-newest')?.click();
    expect(parts('card').map((c) => c.dataset.id)).toEqual(['flow', 'fees']);
    parts('card')[1]?.click();
    // the exhibit slides over the list, which stays as a spine above it; its page is scaled whole to the card
    expect(front()).toBe('card-artifact');
    expect(part('card-artifact')?.textContent).toContain('Exhibit · slice 1');
    expect(part('card-artifact')?.querySelector('iframe')?.getAttribute('src')).toContain('fees.html');
    expect(part('card-artifact')?.querySelector('iframe')?.getAttribute('style')).toContain('scale(');
    expect(part('card-exhibits')?.querySelector('[data-part=spine]')?.textContent).toContain('Exhibits');
    // Talk is a card like any other: it comes over the two, and Esc closes the front one, landing on the one before
    part('who')?.click();
    expect(front()).toBe('card-talk');
    expect(stackOrder()).toEqual(['card-exhibits', 'card-artifact', 'card-talk']);
    press('Escape', 'Escape');
    expect(front()).toBe('card-artifact');
    press('Escape', 'Escape');
    expect(front()).toBe('card-exhibits');
    press('KeyE');
    expect(stackOrder()).toEqual([]);
    expect(part('sheet')?.classList.contains('tw:right-3')).toBe(true);
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
    expect(front()).toBe('card-talk');
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

describe('the user’s word on a turn (README.md#didnt-need-me-and-you-should-have-asked-me)', () => {
  const judgedTurn = () => {
    const b = leads[1];
    if (!b?.lead) throw new Error('no lead');
    Reflect.set(b, 'sessionId', 'sess-b');
    b.lead.marks = { [CHIEF_OF_STAFF]: { at: 1000, turnUuid: 'turn-b', judged: { route: 2, ask: 'Filters first?', why: 'A pick.', message: '' } } };
    return () => {
      delete b.lead?.marks;
      Reflect.deleteProperty(b, 'sessionId');
    };
  };
  const signals = () => parts('feedback').flatMap((p) => [...p.querySelectorAll('button')]).map((b) => [b.textContent, b.getAttribute('aria-pressed')]);

  it('puts Didn’t need me and You should have asked me on the decision card, quiet beside Discuss and Got it, the one pressed shown pressed', async () => {
    const done = judgedTurn();
    fake.pressed = { 'sess-b:turn-b': ['should-have-asked'] };
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    done();
    expect([...(part('acts')?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Discuss', 'Got it', 'Didn’t need me', 'You should have asked me']);
    expect(signals()).toEqual([['Didn’t need me', 'false'], ['You should have asked me', 'true']]);
  });

  it('records a press by the turn the card is about, and shows it pressed once Focus says so, without a dialog', async () => {
    const done = judgedTurn();
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    part('feedback')?.querySelector<HTMLButtonElement>('[data-signal=not-needed]')?.click();
    await settle();
    expect(feedback.press).toHaveBeenCalledWith({ agentId: 'b', turnUuid: 'turn-b', signal: 'not-needed', via: 'comms' });
    expect(document.querySelector('dialog')).toBeNull();
    fake.pressed = { 'sess-b:turn-b': ['not-needed'] };
    fake.state?.();
    await settle();
    done();
    expect(signals()).toEqual([['Didn’t need me', 'true'], ['You should have asked me', 'false']]);
  });

  it('puts both on the card of words the chief of staff has ready, beside Got it and Send', async () => {
    const done = judgedTurn();
    fake.conn = 'b';
    fake.open = [{ ...card, lane: 'ready', cos: { ...card.cos, route: 4, message: 'Test it first.' } }];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    done();
    expect(part('word')?.textContent).toContain('Test it first.');
    expect([...(part('word')?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Got it', 'Send', 'Didn’t need me', 'You should have asked me']);
  });

  it('puts both on a question the lead ended their turn on, by that turn', async () => {
    const done = judgedTurn();
    const b = leads[1];
    if (!b?.lead) throw new Error('no lead');
    Reflect.set(b.lead, 'questions', [{ id: 'q1', question: 'Filters or sorting?', at: 5, options: [{ id: 'a', label: 'Filters' }, { id: 'b', label: 'Sorting' }] }]);
    fake.conn = 'b';
    fake.open = [{ ...card, id: 'question:b:q1', kind: 'question', what: 'Filters or sorting?' }];
    fake.waiting = [{ kind: 'question', agent: b }];
    await open();
    done();
    Reflect.deleteProperty(b.lead, 'questions');
    expect(part('decision')).not.toBeNull();
    expect(signals()).toEqual([['Didn’t need me', 'false'], ['You should have asked me', 'false']]);
  });

  it('has none on a card whose turn isn’t named: a read from before reads kept their turn', async () => {
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    expect(part('decision')).not.toBeNull();
    expect(part('feedback')).toBeNull();
  });

  it('puts You should have asked me alone on each of the lead’s messages in Talk, by its turn', async () => {
    fake.conn = 'a';
    Reflect.set(leads[0], 'sessionId', 'sess-a');
    fake.pressed = { 'sess-a:u3': ['should-have-asked'] };
    fake.threads.a = [{ kind: 'you', at: 1, text: 'Go' }, { kind: 'lead', at: 3, text: 'Done.', turnUuid: 'u3' }, { kind: 'you', at: 4, text: 'And?' }, { kind: 'lead', at: 5, text: 'Shipped it too.', turnUuid: 'u5' }];
    await open();
    part('who')?.click();
    await settle();
    Reflect.deleteProperty(leads[0], 'sessionId');
    const said = [...document.querySelectorAll<HTMLElement>('[data-from]')];
    expect(said.map((m) => m.querySelector('[data-part=feedback]')?.textContent ?? null)).toEqual([null, 'You should have asked me', null, 'You should have asked me']);
    expect(signals()).toEqual([['You should have asked me', 'true'], ['You should have asked me', 'false']]);
    said[3]?.querySelector('button')?.click();
    await settle();
    expect(feedback.press).toHaveBeenCalledWith({ agentId: 'a', turnUuid: 'u5', signal: 'should-have-asked', via: 'talk' });
  });
});

describe('what a decision mentions', () => {
  const prOf = { repo: 'acme/shop', number: 9 };
  const mentioning = { ...card, mentions: [{ kind: 'pr', id: 'acme/shop#9', ...prOf }, { kind: 'artifact', id: 'flow' }] };
  const boardPr = {
    ...prOf, title: 'Saved list', url: 'https://github.com/acme/shop/pull/9', branch: 'focus/saved', baseBranch: 'main', headSha: 'abc1234def', isDraft: false,
    mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '', additions: 38, deletions: 4, changedFiles: 3,
  };
  const review = {
    projectId: 'p', ...prOf, title: 'Saved list', status: 'passed', sha: 'abc1234def', requestedAt: 1, commentUrl: 'https://github.com/acme/shop/pull/9#c1',
    report: {
      verdict: 'pass', summary: 'Saving survives a reload.', checks: [{ name: 'Saves an item', result: 'pass', details: '' }], commands: [], captions: ['The list'],
      spotChecks: [{ file: 'src/list.ts', line: 42, why: 'the limit is hard-coded', anchor: 'diff-abcR42' }],
    },
    screenshots: [{ caption: 'The list', file: 'shot-1.png' }],
    recording: { mp4Url: 'https://x/rec.mp4', mp4File: 'rec-1.mp4', realSeconds: 90, shownSeconds: 20, actions: 7 },
  };
  const watching = async () => {
    fake.conn = 'b';
    fake.open = [mentioning];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    fake.prs = [{ projectId: 'p', pr: boardPr }];
    fake.reviews.set('acme/shop#9', review);
    const work = leads[1]?.lead;
    if (work) work.prs = [{ ...prOf, url: boardPr.url, lane: 'ask', recap: { title: 'Saved list', summary: '', recap: { primitives: [{ id: 'saved-list', group: 'shop', impact: 'adds', change: 'keeps the list', paths: ['src/list.ts'] }], invariants: ['A saved item survives a reload'] } } }];
    await open();
  };
  afterEach(() => {
    const work = leads[1]?.lead;
    if (work) work.prs = [];
  });

  it('lists them under the brief, each with where it stands, its slot unlit, and no More fold since the pull request’s card merges it', async () => {
    await watching();
    expect(parts('mention').map((m) => m.textContent)).toEqual(['PRshop#9QA passed', 'EXFlowslice 2']);
    expect(parts('mention').some((m) => m.hasAttribute('data-lit'))).toBe(false);
    expect(part('decision')?.querySelector('details')).toBeNull();
  });

  it('opens a pull request’s card from its mention: its checks, size, QA’s verdict and proof, the recap, GitHub and the merge', async () => {
    await watching();
    parts('mention')[0]?.click();
    const pr = part('card-pr');
    expect(front()).toBe('card-pr');
    expect(parts('mention')[0]?.hasAttribute('data-lit')).toBe(true);
    expect(pr?.textContent).toContain('Pull request · Ask lane');
    expect(part('facts')?.textContent).toBe('Checkspassing' + 'Mergescleanly' + 'QAQA passed');
    expect(part('size')?.textContent).toBe('+38 −4 · 3 files');
    expect(part('qa')?.textContent).toContain('Saving survives a reload.');
    expect(part('spot')?.getAttribute('href')).toBe('https://github.com/acme/shop/pull/9/files#diff-abcR42');
    expect(part('shots')?.querySelector('img')?.getAttribute('src')).toBe('/api/qa-shots/shot-1.png');
    expect(part('recording')?.querySelector('video')?.getAttribute('src')).toBe('/api/qa-shots/rec-1.mp4');
    expect(part('recap')?.textContent).toContain('A saved item survives a reload');
    expect(part('github')?.getAttribute('href')).toBe(boardPr.url);
    const merge = part('merge')?.querySelector('button');
    expect(merge?.textContent).toBe('Squash & merge shop#9');
    merge?.click();
    await settle();
    expect(mergePr).toHaveBeenCalledWith('p', 'acme/shop', 9, false);
  });

  it('stacks the exhibit over the pull request, whose spine stays above it, and a lit mention or Esc closes its card', async () => {
    await watching();
    parts('mention')[0]?.click();
    parts('mention')[1]?.click();
    expect(stackOrder()).toEqual(['card-pr', 'card-artifact']);
    expect(part('card-pr')?.querySelector('[data-part=spine]')?.textContent).toContain('shop#9QA passed');
    // its spine brings it forward; ] and [ move between them
    part('card-pr')?.querySelector<HTMLElement>('[data-part=spine]')?.click();
    expect(front()).toBe('card-pr');
    press('BracketRight', ']');
    expect(front()).toBe('card-artifact');
    // G opens the front pull request on GitHub, and only that
    press('BracketLeft', '[');
    const opened = vi.fn((e: Event) => e.preventDefault());
    part('github')?.addEventListener('click', opened);
    press('KeyG');
    expect(opened).toHaveBeenCalledTimes(1);
    // pressing a lit mention closes its card, wherever it is
    parts('mention')[1]?.click();
    expect(stackOrder()).toEqual(['card-pr']);
    expect(parts('mention')[1]?.hasAttribute('data-lit')).toBe(false);
    press('Escape', 'Escape');
    expect(stackOrder()).toEqual([]);
    expect(parts('mention')[0]?.hasAttribute('data-lit')).toBe(false);
  });

  it('lists them on words ready for the lead too, so what QA passed merges from beside them', async () => {
    await watching();
    fake.open = [{ ...mentioning, lane: 'ready', cos: { ...card.cos, route: 1, message: 'Carry on.' } }];
    cleanups.forEach((c) => c());
    cleanups = [];
    await open();
    expect(part('word')?.querySelectorAll('[data-part=mention]')).toHaveLength(2);
    part('word')?.querySelector<HTMLElement>('[data-part=mention]')?.click();
    expect(front()).toBe('card-pr');
  });

  it('puts the stack away with another conn: open cards are the view’s alone', async () => {
    await watching();
    parts('mention')[0]?.click();
    berth('Goal a')?.click();
    await settle();
    expect(stackOrder()).toEqual([]);
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
    expect(part('talk')).toBeNull();
    part('who')?.click();
    await settle();
    expect(front()).toBe('card-talk');
    expect(part('talk')?.textContent).toContain('Done.');
    expect(part('told')?.textContent).toContain('Ops told Lt. a');
    const box = part('talk')?.querySelector('textarea');
    if (!box) throw new Error('no box to talk to them');
    box.value = 'Ship it';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(messageAgent).toHaveBeenCalledWith('a', 'Lt. a', 'Ship it');
    press('Escape', 'Escape');
    expect(part('talk')).toBeNull();
  });

  it('folds what others told the lead to a line saying who told them, which opens to all of it and stays open as the thread is drawn again', async () => {
    const brief = 'Here is the plan for the saved list.\n\nFirst, store the items per user.\n\nThen show them on the page.';
    fake.conn = 'a';
    fake.threads.a = [{ kind: 'you', at: 1, text: 'Go' }, { kind: 'ops', at: 2, from: 'Chief of Staff', text: brief }, { kind: 'ops', at: 3, from: 'QA officer Lt. Okafor', text: 'QA passed acme/shop#3' }, { kind: 'lead', at: 4, text: 'Done.' }];
    await open();
    part('who')?.click();
    await settle();
    const said = part('talk')?.querySelector('[data-part=told]')?.parentElement;
    expect([...(said?.children ?? [])].map((c) => c.getAttribute('data-from') ?? c.getAttribute('data-part'))).toEqual(['you', 'told', 'told', 'lead']);
    const [cos, qa] = parts('told');
    const toggle = cos?.querySelector<HTMLButtonElement>('[data-part=msg-toggle]');
    expect(toggle?.textContent).toContain('Chief of Staff told Lt. a');
    expect(toggle?.textContent).toContain('Here is the plan for the saved list.');
    expect(qa?.textContent).toContain('QA officer Lt. Okafor told Lt. a');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(cos?.querySelector<HTMLElement>('[data-part=msg-body]')?.hidden).toBe(true);
    toggle?.click();
    expect(cos?.querySelector<HTMLElement>('[data-part=msg-body]')?.hidden).toBe(false);
    expect(cos?.textContent).toContain('Then show them on the page.');
    // the lead answers, and the thread is drawn again with it: what was opened is open still
    fake.threads.a = [...fake.threads.a, { kind: 'you', at: 5, text: 'Ship it' }];
    const box = part('talk')?.querySelector('textarea');
    if (!box) throw new Error('no box to talk to them');
    box.value = 'Ship it';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 1100));
    expect(part('talk')?.textContent).toContain('Ship it');
    const again = parts('told')[0];
    expect(again).not.toBe(cos);
    expect(again?.querySelector('[data-part=msg-toggle]')?.getAttribute('aria-expanded')).toBe('true');
    expect(again?.querySelector<HTMLElement>('[data-part=msg-body]')?.hidden).toBe(false);
    expect(parts('told')[1]?.querySelector('[data-part=msg-toggle]')?.getAttribute('aria-expanded')).toBe('false');
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

  it('folds what it told a lead to “Told <lead> · <goal> · <time>”, opening to all of it and open still as the line is drawn again', async () => {
    const brief = 'Mind the footer.\n\nIt overlaps the cart on small screens.\n\nCheck it at 320px wide.';
    fake.line = { ...line, told: [{ ...line.told[0], text: brief }] };
    await open();
    part('line-berth')?.click();
    await settle();
    const told = part('line-told');
    const toggle = told?.querySelector<HTMLButtonElement>('[data-part=msg-toggle]');
    expect(toggle?.textContent).toMatch(/Told Lt\. a · Goal a · \d\d:\d\d/);
    expect(toggle?.textContent).toContain('Mind the footer.');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(told?.querySelector<HTMLElement>('[data-part=msg-body]')?.hidden).toBe(true);
    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(told?.querySelector<HTMLElement>('[data-part=msg-body]')?.textContent).toContain('Check it at 320px wide.');
    // its reply comes in, and the line is drawn again: what was opened is open still
    fake.line = { ...fake.line as object, messages: [...line.messages, { from: 'cos', text: 'Anything else?', at: 5 }] };
    fake.state?.();
    await settle();
    expect(part('line-told')).not.toBe(told);
    expect(part('line-told')?.querySelector('[data-part=msg-toggle]')?.getAttribute('aria-expanded')).toBe('true');
    expect(part('line-told')?.querySelector<HTMLElement>('[data-part=msg-body]')?.hidden).toBe(false);
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
