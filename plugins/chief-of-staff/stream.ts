import './bridge.css';
import { busy, callPlugin, fill, focus, h, markdownHtml, messageAgent, onPluginState, pluginState, readPlugin, type Ui } from '../../plugin-api/client';
import { ACTIVE_STATUSES, type Agent, artifactUrl, type Attention } from '../../plugin-api/shared';
import { waitingNow } from './here';
import { hailKey, type InboxItem } from './inbox';
import { inbox } from './inboxApi';
import { type LandedItem, landedWhere } from './landed';
import { answersOf } from './needCard';
import { CHIEF_OF_STAFF, cosStateOf } from './shared';
import { berths, bundleSays, conversation, doing, footOf, previewFor, seenOf } from './streamList';
import type { ThreadEntry } from './thread';
import { type Grade, gradeOf, musterOrder, type Reach, reachOf, type StripExhibit, type StripSlice, stripOf, watchOf } from './watchRules';

// Comms as the bridge (README.md#the-watch), drawn as docs/interface-style/mockups/bridge-grammar.html draws it, its
// values in Tailwind's utilities (bridge.css). The HUD across the top: where the captain is (Bridge, on watch or not)
// and the Muster chip, its count what waits outside the goal at the conn. On the left the rail: every shown project's
// goals in their berths, staying where they are, a count on each with decisions waiting. In the viewer, with nobody at
// the conn, an empty table; at the conn, the goal as a sheet: its head (the lead's name is Talk), what came in since
// the watch began, its chart (the last waypoint behind, where it is, the next one dashed), its orders, and what it asks
// of the captain as cards resting on it: a decision, words ready for the lead, what of it landed, what the lead put up
// to look at. Standing down (the chip, or M) brings the muster up in the viewer's place, by what each unblocks. A hail
// from a goal underway drops from the chip, put on screen in place or told to stand by. Talk (the lead's name, or T)
// slides the panel in from the right, the conversation and a box to talk to the lead; the rail steps back.

/** When the captain last looked at each goal's conversation (its latest entry's time), kept in this browser. */
const SEEN = 'cos-stream-seen';
const seenAll = (): Record<string, number> => {
  try {
    return seenOf(JSON.parse(localStorage.getItem(SEEN) ?? '{}'));
  } catch {
    return {};
  }
};
const seenAt = (goal: string): number | undefined => seenAll()[goal];
const markSeen = (goal: string, at: number) => localStorage.setItem(SEEN, JSON.stringify({ ...seenAll(), [goal]: at }));

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Every shown project's goals: the leads under way in each. */
const allLeads = (): Agent[] => focus.shown.flatMap((p) => focus.leadsIn(p.id));

/** What Comms asks of the app: its panel, and the panels it goes on to (an agent's, a board, the goals, a lead's screen). */
export type CommsUi = Pick<Ui, 'openAgent' | 'openBoard' | 'openGoals' | 'openScreen' | 'goToAgent' | 'error'> & { panels: Pick<Ui['panels'], 'open' | 'own' | 'backTo'> };

/** The watch as Focus keeps it: the goal at the conn while its lead's aboard (`watchOf`), and the hails stood by. */
const watchNow = () => {
  const kept = cosStateOf(pluginState<unknown>(CHIEF_OF_STAFF));
  return { conn: watchOf(kept.conn, (id) => !!focus.agent(id)), stoodBy: new Set(kept.stoodBy ?? []) };
};

/** Something waiting, as the bridge files it: how hard it asks, whether someone's idle on it, and where it reaches the captain. */
interface Filed {
  item: InboxItem;
  grade: Grade;
  idle: boolean;
  since?: number;
  stoodBy: boolean;
  reach: Reach;
}

/** What waits on the captain, filed for the watch; a turn the chief of staff is still reading isn't yet anywhere. */
function filed(open: readonly InboxItem[], conn: string | undefined, stoodBy: ReadonlySet<string>): Filed[] {
  return open.filter((i) => i.lane !== 'judging').map((item) => {
    const grade: Grade = item.lane === 'ready' ? 'word' : gradeOf(item.kind === 'turn' ? item.cos : undefined);
    const agent = item.agentId ? focus.agent(item.agentId) : undefined;
    const idle = !!agent && !ACTIVE_STATUSES.includes(agent.status);
    const by = stoodBy.has(item.id);
    return { item, grade, idle, since: item.since, stoodBy: by, reach: reachOf({ leadId: item.agentId, grade, stoodBy: by }, conn) };
  });
}

/** Who's held up by something in the muster: what it unblocks, in a line. */
function unblocks(f: Filed): string {
  const agent = f.item.agentId ? focus.agent(f.item.agentId) : undefined;
  if (!agent) return `${f.item.who} · nobody waiting`;
  return f.idle ? `${agent.name.replace(/^\S+\s/, '')} idle until you answer` : 'Nobody waiting yet';
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The mockup's pieces, as its CSS draws them (bridge-grammar.html), in Tailwind's utilities. */
const TW = {
  label: 'tw:font-display tw:text-[9.5px] tw:font-semibold tw:tracking-[.14em] tw:uppercase tw:text-label',
  btn: 'tw:inline-flex tw:items-center tw:h-6 tw:px-[10px] tw:border tw:border-solid tw:border-line tw:bg-surface tw:text-ink tw:font-display tw:text-[10.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:whitespace-nowrap tw:rounded-none tw:cursor-pointer tw:transition-colors tw:duration-[250ms] tw:hover:bg-surface2',
  go: 'tw:inline-flex tw:items-center tw:h-6 tw:px-[10px] tw:border tw:border-solid tw:border-ink tw:bg-ink tw:text-[#111] tw:font-display tw:text-[10.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:whitespace-nowrap tw:rounded-none tw:cursor-pointer tw:transition-colors tw:duration-[250ms]',
  /** Where the viewer, the muster and the empty table sit: right of the rail, under the HUD. */
  table: 'tw:absolute tw:left-[304px] tw:top-[46px] tw:right-3 tw:bottom-3',
  card: 'tw:relative tw:bg-surface2 tw:border tw:border-solid tw:border-hair-card tw:shadow-lift-2 tw:px-[14px] tw:py-3',
  ch: 'tw:font-display tw:text-[10px] tw:font-semibold tw:tracking-[.12em] tw:uppercase tw:text-label',
};

/**
 * Draws a piece of the bridge again only when what it shows has changed (`key`): a piece drawn afresh is new elements,
 * so a press landing as it's replaced is lost, and what was being typed into it goes.
 */
function keyed(el: HTMLElement, key: string, draw: () => void): void {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  draw();
}

/** Shows or hides a piece of the bridge: Tailwind's display utilities are !important, so `hidden` alone wouldn't. */
const show = (el: HTMLElement, on: boolean) => el.classList.toggle('tw:hidden', !on);

const button = (label: string, go: boolean, run: () => void, title?: string): HTMLButtonElement =>
  h('button', { class: go ? TW.go : TW.btn, title, onclick: run }, label);

/** A goal's dot: at work (solid), in error, or between turns (muted). */
function dotEl(lead: Agent): HTMLElement {
  const kind = lead.status === 'error' ? 'tw:bg-[#e5484d]' : ACTIVE_STATUSES.includes(lead.status) ? 'tw:bg-ink' : 'tw:bg-muted';
  return h('i', { class: `tw:inline-block tw:w-[9px] tw:h-[9px] tw:rounded-full ${kind}` });
}

/**
 * Opens Comms, the bridge (README.md#the-watch): the goal at the conn as a sheet, or the muster, or an empty table.
 */
export function openStream(ui: CommsUi): void {
  let { conn } = watchNow();
  // the muster up in the viewer's place; the panel slid in to talk; a muster row opened; the hail put on screen
  let mustering = false;
  let talking = false;
  let expanded: string | null = null;
  let onScreen: string | null = null;
  // the strip: the slice behind fanned out in place, the exhibit open under it, and the exhibits looked at this watch
  let fanned: number | null = null;
  let opened: string | null = null;
  const had = new Set<string>();
  let open: InboxItem[] = [];
  let landed: LandedItem[] = [];
  let entries: ThreadEntry[] = [];
  // what each berth last counted, and the berths whose count went up during this watch: ringed until it ends
  const counted = new Map<string, number>();
  const ticked = new Set<string>();
  // when the captain last looked at the goal at the conn, as the watch began: its sheet says what's come in since
  let watchFrom = conn ? seenAt(conn) : undefined;
  // until Focus has the conn, what's drawn goes by the captain's press rather than what Focus last said
  let taking = false;

  const where = h('div', { class: 'tw:font-display tw:text-[11px] tw:font-semibold tw:tracking-[.1em] tw:uppercase tw:text-muted tw:flex tw:gap-2 tw:items-center' });
  const count = h('span', { class: 'tw:block tw:w-[26px] tw:h-[22px] tw:leading-[22px] tw:text-center' });
  const chip = h('button', {
    class: 'tw:flex tw:items-center tw:h-6 tw:p-0 tw:border tw:border-solid tw:border-line tw:bg-panel tw:font-display tw:text-[11px] tw:font-semibold tw:tracking-[.1em] tw:uppercase tw:rounded-none tw:cursor-pointer',
    attrs: { 'data-part': 'chip' },
  }, h('span', { class: 'tw:px-[9px] tw:text-muted' }, 'Muster'), count);
  const hud = h('div', { class: 'tw:absolute tw:left-3 tw:right-3 tw:top-2 tw:h-7 tw:flex tw:items-center tw:justify-between' }, where, chip);
  const rail = h('div', { class: 'tw:absolute tw:left-3 tw:top-[46px] tw:w-[280px] tw:bottom-3 tw:overflow-y-auto tw:overflow-x-hidden tw:transition tw:duration-[560ms] tw:ease-spring' });
  const empty = h('div', { class: `${TW.table} tw:border tw:border-dashed tw:border-line tw:grid tw:place-items-center tw:text-center tw:text-muted tw:text-[13px]`, attrs: { 'data-part': 'empty' } },
    h('div', null, h('b', { class: 'tw:block tw:font-display tw:text-[15px] tw:font-semibold tw:tracking-[.06em] tw:text-ink tw:mb-1 tw:uppercase' }, 'Nothing at the conn'), 'Take the conn of one goal. The rest stay underway on their orders.'));
  const head = h('div', { class: 'tw:flex-none' });
  const shelf = h('div', { class: 'tw:flex tw:flex-col tw:gap-[10px] tw:empty:hidden' });
  const cards = h('div', { class: 'tw:flex tw:flex-col tw:gap-[10px]' });
  const below = h('div', { class: 'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:px-[18px] tw:pt-[14px] tw:pb-[18px] tw:flex tw:flex-col tw:gap-[10px]' }, shelf, cards);
  const viewer = h('div', { class: `${TW.table} tw:flex tw:flex-col tw:bg-surface tw:border tw:border-solid tw:border-line tw:shadow-lift-3 cos-cut tw:origin-[0_20px] tw:transition-transform tw:duration-[560ms] tw:ease-spring`, attrs: { 'data-part': 'sheet' } }, head, below);
  const muster = h('div', { class: `${TW.table} tw:overflow-y-auto tw:bg-surface tw:border tw:border-solid tw:border-line tw:shadow-lift-3 tw:px-[18px] tw:py-4 cos-rise`, attrs: { 'data-part': 'muster' } });
  const said = h('div', { class: 'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-2' });
  const box = h('textarea', { class: 'tw:flex-none tw:h-[34px] tw:min-h-0 tw:border tw:border-solid tw:border-line tw:bg-transparent tw:text-ink tw:text-[11px] tw:p-2 tw:resize-none tw:outline-none tw:rounded-none tw:focus:border-muted tw:font-read' });
  const talkHead = h('div', { class: 'tw:font-display tw:text-[10px] tw:font-semibold tw:tracking-[.12em] tw:uppercase tw:text-label tw:flex tw:justify-between tw:items-center' });
  const panel = h('div', { class: 'tw:absolute tw:top-[46px] tw:right-3 tw:bottom-3 tw:w-[236px] tw:bg-panel tw:border tw:border-solid tw:border-line tw:shadow-lift-4 tw:px-[14px] tw:py-3 tw:flex tw:flex-col tw:gap-2 tw:transition-transform tw:duration-[560ms] tw:ease-spring', attrs: { 'data-part': 'talk' } }, talkHead, said, box);
  const hail = h('div', { class: 'tw:absolute tw:top-10 tw:right-3 tw:z-10 tw:w-[304px] tw:max-h-[calc(100%-52px)] tw:overflow-y-auto tw:bg-surface2 tw:border tw:border-solid tw:border-attn tw:shadow-lift-4 tw:pt-[9px] tw:pr-3 tw:pb-[10px] tw:pl-4 tw:origin-top-right cos-drop', attrs: { 'data-part': 'hail' } });
  const body = h('div', {
    class: 'tw:relative tw:h-full tw:min-h-[500px] tw:overflow-hidden tw:bg-well tw:bg-[radial-gradient(ellipse_at_50%_120%,#1a2230_0%,transparent_60%)] tw:text-ink tw:font-read tw:text-[13px]/[1.45]',
    attrs: { 'data-part': 'bridge' },
  }, rail, empty, viewer, muster, panel, hud, hail);

  const openAgent = (id: string) => {
    ui.openAgent(id);
    ui.panels.backTo('Comms', () => openStream(ui));
  };

  // taking the conn of a goal, or standing down (null): drawn at once, kept by Focus
  const take = (id: string | null) => {
    conn = id ?? undefined;
    mustering = id === null;
    talking = false;
    expanded = onScreen = opened = null;
    fanned = null;
    ticked.clear();
    had.clear();
    watchFrom = id ? seenAt(id) : undefined;
    taking = true;
    entries = [];
    render();
    if (id) refreshThread();
    void callPlugin(CHIEF_OF_STAFF, '/conn', { lead: id }).catch((e: Error) => ui.error(e.message)).finally(() => {
      taking = false;
      later();
    });
  };
  // the Muster chip: stands down from a watch; with none, brings the muster up or puts it away
  const muster_ = () => {
    if (conn) return take(null);
    mustering = !mustering;
    render();
  };
  chip.onclick = muster_;
  const talk = (on: boolean) => {
    talking = on && !!conn;
    render();
    if (talking) box.focus();
    else box.blur();
  };

  // across the top: where the captain is, and the Muster chip with what waits outside the goal at the conn
  const renderHud = (all: readonly Filed[], lead: Agent | undefined) => {
    const at = lead ? `On watch · ${lead.lead?.title ?? lead.name}` : 'No watch';
    keyed(where, at, () => fill(where, h('span', null, 'Bridge'), h('span', null, '·'), h('b', { class: 'tw:text-ink tw:font-semibold' }, at)));
    const n = all.filter((f) => f.reach === 'muster' || f.reach === 'hail').length;
    count.textContent = String(n);
    count.className = `tw:block tw:w-[26px] tw:h-[22px] tw:leading-[22px] tw:text-center ${n ? 'tw:bg-attn tw:text-[#111]' : 'tw:bg-surface2 tw:text-muted'}`;
    chip.title = lead ? 'Stand down: the goal goes back to its berth and the muster comes up (M)' : mustering ? 'Put the muster away (M)' : 'The muster: what waits on you, by what each unblocks (M)';
  };

  // the rail: every goal in its berth by project, staying where it is, with how many decisions wait on it
  const renderRail = (leads: readonly Agent[], all: readonly Filed[]) => {
    rail.classList.toggle('tw:opacity-0', talking);
    rail.classList.toggle('tw:-translate-x-6', talking);
    const decisions = (id: string) => all.filter((f) => f.item.agentId === id && f.grade !== 'word').length;
    const sections = berths(leads, focus.shown);
    for (const l of leads) {
      const n = decisions(l.id);
      if (conn && n > (counted.get(l.id) ?? n)) ticked.add(l.id);
      counted.set(l.id, n);
    }
    const key = JSON.stringify([conn ?? null, sections.map((s) => [s.name, s.goals.map((l) => [l.id, l.lead?.title ?? l.name, l.name, l.status, counted.get(l.id), ticked.has(l.id)])])]);
    keyed(rail, key, () => drawRail(sections));
  };

  const drawRail = (sections: ReturnType<typeof berths<Agent>>) => {
    const els = sections.flatMap((s, i) => [
      h('div', { class: `${TW.label} tw:mx-1 tw:mb-[5px] ${i ? 'tw:mt-[14px]' : 'tw:mt-[2px]'}` }, s.name),
      ...s.goals.map((l) => {
        const n = counted.get(l.id) ?? 0;
        const at = l.id === conn;
        const state = at ? 'tw:bg-surface tw:border-line' : 'tw:bg-panel tw:border-hair-rail';
        const dim = conn && !at ? 'tw:opacity-50' : '';
        const ring = ticked.has(l.id) && !at ? 'tw:shadow-[0_1px_0_rgb(0_0_0/50%),0_0_0_1px_#f5a524]' : 'tw:shadow-lift-1';
        return h('button', {
          class: `tw:relative tw:grid tw:grid-cols-[12px_1fr_22px] tw:items-center tw:gap-[6px] tw:w-full tw:min-h-[30px] tw:py-[6px] tw:pl-2 tw:pr-[6px] tw:mb-1 tw:border tw:border-solid tw:rounded-none tw:text-[12px] tw:text-ink tw:text-left tw:font-read tw:cursor-pointer tw:transition-[opacity,transform,background-color,border-color] tw:duration-[420ms] tw:ease-spring tw:hover:opacity-100 ${state} ${dim} ${ring}`,
          title: `${at ? 'At the conn' : 'Take the conn'}: ${l.lead?.title ?? l.name}\n${l.name} · ${doing(l.status)}`,
          attrs: { 'data-part': 'berth', ...(at && { 'data-at': '' }) },
          onclick: () => { if (!at) take(l.id); },
        },
        dotEl(l),
        h('span', { class: 'tw:line-clamp-2 tw:leading-[1.3]' }, l.lead?.title ?? l.name),
        h('span', { class: `tw:w-[22px] tw:h-4 tw:font-mono tw:text-[11px]/[16px] tw:font-semibold tw:text-center tw:text-attn tw:shadow-[inset_0_0_0_1px_#f5a524] ${n && !at ? '' : 'tw:opacity-0'}`, attrs: { 'data-part': 'count' } }, n ? String(n) : ''));
      }),
    ]);
    fill(rail, ...(els.length ? els : [h('div', { class: 'tw:text-muted tw:text-[12px]' }, 'No goals under way.')]));
  };

  // the strip under the goal's head (stripOf): a section per slice on one track, the ones behind as stacks of their
  // exhibits with a count, the one it's at with its exhibits laid out, and the next as an empty slot. Pressing a stack
  // fans it out in place (the current slice gathers into a stack), and pressing a card opens it under the strip.
  const fan = (slice: number | null) => {
    fanned = slice;
    opened = null;
    render();
  };
  const look = (id: string | null) => {
    opened = opened === id ? null : id;
    if (id) had.add(id);
    render();
  };
  const exhibitEl = (x: StripExhibit, lead: Agent, fresh: boolean) => h('button', {
    class: 'tw:w-[104px] tw:flex-none tw:p-0 tw:bg-transparent tw:border-0 tw:text-left tw:cursor-pointer tw:group',
    title: `${x.title}: open it here`, attrs: { 'data-part': 'card', 'data-id': x.id }, onclick: () => look(x.id),
  },
    h('span', { class: `tw:block tw:h-[58px] tw:bg-surface2 tw:border tw:border-solid tw:shadow-lift-1 tw:overflow-hidden tw:transition-colors tw:group-hover:border-muted ${opened === x.id ? 'tw:border-ink' : 'tw:border-hair-card'}` },
      x.image ? h('img', { class: 'tw:block tw:w-full tw:h-full tw:object-cover tw:object-top', src: artifactUrl(lead.id, x, 'jpg'), alt: '' }) : null),
    h('span', { class: 'tw:flex tw:items-center tw:gap-1 tw:mt-1 tw:text-[10.5px] tw:text-ink' },
      fresh ? h('i', { class: 'tw:flex-none tw:w-[6px] tw:h-[6px] tw:rounded-full tw:bg-ink', title: 'New since the watch began' }) : null,
      h('span', { class: 'tw:truncate' }, x.title)));
  const stackEl = (sl: StripSlice, back: boolean) => h('button', {
    class: 'tw:relative tw:block tw:w-[112px] tw:h-[76px] tw:p-0 tw:bg-transparent tw:border-0 tw:text-left tw:cursor-pointer tw:group',
    title: back ? 'Back to now' : `Slice ${sl.slice}: fan its exhibits out, its record under`, attrs: { 'data-part': 'stack' }, onclick: () => fan(back ? null : sl.slice),
  },
    sl.exhibits.length > 1 ? h('span', { class: 'tw:absolute tw:left-[2px] tw:top-0 tw:w-[92px] tw:h-[52px] tw:bg-surface2 tw:border tw:border-solid tw:border-hair-card tw:rotate-[-5deg]' }) : null,
    h('span', { class: `tw:absolute tw:left-[8px] tw:top-[2px] tw:w-[92px] tw:h-[52px] tw:bg-surface2 tw:border tw:shadow-lift-1 tw:transition-colors tw:group-hover:border-muted ${sl.exhibits.length ? 'tw:border-solid tw:border-hair-card' : 'tw:border-dashed tw:border-line'}` }),
    h('span', { class: 'tw:absolute tw:left-[2px] tw:top-[60px] tw:text-[10.5px] tw:text-muted tw:whitespace-nowrap' },
      back ? `${plural(sl.exhibits.length, 'exhibit')} · now` : sl.exhibits.length ? plural(sl.exhibits.length, 'exhibit') : 'its record'));
  const section = (label: string, pip: string, rule: string, here: boolean, ...body: (HTMLElement | null)[]) =>
    h('div', { class: 'tw:relative tw:flex-none tw:min-w-[96px] tw:pr-4', attrs: { 'data-part': 'slice' } },
      h('span', { class: `tw:block tw:h-4 tw:text-[10.5px] tw:whitespace-nowrap tw:truncate tw:max-w-[220px] ${here ? 'tw:text-ink' : 'tw:text-muted'}` }, label),
      h('span', { class: `tw:absolute tw:left-0 tw:right-0 tw:top-[24px] ${rule}` }),
      h('i', { class: `tw:absolute tw:top-[25px] tw:left-[4px] tw:-translate-y-1/2 tw:rounded-full ${pip}` }),
      h('div', { class: 'tw:flex tw:gap-[6px] tw:mt-[22px]' }, ...body));
  const sliceEl = (sl: StripSlice, lead: Agent) => {
    const out = sl.slice === fanned || (sl.now && fanned === null);
    const pip = sl.now ? 'tw:w-3 tw:h-3 tw:bg-surface tw:shadow-[0_0_0_2px_#e9edf2]' : 'tw:w-[9px] tw:h-[9px] tw:bg-ink';
    const fresh = (x: StripExhibit) => watchFrom !== undefined && x.at > watchFrom && !had.has(x.id);
    const body = !out
      ? [stackEl(sl, sl.now)]
      : sl.exhibits.length
        ? sl.exhibits.map((x) => exhibitEl(x, lead, fresh(x)))
        : [h('span', { class: 'tw:block tw:h-[76px] tw:text-[10.5px] tw:text-muted' }, sl.now ? 'Nothing shown yet' : 'Nothing shown')];
    return section(`${sl.slice} · ${sl.name}${sl.now ? ' · now' : ''}`, pip, 'tw:h-[2px] tw:bg-ink', sl.now || sl.slice === fanned, ...body);
  };
  const stripEl = (slices: readonly StripSlice[], next: string | undefined, lead: Agent) =>
    h('div', { class: 'tw:flex tw:mx-[18px] tw:mt-[10px] tw:pb-2 tw:overflow-x-auto tw:overflow-y-hidden', attrs: { 'data-part': 'strip' } },
      ...slices.map((sl) => sliceEl(sl, lead)),
      next
        ? section(`${next} · next`, 'tw:w-[9px] tw:h-[9px] tw:bg-surface tw:shadow-[inset_0_0_0_1.5px_#8a94a3]', 'tw:h-0 tw:border-t-[1.5px] tw:border-dashed tw:border-muted', false,
          h('span', { class: 'tw:grid tw:place-items-center tw:w-[104px] tw:h-[58px] tw:border tw:border-dashed tw:border-line tw:text-[10.5px] tw:text-muted' }, 'nothing yet'))
        : null);

  // under the strip: the exhibit opened from its card, and the record of the slice fanned out (what it shipped, what
  // was decided and when, what it taught), both resting on the sheet above the cards that ask for the captain
  const renderShelf = (lead: Agent, slices: readonly StripSlice[]) => {
    const sl = slices.find((x) => x.slice === fanned);
    const x = slices.flatMap((y) => y.exhibits.map((e) => ({ ...e, slice: y.slice }))).find((e) => e.id === opened);
    keyed(shelf, JSON.stringify([lead.id, sl ?? null, x ?? null]), () => fill(shelf, x ? openedEl(lead, x) : null, sl ? recordEl(sl) : null));
  };
  const recordEl = (sl: StripSlice) => {
    const col = (k: string, lines: readonly (readonly [string, string?])[]) => h('div', { class: 'tw:min-w-0' },
      h('div', { class: `${TW.label} tw:mb-1` }, k),
      ...(lines.length ? lines : [['Nothing'] as const]).map(([what, when]) => h('div', { class: `tw:text-[11.5px]/[1.4] tw:mb-1 ${lines.length ? 'tw:text-ink' : 'tw:text-muted'}` },
        what, when ? h('small', { class: 'tw:block tw:text-muted tw:text-[10px]' }, when) : null)));
    return h('div', { class: `${TW.card} tw:grid tw:grid-cols-[1.1fr_1.3fr_1fr] tw:gap-[14px]`, attrs: { 'data-part': 'record' } },
      col('Shipped', sl.shipped.map((p) => [p] as const)),
      col('Decided', sl.decided.map((d) => [d.what, new Date(d.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })] as const)),
      col('Taught', sl.taught.map((t) => [t] as const)));
  };
  const openedEl = (lead: Agent, x: StripExhibit & { slice: number }) =>
    h('div', { class: TW.card, attrs: { 'data-part': 'exhibit' } },
      h('div', { class: 'tw:flex tw:justify-between tw:items-center tw:mb-2 tw:gap-2' },
        h('div', { class: `${TW.ch} tw:truncate` }, `Exhibit · ${x.title} · slice ${x.slice}`),
        h('div', { class: 'tw:flex tw:gap-[6px]' },
          h('a', { class: TW.btn, href: artifactUrl(lead.id, x, 'html'), target: '_blank', rel: 'noopener' }, 'New tab'),
          button('Close', false, () => look(null)))),
      x.image
        ? h('img', { class: 'tw:block tw:w-full tw:border tw:border-solid tw:border-hair-card', src: artifactUrl(lead.id, x, 'jpg'), alt: x.title })
        : h('iframe', { class: 'tw:block tw:w-full tw:h-[260px] tw:border-0 tw:bg-white', src: artifactUrl(lead.id, x, 'html'), title: x.title }));

  // the sheet's head: the goal, the lead (Talk), what came in since the watch began, the strip, the orders
  const renderHead = (lead: Agent) => {
    const work = lead.lead;
    const project = focus.project(lead.projectId);
    const from = watchFrom;
    const since = from === undefined ? [] : entries.filter((e) => e.at > from && e.kind !== 'you');
    const strip = stripOf({
      waypoints: work?.waypoints ?? [], artifacts: work?.artifacts ?? [], prs: [...(work?.landed ?? []), ...(work?.prs ?? [])], questions: work?.questions ?? [],
    }, work?.note?.next ?? []);
    const orders = [work?.note?.done ? `Done: ${work.note.done}` : '', ...(work?.note?.learned ?? []).slice(-2).reverse()].filter(Boolean);
    const says = [plural(since.length, 'update'), ...bundleSays(since)];
    const key = JSON.stringify([lead.id, project?.name, work?.title, lead.name, lead.status, since.length ? says : null, strip, fanned, opened, [...had], orders, talking]);
    renderShelf(lead, strip.slices);
    keyed(head, key, () => fill(head,
      h('div', { class: 'tw:grid tw:grid-cols-[1fr_auto] tw:gap-x-3 tw:gap-y-[2px] tw:px-[18px] tw:pt-[14px] tw:pb-[10px] tw:border-b tw:border-solid tw:border-hair-card' },
        h('span', { class: TW.label }, project?.name ?? ''),
        h('span', { class: 'tw:col-start-1 tw:font-display tw:text-[17px]/[1.25] tw:font-semibold tw:tracking-[.02em]' }, work?.title ?? lead.name),
        h('button', {
          class: 'tw:row-span-2 tw:col-start-2 tw:row-start-1 tw:self-center tw:text-[12px] tw:text-muted tw:flex tw:items-center tw:gap-[6px] tw:bg-transparent tw:border-0 tw:p-0 tw:cursor-pointer tw:font-read tw:hover:text-ink',
          title: `Talk to ${lead.name} (T)`, attrs: { 'data-part': 'who' }, onclick: () => talk(!talking),
        }, dotEl(lead), `${lead.name} · ${doing(lead.status)}`)),
      since.length
        ? h('div', { class: 'tw:mx-[18px] tw:mt-[10px] tw:text-[12px] tw:text-muted tw:flex tw:gap-[14px] tw:whitespace-nowrap tw:overflow-hidden', attrs: { 'data-part': 'since' } },
          h('span', null, `Since your last watch (${clock(from ?? 0)}):`),
          ...says.map((s) => h('b', { class: 'tw:text-ink tw:font-medium' }, s)))
        : null,
      strip.slices.length ? stripEl(strip.slices, strip.next, lead) : null,
      orders.length
        ? h('div', { class: `tw:mx-[18px] tw:text-[11.5px] tw:text-muted tw:flex tw:gap-2 tw:items-center tw:h-[22px] tw:whitespace-nowrap tw:overflow-hidden ${strip.slices.length ? '' : 'tw:mt-[10px]'}` },
          h('span', { class: 'tw:font-display tw:text-[9.5px] tw:font-semibold tw:tracking-[.14em] tw:text-label' }, 'Orders'),
          ...orders.map((o) => h('span', { class: 'tw:text-ink tw:border tw:border-solid tw:border-hair-card tw:px-[6px] tw:max-w-[50%] tw:truncate', title: o }, o)))
        : null));
  };

  // what the goal asks of the captain, as cards resting on the sheet
  const renderCards = (lead: Agent) => {
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const mine = open.filter((i) => i.agentId === lead.id);
    const { card, ready } = footOf(mine, (id) => local.has(id));
    const item = mine.find((i) => i.id === card);
    const a = card ? local.get(card) : undefined;
    const mineLanded = landed.filter((i) => i.leadId === lead.id);
    const work = lead.lead;
    // what the cards show, and what their answers depend on (the lead's pull requests, for the merge buttons)
    const key = JSON.stringify([lead.id, card ?? null, !!ready, !!a, item?.what, item?.cos, mineLanded.map((i) => i.id), work?.prs, focus.preview(lead.projectId)]);
    keyed(cards, key, () => {
      if (a?.kind === 'turn' && !ready) focus.markRead(a.agent);
      const els: HTMLElement[] = [];
      if (item && a && !ready) els.push(decisionCard(item, a, lead));
      if (item && ready) els.push(wordCard(item));
      for (const l of mineLanded) els.push(landedCard(l));
      const live = previewCard(lead);
      if (live) els.push(live);
      fill(cards, ...els);
    });
  };

  const decisionCard = (item: InboxItem, a: Attention, lead: Agent) =>
    h('div', { class: TW.card, attrs: { 'data-part': 'decision' } },
      h('div', { class: TW.ch }, `Decision · from ${lead.name}`),
      h('div', { class: 'tw:text-[14px] tw:mt-[3px] tw:mb-1' }, item.what),
      item.cos?.says || item.cos?.why ? h('div', { class: 'tw:text-[12px] tw:text-muted' }, item.cos.says ?? item.cos.why) : null,
      h('div', { class: 'cos-acts tw:mt-[10px]' }, ...answersOf(ui, a, openAgent)));

  // words the chief of staff has ready for the lead: sent with a press, or heard (Got it), nothing sent
  const wordCard = (item: InboxItem) => {
    const send = button('Send', true, () => void busy(send, () => inbox.decide(item.id, { send: true }).then(refreshInbox), ui.error));
    const got = button('Got it', false, () => void busy(got, () => inbox.decide(item.id, { ack: true }).then(refreshInbox), ui.error));
    return h('div', { class: TW.card, attrs: { 'data-part': 'word' } },
      h('div', { class: TW.ch }, 'Word ready · the chief of staff'),
      h('div', { class: 'tw:text-[12.5px] tw:mt-[3px]' }, item.cos?.message ?? item.what),
      h('div', { class: 'tw:flex tw:gap-[6px] tw:mt-[10px]' }, got, send));
  };

  const landedCard = (l: LandedItem) => {
    const got = button('Got it', false, () => void busy(got, () => inbox.decideLanded(l.id, { ack: true }).then(refreshInbox), ui.error));
    return h('div', { class: `${TW.card} tw:flex tw:items-center tw:gap-3`, attrs: { 'data-part': 'landed' } },
      h('div', { class: 'tw:flex-1 tw:min-w-0' }, h('div', { class: TW.ch }, 'Landed in Show'), h('div', { class: 'tw:text-[12.5px] tw:truncate' }, landedWhere(l))),
      got);
  };

  // the lead's preview, while one runs: what they put up to look at is on the strip
  const previewCard = (lead: Agent): HTMLElement | null => {
    const preview = previewFor(focus.preview(lead.projectId), [...(lead.lead?.landed ?? []), ...(lead.lead?.prs ?? [])]);
    const live = preview?.status === 'running' ? preview.links[0]?.url : undefined;
    if (!live) return null;
    return h('div', { class: `${TW.card} tw:flex tw:items-center tw:gap-3`, attrs: { 'data-part': 'preview' } },
      h('div', { class: `${TW.ch} tw:flex-1` }, 'Their preview is running'),
      h('a', { class: TW.btn, href: live, target: '_blank', rel: 'noopener' }, 'Open'));
  };

  // the muster: what waits outside the goal at the conn, by what each unblocks, and the reports at its foot
  const renderMuster = (all: readonly Filed[]) => {
    const rows = musterOrder(all.filter((f) => f.reach === 'muster' || f.reach === 'hail'));
    const words = all.filter((f) => f.reach === 'report');
    const heard = landed.filter((i) => !(conn && i.leadId === conn));
    const key = JSON.stringify([rows.map((r) => [r.item.id, r.stoodBy, r.idle]), words.map((r) => r.item.id), heard.map((i) => i.id), expanded]);
    if (muster.dataset.key === key) return;
    muster.dataset.key = key;
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const reports = words.length + heard.length;
    fill(muster,
      h('div', { class: 'tw:flex tw:justify-between tw:items-baseline' },
        h('b', { class: 'tw:font-display tw:text-[17px] tw:font-semibold tw:tracking-[.02em]' }, `Muster · ${plural(rows.length, 'decision')}${reports ? `, ${plural(reports, 'report')}` : ''}`),
        h('span', { class: 'tw:text-muted tw:text-[11.5px]' }, 'by what each unblocks')),
      ...rows.map((f) => musterRow(f, local.get(f.item.id))),
      reports ? reportsRow(words, heard) : null,
      rows.length || reports ? null : h('div', { class: 'tw:mt-3 tw:text-muted tw:text-[12.5px]' }, 'Nothing waits on you.'));
  };

  const row = (report: boolean, g: string, w: string, why: string | null, acts: HTMLElement[], more: HTMLElement | null = null) =>
    h('div', { class: 'tw:grid tw:grid-cols-[4px_1fr_auto] tw:gap-3 tw:items-center tw:py-[10px] tw:pr-3 tw:pl-0 tw:mt-2 tw:bg-surface2 tw:border tw:border-solid tw:border-hair-card', attrs: { 'data-part': report ? 'reports' : 'row' } },
      h('span', { class: `tw:self-stretch ${report ? 'tw:bg-line' : 'tw:bg-attn'}` }),
      h('div', { class: 'tw:min-w-0' },
        h('div', { class: 'tw:font-display tw:text-[9.5px] tw:font-semibold tw:tracking-[.12em] tw:uppercase tw:text-label' }, g),
        h('div', { class: 'tw:text-[12.5px] tw:truncate', title: w }, w),
        why ? h('div', { class: 'tw:text-[11px] tw:text-muted' }, why) : null),
      h('div', { class: 'tw:flex tw:gap-[6px]' }, ...acts),
      more);

  const musterRow = (f: Filed, a: Attention | undefined) => {
    const isOpen = expanded === f.item.id;
    const tag = f.grade === 'hail' ? (f.stoodBy ? ' · hail, stood by' : ' · hail') : '';
    const toggle = a ? [button(isOpen ? 'Close' : 'Open', false, () => { expanded = isOpen ? null : f.item.id; render(); })] : [];
    return row(false, `${f.item.goal}${tag}`, f.item.what, unblocks(f), toggle,
      isOpen && a ? h('div', { class: 'cos-acts tw:col-start-2 tw:col-span-2' }, ...answersOf(ui, a, openAgent)) : null);
  };

  // the reports, in a row: heard with one press, nothing sent
  const reportsRow = (words: readonly Filed[], heard: readonly LandedItem[]) => {
    const says = [heard.length ? `${plural(heard.length, 'slice')} landed in Show` : '', words.length ? `${plural(words.length, 'word')} ready from the chief of staff` : ''].filter(Boolean).join(' · ');
    const got = button('Got it', false, () => void busy(got, () => Promise.all([
      ...words.map((f) => inbox.decide(f.item.id, { ack: true })),
      ...heard.map((i) => inbox.decideLanded(i.id, { ack: true })),
    ]).then(refreshInbox), ui.error));
    return row(true, `Reports · ${words.length + heard.length}`, says, null, [got]);
  };

  // a hail from a goal underway, dropped from the Muster chip: on screen in place, or told to stand by
  const renderHail = (all: readonly Filed[]) => {
    const f = conn && !mustering ? all.find((x) => x.reach === 'hail') : undefined;
    const key = f ? `${f.item.id}|${onScreen === f.item.id}` : '';
    if (hail.dataset.key === key) return;
    hail.dataset.key = key;
    show(hail, !!f);
    if (!f) return fill(hail);
    const shown = onScreen === f.item.id;
    const a = waitingNow().find((x) => hailKey(x) === f.item.id);
    const bar = h('span', { class: 'tw:absolute tw:left-0 tw:top-0 tw:bottom-0 tw:w-1 tw:bg-attn' });
    const hk = h('div', { class: 'tw:font-display tw:text-[9.5px] tw:font-semibold tw:tracking-[.14em] tw:uppercase tw:text-attn' }, shown ? `Hail · ${f.item.goal} · ${f.item.who}` : `Hail · ${f.item.goal}`);
    const ht = h('div', { class: 'tw:text-[12.5px] tw:mt-[2px]' }, f.item.what);
    if (!shown) {
      hail.onclick = () => { onScreen = f.item.id; render(); };
      hail.classList.add('tw:cursor-pointer');
      hail.title = 'On screen: read it here, still at the conn';
      return fill(hail, bar, hk, ht);
    }
    hail.onclick = null;
    hail.classList.remove('tw:cursor-pointer');
    hail.title = '';
    const standBy = button('Stand by', false, () => void busy(standBy, () => callPlugin(CHIEF_OF_STAFF, '/stand-by', { key: f.item.id }), ui.error), 'Into the muster, for when you stand down');
    fill(hail, bar, hk, ht,
      f.item.cos?.message ? h('div', { class: 'tw:text-[11.5px] tw:text-muted tw:mt-[6px]' }, f.item.cos.message) : null,
      h('div', { class: 'cos-acts tw:mt-2' }, standBy, ...(a ? answersOf(ui, a, openAgent) : [])));
  };

  // the panel, slid in from the right to talk to the lead: their words and the captain's, and the box
  const renderTalk = (lead: Agent | undefined) => {
    panel.classList.toggle('tw:translate-x-[260px]', !talking);
    viewer.classList.toggle('tw:-translate-x-[292px]', talking);
    viewer.classList.toggle('tw:scale-[.89]', talking);
    if (!lead) return;
    const close = h('button', { class: 'tw:bg-transparent tw:border-0 tw:p-0 tw:text-label tw:cursor-pointer tw:font-display tw:text-[10px] tw:tracking-[.12em] tw:uppercase tw:hover:text-ink', onclick: () => talk(false) }, 'Close');
    fill(talkHead, h('span', null, `Comms · ${lead.name}`), close);
    box.placeholder = `Talk to ${lead.name}`;
    const key = `${lead.id}|${entries.at(-1)?.at ?? 0}|${entries.length}`;
    if (said.dataset.key === key) return;
    said.dataset.key = key;
    fill(said, ...conversation(entries).map((e) => {
      const text = h('div', { class: 'cos-md' });
      text.innerHTML = markdownHtml(e.kind === 'lead' || e.kind === 'you' ? e.text : '');
      return h('div', { class: `tw:text-[12px]/[1.45] ${e.kind === 'you' ? 'tw:pl-2 tw:border-l-2 tw:border-solid tw:border-line' : ''}` },
        h('small', { class: 'tw:block tw:text-[10px] tw:text-muted tw:mb-px' }, `${e.kind === 'you' ? 'You' : lead.name} · ${clock(e.at)}`), text);
    }));
    said.scrollTop = said.scrollHeight;
  };
  box.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const lead = conn ? focus.agent(conn) : undefined;
    const words = box.value.trim();
    if (!lead || !words) return;
    box.value = '';
    void messageAgent(lead.id, lead.name, words).then(() => refreshThread(), (err: Error) => { box.value = words; ui.error(err.message); });
  };

  // what streams in (the leads changing, the inbox, the plugin's state, the conversation) is drawn once a frame, however
  // much arrives in it; the captain's own presses are drawn at once
  let queued = false;
  let closed = false;
  const later = () => {
    if (queued || closed) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!closed) render();
    });
  };

  const render = () => {
    const leads = allLeads();
    if (!taking) ({ conn } = watchNow());
    if (!conn) talking = false;
    const all = filed(open, conn, watchNow().stoodBy);
    const lead = conn ? focus.agent(conn) : undefined;
    renderHud(all, lead);
    renderRail(leads, all);
    renderHail(all);
    renderTalk(lead);
    show(muster, mustering);
    if (mustering) renderMuster(all);
    show(viewer, !mustering && !!lead);
    show(empty, !mustering && !lead);
    if (!lead || mustering) return;
    if (conn !== fetched) picked();
    renderHead(lead);
    renderCards(lead);
    const last = entries.at(-1)?.at;
    if (last !== undefined) markSeen(lead.id, last);
  };

  // a goal newly at the conn has its conversation asked for
  let fetched: string | null = null;
  const picked = () => {
    fetched = conn ?? null;
    entries = [];
    refreshThread();
  };
  // the goal's conversation is Focus's, asked for as it's picked and whenever its lead changes, at most every second
  let asking: ReturnType<typeof setTimeout> | undefined;
  function refreshThread() {
    clearTimeout(asking);
    asking = setTimeout(() => {
      const id = conn;
      if (!id) return;
      void readPlugin<{ entries: ThreadEntry[] }>(CHIEF_OF_STAFF, `/thread/${encodeURIComponent(id)}`).then((t) => {
        if (conn !== id) return;
        entries = t.entries;
        later();
      }, () => undefined);
    }, fetched === conn && entries.length ? 1000 : 0);
  }
  function refreshInbox() {
    void inbox.view().then((view) => {
      open = view.open.filter((i) => !focus.isHidden(i.projectId));
      landed = view.landed.filter((i) => !focus.isHidden(i.projectId));
      later();
    }, () => undefined);
  }

  // the bridge's keys: M stands down (or brings the muster up), T talks (Esc stops), 1–9 take the conn of a berth
  const keys = (e: KeyboardEvent) => {
    // Esc puts the panel away before it closes Comms
    if (e.key === 'Escape' && talking) {
      e.preventDefault();
      e.stopPropagation();
      return talk(false);
    }
    // then folds the strip: the exhibit open under it, then the slice fanned out
    if (e.key === 'Escape' && (opened || fanned !== null)) {
      e.preventDefault();
      e.stopPropagation();
      return opened ? look(null) : fan(null);
    }
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const berth = /^Digit([1-9])$/.exec(e.code);
    if (e.code === 'KeyM') muster_();
    else if (e.code === 'KeyT') talk(!talking);
    else if (berth) {
      const goal = berths(allLeads(), focus.shown).flatMap((s) => s.goals)[Number(berth[1]) - 1];
      if (goal && goal.id !== conn) take(goal.id);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  ui.panels.open({ title: 'Comms', body, full: true, look: 'flight' });
  render();
  refreshInbox();
  if (conn) refreshThread();
  window.addEventListener('keydown', keys, true);
  const tick = setInterval(refreshInbox, 5000);
  ui.panels.own(() => {
    closed = true;
    window.removeEventListener('keydown', keys, true);
    clearInterval(tick);
    clearTimeout(asking);
  });
  ui.panels.own(focus.onShip(refreshInbox));
  // the watch changing, here or in another browser: taking the conn, standing down, a hail stood by
  ui.panels.own(onPluginState(CHIEF_OF_STAFF, later));
  // a lead changing: its berth (and with the lead at the conn, their conversation and what came in since, asked for again)
  ui.panels.own(focus.onAgent((a) => {
    if (a.task !== 'lead') return;
    if (a.id === conn) refreshThread();
    later();
  }));
}
