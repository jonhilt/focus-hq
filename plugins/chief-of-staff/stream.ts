import './bridge.css';
import { allowTool, answerLead, busy, callPlugin, closeGoal, fill, focus, h, markdownHtml, messageAgent, onPluginState, pluginState, readPlugin, type Ui } from '../../plugin-api/client';
import { ACTIVE_STATUSES, type Agent, artifactUrl, type Attention, openQuestion } from '../../plugin-api/shared';
import { answerAsk } from './askRules';
import { aboutIt, type Act, type AskBlock, askBlocksOf, actsOf, briefOf } from './decisionRules';
import { waitingNow } from './here';
import { hailKey, type InboxItem } from './inbox';
import { inbox } from './inboxApi';
import { type LandedItem, landedWhere } from './landed';
import { closeStarted, lineView, startedNow } from './lineView';
import { mergesOf } from './needCard';
import { CHIEF_OF_STAFF, cosStateOf, type LineStart, readOf, SENDER } from './shared';
import { berths, bundleSays, conversation, doing, footOf, previewFor, seenOf } from './streamList';
import { collapsedMessage } from './collapsedMessage';
import type { ThreadEntry } from './thread';
import { TW } from './bridgeKit';
import { type Exhibit, type ExhibitsBy, exhibitsOf, type Grade, gradeOf, musterOrder, type Reach, reachOf, watchOf } from './watchRules';

// Comms as the bridge (README.md#the-watch), drawn as docs/interface-style/mockups/bridge-grammar.html draws it, its
// values in Tailwind's utilities (bridge.css). The HUD across the top: where the captain is (Bridge, on watch or not)
// and the Muster chip, its count what waits outside the goal at the conn. On the left the rail: every shown project's
// goals in their berths, staying where they are, a count on each with decisions waiting. In the viewer, with nobody at
// the conn, an empty table; at the conn, the goal as a sheet: its head (the lead's name is Talk), what came in since
// the watch began, its exhibits (a count, opening a panel of them beside it), and what it asks of the captain as
// cards resting on it: a decision, words ready for the lead, what of it landed, their preview while it runs. Standing
// down (the chip, or M) brings the muster up in the viewer's place, by what each unblocks. A hail from a goal underway
// drops from the chip, put on screen in place or told to stand by. Talk (the lead's name, or T) opens the panel beside
// the sheet, the conversation and a box to talk to the lead.

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
/** When something was shown, with its day: an exhibit can be from days ago. */
const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

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
  // the direct line to the chief of staff in the viewer, tied to no goal (README.md#the-direct-line)
  let lining = false;
  // the decision last on the sheet, kept faded once it's answered until the next one comes
  let settled: { lead: string; el: HTMLElement } | null = null;
  // the panel's just opened: once the conversation's drawn, show the lead's latest words from their start
  let findLatest = false;
  // the decision being discussed in the panel: quoted at its top, and what's said goes to the lead about it
  let discussing: { id: string; what: string } | null = null;
  let expanded: string | null = null;
  // the messages folded in the panel that the user opened, by id: open still when it's drawn again
  const unfolded = new Set<string>();
  let onScreen: string | null = null;
  // the exhibits: their panel beside the sheet and how it groups them, the one open on the sheet, and the ones looked
  // at this watch
  let browsing = false;
  let groupBy: ExhibitsBy = 'slice';
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

  const where = h('div', { class: 'tw:font-display tw:text-[12px] tw:font-semibold tw:tracking-[.1em] tw:uppercase tw:text-muted tw:flex tw:gap-2 tw:items-center' });
  const count = h('span', { class: 'tw:block tw:w-[26px] tw:h-[22px] tw:leading-[22px] tw:text-center' });
  const chip = h('button', {
    class: 'tw:flex tw:items-center tw:h-6 tw:p-0 tw:border tw:border-solid tw:border-line tw:bg-panel tw:font-display tw:text-[12px] tw:font-semibold tw:tracking-[.1em] tw:uppercase tw:rounded-none tw:cursor-pointer',
    attrs: { 'data-part': 'chip' },
  }, h('span', { class: 'tw:px-[9px] tw:text-muted' }, 'Muster'), count);
  const hud = h('div', { class: 'tw:absolute tw:left-3 tw:right-3 tw:top-2 tw:h-7 tw:flex tw:items-center tw:justify-between' }, where, chip);
  const rail = h('div', { class: 'tw:absolute tw:left-3 tw:top-[46px] tw:w-[280px] tw:bottom-3 tw:overflow-y-auto tw:overflow-x-hidden tw:transition tw:duration-[560ms] tw:ease-spring' });
  const empty = h('div', { class: `${TW.table} tw:border tw:border-dashed tw:border-line tw:grid tw:place-items-center tw:text-center tw:text-muted tw:text-[14px]`, attrs: { 'data-part': 'empty' } },
    h('div', null, h('b', { class: 'tw:block tw:font-display tw:text-[15px] tw:font-semibold tw:tracking-[.06em] tw:text-ink tw:mb-1 tw:uppercase' }, 'Nothing at the conn'), 'Take the conn of one goal. The rest stay underway on their orders.'));
  const head = h('div', { class: 'tw:flex-none' });
  const shelf = h('div', { class: 'tw:flex tw:flex-col tw:gap-[10px] tw:empty:hidden' });
  const cards = h('div', { class: 'tw:flex tw:flex-col tw:gap-[10px]' });
  const below = h('div', { class: 'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:px-[18px] tw:pt-[14px] tw:pb-[18px] tw:flex tw:flex-col tw:gap-[10px]' }, shelf, cards);
  const viewer = h('div', { class: `${TW.table} tw:flex tw:flex-col tw:bg-surface tw:border tw:border-solid tw:border-line tw:shadow-lift-3 cos-cut`, attrs: { 'data-part': 'sheet' } }, head, below);
  const muster = h('div', { class: `${TW.table} tw:overflow-y-auto tw:bg-surface tw:border tw:border-solid tw:border-line tw:shadow-lift-3 tw:px-[18px] tw:py-4 cos-rise`, attrs: { 'data-part': 'muster' } });
  const said = h('div', { class: 'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden tw:[overflow-wrap:anywhere] tw:flex tw:flex-col tw:gap-5 tw:pr-1' });
  const box = h('textarea', { class: 'tw:flex-none tw:h-[72px] tw:min-h-0 tw:border tw:border-solid tw:border-line tw:bg-transparent tw:text-ink tw:text-[14.5px]/[1.5] tw:p-2 tw:resize-none tw:outline-none tw:rounded-none tw:focus:border-muted tw:font-read' });
  const talkHead = h('div', { class: 'tw:font-display tw:text-[11px] tw:font-semibold tw:tracking-[.12em] tw:uppercase tw:text-label tw:flex tw:justify-between tw:items-center' });
  const topic = h('div', { class: 'tw:flex-none tw:border-0 tw:border-l-2 tw:border-solid tw:border-attn tw:pl-3 tw:text-[14.5px]/[1.5]', attrs: { 'data-part': 'topic' } });
  // the panel to talk in opens beside the sheet (the sheet narrows to make room only where there isn't any)
  const panel = h('div', { class: 'tw:absolute tw:top-[46px] tw:left-[min(1176px,calc(100%_-_472px))] tw:bottom-3 tw:w-[460px] tw:bg-panel tw:border tw:border-solid tw:border-line tw:shadow-lift-4 tw:px-4 tw:py-3 tw:flex tw:flex-col tw:gap-2 cos-slide', attrs: { 'data-part': 'talk' } }, talkHead, topic, said, box);
  const gallery = h('div', { class: 'tw:absolute tw:top-[46px] tw:left-[min(1176px,calc(100%_-_472px))] tw:bottom-3 tw:w-[460px] tw:bg-panel tw:border tw:border-solid tw:border-line tw:shadow-lift-4 tw:px-4 tw:py-3 tw:flex tw:flex-col tw:gap-3 cos-slide', attrs: { 'data-part': 'gallery' } });
  const hail = h('div', { class: 'tw:absolute tw:top-10 tw:right-3 tw:z-10 tw:w-[304px] tw:max-h-[calc(100%-52px)] tw:overflow-y-auto tw:bg-surface2 tw:border tw:border-solid tw:border-attn tw:shadow-lift-4 tw:pt-[9px] tw:pr-3 tw:pb-[10px] tw:pl-4 tw:origin-top-right cos-drop', attrs: { 'data-part': 'hail' } });
  const body = h('div', {
    class: 'tw:relative tw:h-full tw:min-h-[500px] tw:overflow-hidden tw:bg-well tw:bg-[radial-gradient(ellipse_at_50%_120%,#1a2230_0%,transparent_60%)] tw:text-ink tw:font-read tw:text-[14px]/[1.45]',
    attrs: { 'data-part': 'bridge' },
  }, rail, empty, viewer, muster, panel, gallery, hud, hail);
  const line = lineView((message) => ui.error(message));
  body.insertBefore(line.el, panel);


  // taking the conn of a goal, or standing down (null): drawn at once, kept by Focus
  const take = (id: string | null) => {
    conn = id ?? undefined;
    mustering = id === null;
    lining = false;
    talking = false;
    discussing = null;
    settled = null;
    expanded = onScreen = opened = null;
    browsing = false;
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
  // the direct line: in the viewer's place, standing down from any watch (the conn is a goal's, and the line is no goal)
  const takeLine = () => {
    lining = true;
    mustering = talking = browsing = false;
    discussing = null;
    expanded = onScreen = opened = null;
    if (conn) {
      conn = undefined;
      taking = true;
      void callPlugin(CHIEF_OF_STAFF, '/conn', { lead: null }).catch((e: Error) => ui.error(e.message)).finally(() => {
        taking = false;
        later();
      });
    }
    render();
    line.focusBox();
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
    if (talking) browsing = false;
    if (!talking) discussing = null;
    render();
    if (talking) box.focus();
    else box.blur();
  };

  // across the top: where the captain is, and the Muster chip with what waits outside the goal at the conn
  const renderHud = (all: readonly Filed[], lead: Agent | undefined) => {
    const at = lining && !mustering ? 'Direct line · Chief of Staff' : lead ? `On watch · ${lead.lead?.title ?? lead.name}` : 'No watch';
    keyed(where, at, () => fill(where, h('span', null, 'Bridge'), h('span', null, '·'), h('b', { class: 'tw:text-ink tw:font-semibold' }, at)));
    const n = all.filter((f) => f.reach === 'muster' || f.reach === 'hail').length + startedNow().filter((s) => s.leadId !== conn).length;
    count.textContent = String(n);
    count.className = `tw:block tw:w-[26px] tw:h-[22px] tw:leading-[22px] tw:text-center ${n ? 'tw:bg-attn tw:text-[#111]' : 'tw:bg-surface2 tw:text-muted'}`;
    chip.title = lead ? 'Stand down: the goal goes back to its berth and the muster comes up (M)' : mustering ? 'Put the muster away (M)' : 'The muster: what waits on you, by what each unblocks (M)';
  };

  // the rail: every goal in its berth by project, staying where it is, with how many decisions wait on it
  const renderRail = (leads: readonly Agent[], all: readonly Filed[]) => {
    const decisions = (id: string) => all.filter((f) => f.item.agentId === id && f.grade !== 'word').length;
    const sections = berths(leads, focus.shown);
    for (const l of leads) {
      const n = decisions(l.id);
      if (conn && n > (counted.get(l.id) ?? n)) ticked.add(l.id);
      counted.set(l.id, n);
    }
    const key = JSON.stringify([conn ?? null, lining, sections.map((s) => [s.name, s.goals.map((l) => [l.id, l.lead?.title ?? l.name, l.name, l.status, counted.get(l.id), ticked.has(l.id)])])]);
    keyed(rail, key, () => drawRail(sections));
  };

  // the direct line's berth, at the top of the rail: no goal's, so it's no project's either
  const lineBerth = () => h('button', {
    class: `tw:grid tw:grid-cols-[12px_1fr_22px] tw:items-center tw:gap-[6px] tw:w-full tw:min-h-[30px] tw:py-[6px] tw:pl-2 tw:pr-[6px] tw:mb-[10px] tw:border tw:border-solid tw:rounded-none tw:text-[13px] tw:text-ink tw:text-left tw:font-read tw:cursor-pointer tw:shadow-lift-1 ${lining ? 'tw:bg-surface tw:border-line' : 'tw:bg-panel tw:border-hair-rail'}`,
    title: 'Talk to the Chief of Staff, tied to no goal (0)', attrs: { 'data-part': 'line-berth', ...(lining && { 'data-at': '' }) },
    onclick: () => { if (!lining) takeLine(); },
  },
  h('i', { class: 'tw:inline-block tw:w-[9px] tw:h-[9px] tw:rotate-45 tw:bg-attn' }),
  h('span', { class: 'tw:font-display tw:font-semibold tw:tracking-[.06em] tw:uppercase tw:text-[12px]' }, 'Chief of Staff'),
  h('span', { class: 'tw:font-mono tw:text-[11px] tw:text-muted tw:text-center' }, '0'));

  const drawRail = (sections: ReturnType<typeof berths<Agent>>) => {
    const els = sections.flatMap((s, i) => [
      h('div', { class: `${TW.label} tw:mx-1 tw:mb-[5px] ${i ? 'tw:mt-[14px]' : 'tw:mt-[2px]'}` }, s.name),
      ...s.goals.map((l) => {
        const n = counted.get(l.id) ?? 0;
        const at = l.id === conn;
        const state = at ? 'tw:bg-surface tw:border-line' : 'tw:bg-panel tw:border-hair-rail';
        const dim = conn && !at ? 'tw:opacity-50' : '';
        const ring = ticked.has(l.id) && !at ? 'tw:shadow-[0_1px_0_rgb(0_0_0/50%),0_0_0_1px_#f5a524]' : 'tw:shadow-lift-1';
        const berth = h('button', {
          class: `tw:relative tw:grid tw:grid-cols-[12px_1fr_22px] tw:items-center tw:gap-[6px] tw:w-full tw:min-h-[30px] tw:py-[6px] tw:pl-2 tw:pr-[6px] tw:mb-1 tw:border tw:border-solid tw:rounded-none tw:text-[13px] tw:text-ink tw:text-left tw:font-read tw:cursor-pointer tw:transition-[opacity,transform,background-color,border-color] tw:duration-[420ms] tw:ease-spring tw:hover:opacity-100 ${state} ${dim} ${ring}`,
          title: `${at ? 'At the conn' : 'Take the conn'}: ${l.lead?.title ?? l.name}\n${l.name} · ${doing(l.status)}`,
          attrs: { 'data-part': 'berth', ...(at && { 'data-at': '' }) },
          onclick: () => { if (!at) take(l.id); },
        },
        dotEl(l),
        h('span', { class: 'tw:line-clamp-2 tw:leading-[1.3]' }, l.lead?.title ?? l.name),
        h('span', { class: `tw:w-[22px] tw:h-4 tw:font-mono tw:text-[12px]/[16px] tw:font-semibold tw:text-center tw:text-attn tw:shadow-[inset_0_0_0_1px_#f5a524] ${n && !at ? '' : 'tw:opacity-0'}`, attrs: { 'data-part': 'count' } }, n ? String(n) : ''));
        // View in room, over the berth's right end while it's hovered: the room's goal viewing station, tuned to the lead's goal
        return h('div', { class: 'tw:relative tw:group' }, berth,
          h('button', {
            class: 'tw:absolute tw:right-[34px] tw:top-1/2 tw:-translate-y-1/2 tw:h-5 tw:px-[6px] tw:border tw:border-solid tw:border-line tw:bg-surface2 tw:text-muted tw:font-display tw:text-[10.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:rounded-none tw:cursor-pointer tw:opacity-0 tw:group-hover:opacity-100 tw:focus:opacity-100 tw:hover:text-ink',
            title: `View ${l.name}'s goal in its room`, attrs: { 'data-part': 'beam' }, onclick: () => ui.goToAgent(l.id),
          }, 'View'));
      }),
    ]);
    fill(rail, lineBerth(), ...(els.length ? els : [h('div', { class: 'tw:text-muted tw:text-[13px]' }, 'No goals under way.')]));
  };

  // the exhibits panel, beside the sheet in the talk panel's place: every exhibit the lead put up, by slice or newest
  // first, a press opening one on the sheet
  const browse = (on: boolean) => {
    browsing = on && !!conn;
    if (browsing) talking = false;
    render();
  };
  const look = (id: string | null) => {
    opened = opened === id ? null : id;
    if (id) had.add(id);
    render();
  };
  const exhibitsFor = (lead: Agent) => exhibitsOf({ waypoints: lead.lead?.waypoints ?? [], artifacts: lead.lead?.artifacts ?? [] }, groupBy);
  const fresh = (x: Exhibit) => watchFrom !== undefined && x.at > watchFrom && !had.has(x.id);
  const exhibitRow = (x: Exhibit, lead: Agent) => h('button', {
    class: `tw:grid tw:grid-cols-[88px_1fr] tw:gap-3 tw:items-center tw:w-full tw:text-left tw:p-[6px] tw:bg-transparent tw:border tw:border-solid tw:rounded-none tw:cursor-pointer tw:font-read tw:transition-colors tw:hover:bg-surface2 ${opened === x.id ? 'tw:border-ink tw:bg-surface2' : 'tw:border-transparent'}`,
    title: `${x.title}: open it on the sheet`, attrs: { 'data-part': 'card', 'data-id': x.id }, onclick: () => look(x.id),
  },
    h('span', { class: 'tw:block tw:h-[54px] tw:bg-surface2 tw:border tw:border-solid tw:border-hair-card tw:overflow-hidden' },
      x.image ? h('img', { class: 'tw:block tw:w-full tw:h-full tw:object-cover tw:object-top', src: artifactUrl(lead.id, x, 'jpg'), alt: '' }) : null),
    h('span', { class: 'tw:min-w-0' },
      h('span', { class: 'tw:flex tw:items-center tw:gap-[6px] tw:text-[14px] tw:text-ink' },
        fresh(x) ? h('i', { class: 'tw:flex-none tw:w-[7px] tw:h-[7px] tw:rounded-full tw:bg-ink', title: 'New since the watch began' }) : null,
        h('span', { class: 'tw:truncate' }, x.title)),
      h('span', { class: 'tw:block tw:text-[12.5px] tw:text-muted' }, `${groupBy === 'newest' ? `Slice ${x.slice} · ` : ''}${when(x.at)}`)));
  const renderGallery = (lead: Agent | undefined) => {
    show(gallery, browsing);
    if (!lead || !browsing) return;
    const groups = exhibitsFor(lead);
    keyed(gallery, JSON.stringify([lead.id, groups, groupBy, opened, [...had]]), () => {
      const by = (b: ExhibitsBy, label: string) => h('button', {
        class: `tw:h-6 tw:px-[10px] tw:border tw:border-solid tw:rounded-none tw:cursor-pointer tw:font-display tw:text-[11.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase ${groupBy === b ? 'tw:bg-ink tw:text-[#111] tw:border-ink' : 'tw:bg-transparent tw:text-muted tw:border-line tw:hover:text-ink'}`,
        attrs: { 'data-part': `by-${b}` }, onclick: () => { groupBy = b; render(); },
      }, label);
      fill(gallery,
        h('div', { class: 'tw:flex-none tw:font-display tw:text-[11px] tw:font-semibold tw:tracking-[.12em] tw:uppercase tw:text-label tw:flex tw:justify-between tw:items-center' },
          h('span', null, `Exhibits · ${lead.name}`),
          h('button', { class: 'tw:bg-transparent tw:border-0 tw:p-0 tw:text-label tw:cursor-pointer tw:font-display tw:text-[11px] tw:tracking-[.12em] tw:uppercase tw:hover:text-ink', onclick: () => browse(false) }, 'Close')),
        h('div', { class: 'tw:flex-none tw:flex tw:gap-[6px]' }, by('slice', 'By slice'), by('newest', 'Newest first')),
        h('div', { class: 'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden tw:flex tw:flex-col tw:gap-4' },
          ...(groups.length
            ? groups.map((g) => h('div', { attrs: { 'data-part': 'group' } },
              h('div', { class: `${TW.label} tw:mb-1` }, g.label),
              ...g.exhibits.map((x) => exhibitRow(x, lead))))
            : [h('div', { class: 'tw:text-muted tw:text-[13.5px]' }, `${lead.name} hasn't put anything up yet.`)])));
    });
  };
  // the exhibit opened from the panel, resting on the sheet above the cards that ask for the captain
  const renderShelf = (lead: Agent) => {
    const x = exhibitsOf({ waypoints: lead.lead?.waypoints ?? [], artifacts: lead.lead?.artifacts ?? [] }, 'newest')[0]?.exhibits.find((e) => e.id === opened);
    keyed(shelf, JSON.stringify([lead.id, x ?? null]), () => fill(shelf, x ? openedEl(lead, x) : null));
  };
  const openedEl = (lead: Agent, x: Exhibit) =>
    h('div', { class: TW.card, attrs: { 'data-part': 'exhibit' } },
      h('div', { class: 'tw:flex tw:justify-between tw:items-center tw:mb-2 tw:gap-2' },
        h('div', { class: `${TW.ch} tw:truncate` }, `Exhibit · ${x.title} · slice ${x.slice}`),
        h('div', { class: 'tw:flex tw:gap-[6px]' },
          h('a', { class: TW.btn, href: artifactUrl(lead.id, x, 'html'), target: '_blank', rel: 'noopener' }, 'New tab'),
          button('Close', false, () => look(null)))),
      x.image
        ? h('img', { class: 'tw:block tw:w-full tw:border tw:border-solid tw:border-hair-card', src: artifactUrl(lead.id, x, 'jpg'), alt: x.title })
        : h('iframe', { class: 'tw:block tw:w-full tw:h-[260px] tw:border-0 tw:bg-white', src: artifactUrl(lead.id, x, 'html'), title: x.title }));

  // the sheet's head: the goal, the lead (Talk), what came in since the watch began, and the strip
  const renderHead = (lead: Agent) => {
    const work = lead.lead;
    const project = focus.project(lead.projectId);
    const from = watchFrom;
    const since = from === undefined ? [] : entries.filter((e) => e.at > from && e.kind !== 'you');
    const shown = work?.artifacts ?? [];
    const unseen = watchFrom === undefined ? 0 : shown.filter((x) => x.at > (watchFrom ?? 0) && !had.has(x.id)).length;
    const says = [plural(since.length, 'update'), ...bundleSays(since)];
    const key = JSON.stringify([lead.id, project?.name, work?.title, lead.name, lead.status, since.length ? says : null, shown.length, unseen, browsing, talking]);
    renderShelf(lead);
    keyed(head, key, () => fill(head,
      h('div', { class: 'tw:grid tw:grid-cols-[1fr_auto_auto_auto] tw:gap-x-3 tw:gap-y-[2px] tw:px-[18px] tw:pt-[14px] tw:pb-[10px] tw:border-b tw:border-solid tw:border-hair-card' },
        h('span', { class: TW.label }, project?.name ?? ''),
        h('span', { class: 'tw:col-start-1 tw:font-display tw:text-[19px]/[1.25] tw:font-semibold tw:tracking-[.02em]' }, work?.title ?? lead.name),
        h('button', {
          class: 'tw:row-span-2 tw:col-start-2 tw:row-start-1 tw:self-center tw:text-[13px] tw:text-muted tw:flex tw:items-center tw:gap-[6px] tw:bg-transparent tw:border-0 tw:p-0 tw:cursor-pointer tw:font-read tw:hover:text-ink',
          title: `Talk to ${lead.name} (T)`, attrs: { 'data-part': 'who' }, onclick: () => talk(!talking),
        }, dotEl(lead), `${lead.name} · ${doing(lead.status)}`),
        h('button', {
          class: 'tw:row-span-2 tw:col-start-3 tw:row-start-1 tw:self-center tw:h-6 tw:px-[10px] tw:border tw:border-solid tw:border-line tw:bg-surface tw:text-ink tw:font-display tw:text-[11.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:rounded-none tw:cursor-pointer tw:hover:bg-surface2',
          title: `View ${lead.name}'s goal in its room: its goal viewing station, tuned to it (B)`, attrs: { 'data-part': 'beam-here' }, onclick: () => ui.goToAgent(lead.id),
        }, 'View in room'),
        h('button', {
          class: `tw:row-span-2 tw:col-start-4 tw:row-start-1 tw:self-center tw:h-6 tw:px-[10px] tw:border tw:border-solid tw:rounded-none tw:cursor-pointer tw:font-display tw:text-[11.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:flex tw:items-center tw:gap-[6px] ${browsing ? 'tw:bg-ink tw:text-[#111] tw:border-ink' : 'tw:bg-surface tw:text-ink tw:border-line tw:hover:bg-surface2'}`,
          title: 'What the lead put up to look at, by slice or newest first (E)', attrs: { 'data-part': 'exhibits' }, onclick: () => browse(!browsing),
        }, `Exhibits · ${shown.length}`, unseen ? h('span', { class: 'tw:normal-case tw:tracking-normal tw:font-read tw:font-medium' }, `${unseen} new`) : null)),
      since.length
        ? h('div', { class: 'tw:mx-[18px] tw:mt-[10px] tw:text-[13px] tw:text-muted tw:flex tw:gap-[14px] tw:whitespace-nowrap tw:overflow-hidden', attrs: { 'data-part': 'since' } },
          h('span', null, `Since your last watch (${clock(from ?? 0)}):`),
          ...says.map((s) => h('b', { class: 'tw:text-ink tw:font-medium' }, s)))
        : null,
      null));
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
    const key = JSON.stringify([lead.id, card ?? null, !!ready, !!a, item?.what, item?.cos, item?.answers, mineLanded.map((i) => i.id), work?.prs, focus.preview(lead.projectId)]);
    keyed(cards, key, () => {
      if (a?.kind === 'turn' && !ready) focus.markRead(a.agent);
      const els: HTMLElement[] = [];
      if (item && a && !ready) {
        settled = { lead: lead.id, el: decisionCard(item, a, lead) };
        els.push(settled.el);
      } else if (settled?.lead === lead.id) els.push(faded(settled.el, lead));
      if (item && ready) els.push(wordCard(item));
      for (const l of mineLanded) els.push(landedCard(l));
      const live = previewCard(lead);
      if (live) els.push(live);
      fill(cards, ...els);
    });
  };

  // a decision answered (from its card, or in the chat) stays where it was, faded and out of reach, until the lead's
  // next one takes its place: it doesn't vanish from under the captain
  const faded = (el: HTMLElement, lead: Agent) => {
    el.inert = true;
    el.classList.add('tw:opacity-40', 'tw:transition-opacity', 'tw:duration-500');
    el.dataset.part = 'answered';
    const heading = el.firstElementChild;
    if (heading) heading.textContent = `Answered · ${lead.name} is on it`;
    return el;
  };

  const several = (item: InboxItem) => (item.cos?.asks.length ?? 0) > 1;
  const decisionCard = (item: InboxItem, a: Attention, lead: Agent) =>
    h('div', { class: TW.card, attrs: { 'data-part': 'decision' } },
      h('div', { class: TW.ch }, several(item) ? `Decisions · ${item.cos?.asks.length} from ${lead.name}` : `Decision · from ${lead.name}`),
      several(item) ? null : h('div', { class: 'tw:text-[16px] tw:mt-[3px] tw:mb-1' }, item.what),
      item.cos ? h('div', { class: 'cos-md tw:text-[14px]/[1.6] tw:text-ink tw:mt-2 tw:max-w-[68ch]', attrs: { 'data-part': 'brief' }, innerHTML: markdownHtml(briefOf(item.cos)) }) : null,
      ...actsEl(item, a, 'tw:mt-[10px]'));

  // a decision's actions (actsOf): Make it so on the pick, the other choices named for what they do, then Discuss (the
  // panel slides in with the decision quoted, and what's said goes to its lead about it) and Got it; their open pull
  // requests fold under More
  // a reply as a choice the width of the card, pressed whole: its name, the words it sends under it, and the
  // chief of staff's pick marked
  const choiceEl = (c: Extract<Act, { kind: 'reply' }>, pick: boolean, item: InboxItem, lead: Agent | undefined, held?: { ask: number; chosen: boolean }) => {
    const mark = held?.chosen ? 'Your answer' : pick ? 'The pick' : '';
    const b: HTMLButtonElement = h('button', {
      class: `tw:block tw:w-full tw:text-left tw:px-3 tw:py-[10px] tw:bg-surface tw:border tw:border-solid tw:rounded-none tw:cursor-pointer tw:font-read tw:transition-colors tw:hover:bg-[#1e232b] tw:hover:border-muted ${mark ? 'tw:border-ink' : 'tw:border-line'}`,
      title: held ? `Answer this with it: held until every one is answered, then all go to ${lead?.name ?? 'the lead'} together` : `Send this to ${lead?.name ?? 'the lead'}`,
      attrs: { 'data-part': 'choice', 'data-act': 'reply', ...(held?.chosen && { 'data-chosen': '' }) },
      onclick: () => void busy(b, () => (held ? answer(item, held.ask, c.text) : run(c, item, lead)), ui.error),
    },
      h('span', { class: 'tw:flex tw:items-center tw:gap-2' },
        h('span', { class: 'tw:font-display tw:text-[12px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:text-ink' }, c.label),
        mark ? h('span', { class: 'tw:font-display tw:text-[10.5px] tw:font-semibold tw:tracking-[.1em] tw:uppercase tw:text-[#111] tw:bg-ink tw:px-[6px] tw:py-px' }, mark) : null),
      h('span', { class: 'tw:block tw:mt-1 tw:text-[13.5px]/[1.5] tw:text-muted' }, c.text));
    return b;
  };
  // an answer to one of a turn's asks: held (on the turn, so a reload or a restart keeps it) until every ask has one,
  // then all of them go to the lead as one message. The goal's decision card is drawn again with it at once, so the
  // last answer shows on the card as it fades once they've gone (the inbox then has the turn no more)
  const answer = (item: InboxItem, ask: number, text: string) => {
    const lead = item.agentId ? focus.agent(item.agentId) : undefined;
    const next = answerAsk(item.cos?.asks ?? [], item.answers ?? [], { ask, text });
    if (lead && next.kind !== 'refuse' && settled?.lead === lead.id && settled.el.isConnected) {
      const el = decisionCard({ ...item, answers: next.answers }, { kind: 'turn', agent: lead }, lead);
      settled.el.replaceWith(el);
      settled = { lead: lead.id, el };
    }
    return inbox.decide(item.id, { answer: { ask, text } }).then(refreshInbox);
  };
  // one of a turn's asks, a block of its own: its headline, its replies (its answer marked, and changeable until the
  // last is answered), and a line for the user's own words
  const askEl = (b: AskBlock, item: InboxItem, lead: Agent | undefined) => {
    const own = h('input', {
      class: 'tw:flex-1 tw:min-w-0 tw:h-7 tw:px-2 tw:bg-surface tw:border tw:border-solid tw:border-line tw:text-ink tw:font-read tw:text-[13px] tw:rounded-none',
      placeholder: b.answer !== undefined && !b.picked ? b.answer : 'Or answer in your own words…', attrs: { 'data-part': 'own-answer' },
    });
    const hold = button('Answer', false, () => {
      const words = own.value.trim();
      if (words) void busy(hold, () => answer(item, b.index, words), ui.error);
    }, 'Held until every one is answered, then all go together');
    own.onkeydown = (e) => { if (e.key === 'Enter') hold.click(); };
    return h('div', { class: `tw:mt-3 tw:pl-3 tw:border-0 tw:border-l-2 tw:border-solid ${b.answer !== undefined ? 'tw:border-ink' : 'tw:border-attn'}`, attrs: { 'data-part': 'ask', ...(b.answer !== undefined && { 'data-answered': '' }) } },
      h('div', { class: 'tw:flex tw:items-baseline tw:gap-2' },
        h('span', { class: 'tw:text-[15px] tw:flex-1' }, b.ask),
        h('span', { class: `tw:font-display tw:text-[10.5px] tw:font-semibold tw:tracking-[.1em] tw:uppercase ${b.answer !== undefined ? 'tw:text-ink' : 'tw:text-attn'}` }, b.answer !== undefined ? 'Answered' : 'To answer')),
      h('div', { class: 'tw:flex tw:flex-col tw:gap-2 tw:mt-2' }, ...b.choices.map((c) => choiceEl(c, false, item, lead, { ask: b.index, chosen: c.label === b.picked }))),
      b.answer !== undefined && !b.picked ? h('div', { class: 'tw:mt-2 tw:text-[13.5px]', attrs: { 'data-part': 'held' } }, h('span', { class: 'tw:text-muted' }, 'Your answer: '), b.answer) : null,
      h('div', { class: 'tw:flex tw:gap-[6px] tw:mt-2' }, own, hold));
  };
  const actsEl = (item: InboxItem, a: Attention, gap: string): HTMLElement[] => {
    const lead = 'agent' in a ? a.agent : undefined;
    const q = lead && a.kind === 'question' ? openQuestion(lead) : undefined;
    const merges = lead ? mergesOf(ui, lead) : [];
    const req = lead?.permission;
    // the lead's own read of the turn, or the inbox's when the lead has moved on since (a card drawn again as it's answered)
    const asks = a.kind === 'turn' ? readOf(lead)?.judged?.asks ?? item.cos?.asks ?? [] : [];
    const acts = actsOf({
      kind: a.kind, lead: lead?.id, replies: asks.length === 1 ? asks[0]?.replies : undefined, prs: merges.length,
      ...(q && { question: q }), ...(req && { permission: { id: req.id, tool: req.tool } }),
    });
    const press = (act: Act, go: boolean) => {
      const b = button(act.label, go, () => void busy(b, () => run(act, item, lead), ui.error));
      b.dataset.act = act.kind;
      return b;
    };
    const quiet = (label: string, title: string, onclick: () => void) =>
      h('button', { class: 'tw:bg-transparent tw:border-0 tw:px-1 tw:h-6 tw:text-muted tw:font-display tw:text-[11.5px] tw:font-semibold tw:tracking-[.08em] tw:uppercase tw:cursor-pointer tw:hover:text-ink', title, onclick }, label);
    const got = quiet('Got it', 'Read: off your queue until their next turn. Nothing is sent', () => void busy(got, () => inbox.decide(item.id, { ack: true }).then(refreshInbox), ui.error));
    // a reply is drawn with the words it sends beside it: a short label alone can't say what it decides
    const isReply = (x: Act | undefined): x is Extract<Act, { kind: 'reply' }> => x?.kind === 'reply';
    const choices = [acts.go, ...acts.others].filter(isReply);
    const buttons = [acts.go, ...acts.others].filter((x): x is Act => !!x && !isReply(x));
    // a turn of several asks: a block each, answered on its own, and where they stand
    const held = asks.length > 1 ? askBlocksOf(asks, item.answers ?? [], lead?.name ?? 'the lead') : undefined;
    return [
      h('div', { class: `tw:flex tw:flex-col tw:gap-2 ${gap}`, attrs: { 'data-part': 'acts' } },
        ...(held ? held.blocks.map((b) => askEl(b, item, lead)) : []),
        held ? h('div', { class: 'tw:mt-2 tw:text-[12.5px] tw:text-muted', attrs: { 'data-part': 'asks-status' } }, held.status) : null,
        ...choices.map((c) => choiceEl(c, c === acts.go, item, lead)),
        h('div', { class: 'tw:flex tw:flex-wrap tw:items-center tw:gap-[6px]' },
          ...buttons.map((b) => press(b, b === acts.go)),
          h('span', { class: 'tw:flex-1' }),
          lead ? quiet('Discuss', `Talk it over with ${lead.name}: what you say goes to them about this`, () => discuss(item, lead.id)) : null,
          acts.ack ? got : null)),
      acts.more
        ? h('details', { class: 'tw:mt-2 tw:text-[12.5px] tw:text-muted' }, h('summary', { class: 'tw:cursor-pointer tw:hover:text-ink' }, 'More · their pull requests'),
          h('div', { class: 'cos-acts tw:mt-2' }, ...merges))
        : null,
    ].filter((e) => e !== null);
  };
  const run = (act: Act, item: InboxItem, lead: Agent | undefined): Promise<unknown> => {
    switch (act.kind) {
      case 'reply': return inbox.decide(item.id, { text: act.text }).then(refreshInbox);
      case 'pick': return answerLead(act.lead, act.question, act.option);
      case 'allow':
      case 'decline': return allowTool(act.lead, act.request, act.kind === 'allow');
      case 'close-goal': return lead ? closeGoal(lead) : Promise.resolve();
      case 'prs': return Promise.resolve(ui.openBoard(item.projectId, 'prs'));
    }
  };
  // Discuss: at the conn of the decision's goal, the panel in, the decision quoted at its top
  const discuss = (item: InboxItem, leadId: string) => {
    if (conn !== leadId) take(leadId);
    discussing = { id: item.id, what: item.what };
    talk(true);
  };

  // words the chief of staff has ready for the lead: sent with a press, or heard (Got it), nothing sent
  const wordCard = (item: InboxItem) => {
    const send = button('Send', true, () => void busy(send, () => inbox.decide(item.id, { send: true }).then(refreshInbox), ui.error));
    const got = button('Got it', false, () => void busy(got, () => inbox.decide(item.id, { ack: true }).then(refreshInbox), ui.error));
    return h('div', { class: TW.card, attrs: { 'data-part': 'word' } },
      h('div', { class: TW.ch }, 'Word ready · the chief of staff'),
      h('div', { class: 'tw:text-[13.5px] tw:mt-[3px]' }, item.cos?.message ?? item.what),
      h('div', { class: 'tw:flex tw:gap-[6px] tw:mt-[10px]' }, got, send));
  };

  const landedCard = (l: LandedItem) => {
    const got = button('Got it', false, () => void busy(got, () => inbox.decideLanded(l.id, { ack: true }).then(refreshInbox), ui.error));
    return h('div', { class: `${TW.card} tw:flex tw:items-center tw:gap-3`, attrs: { 'data-part': 'landed' } },
      h('div', { class: 'tw:flex-1 tw:min-w-0' }, h('div', { class: TW.ch }, 'Landed in Show'), h('div', { class: 'tw:text-[13.5px] tw:truncate' }, landedWhere(l))),
      got);
  };

  // the lead's preview, while one runs: a link to each system it runs (web, admin, api…), named as the preview names
  // it, with whether it's answering
  const previewCard = (lead: Agent): HTMLElement | null => {
    const preview = previewFor(focus.preview(lead.projectId), [...(lead.lead?.landed ?? []), ...(lead.lead?.prs ?? [])]);
    const links = preview?.status === 'running' ? preview.links : [];
    if (!links.length) return null;
    const health = { up: 'tw:bg-[#46a758]', error: 'tw:bg-attn', down: 'tw:bg-[#e5484d]' };
    return h('div', { class: `${TW.card} tw:flex tw:flex-wrap tw:items-center tw:gap-[6px]`, attrs: { 'data-part': 'preview' } },
      h('div', { class: `${TW.ch} tw:flex-1 tw:min-w-[140px]` }, 'Their preview is running'),
      ...links.map((l) => h('a', {
        class: `${TW.btn} tw:gap-[6px] tw:no-underline`, href: l.url, target: '_blank', rel: 'noopener',
        title: `${l.url}${l.health ? ` · ${l.health}${l.code ? ` (${l.code})` : ''}` : ''}`,
      },
        l.health ? h('i', { class: `tw:w-[7px] tw:h-[7px] tw:rounded-full ${health[l.health]}` }) : null,
        l.name ?? new URL(l.url).host)));
  };

  // the muster: what waits outside the goal at the conn, by what each unblocks, and the reports at its foot
  const renderMuster = (all: readonly Filed[]) => {
    const rows = musterOrder(all.filter((f) => f.reach === 'muster' || f.reach === 'hail'));
    const started = startedNow();
    const words = all.filter((f) => f.reach === 'report');
    const heard = landed.filter((i) => !(conn && i.leadId === conn));
    const key = JSON.stringify([rows.map((r) => [r.item.id, r.stoodBy, r.idle]), started.map((s) => [s.key, s.at, titleOf(s)]), words.map((r) => r.item.id), heard.map((i) => i.id), expanded]);
    if (muster.dataset.key === key) return;
    muster.dataset.key = key;
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const reports = words.length + heard.length;
    fill(muster,
      h('div', { class: 'tw:flex tw:justify-between tw:items-baseline' },
        h('b', { class: 'tw:font-display tw:text-[19px] tw:font-semibold tw:tracking-[.02em]' }, `Muster · ${plural(rows.length + started.length, 'decision')}${reports ? `, ${plural(reports, 'report')}` : ''}`),
        h('span', { class: 'tw:text-muted tw:text-[12.5px]' }, 'by what each unblocks')),
      ...rows.map((f) => musterRow(f, local.get(f.item.id))),
      ...started.map(startedRow),
      reports ? reportsRow(words, heard) : null,
      rows.length || started.length || reports ? null : h('div', { class: 'tw:mt-3 tw:text-muted tw:text-[13.5px]' }, 'Nothing waits on you.'));
  };

  // a row of the muster: what it's part of, what's needed (in words, or words and a press), and its answers
  const row = (part: 'row' | 'reports' | 'started', g: string, w: string | (string | HTMLElement)[], why: string | null, acts: HTMLElement[], more: HTMLElement | null = null) =>
    h('div', { class: 'tw:grid tw:grid-cols-[4px_1fr_auto] tw:gap-3 tw:items-center tw:py-[10px] tw:pr-3 tw:pl-0 tw:mt-2 tw:bg-surface2 tw:border tw:border-solid tw:border-hair-card', attrs: { 'data-part': part } },
      h('span', { class: `tw:self-stretch ${part === 'reports' ? 'tw:bg-line' : 'tw:bg-attn'}` }),
      h('div', { class: 'tw:min-w-0' },
        h('div', { class: 'tw:font-display tw:text-[9.5px] tw:font-semibold tw:tracking-[.12em] tw:uppercase tw:text-label' }, g),
        h('div', { class: 'tw:text-[13.5px] tw:truncate', title: typeof w === 'string' ? w : w.map((x) => (typeof x === 'string' ? x : x.textContent)).join('') }, ...[w].flat()),
        why ? h('div', { class: 'tw:text-[12px] tw:text-muted' }, why) : null),
      h('div', { class: 'tw:flex tw:gap-[6px]' }, ...acts),
      more);

  const musterRow = (f: Filed, a: Attention | undefined) => {
    const isOpen = expanded === f.item.id;
    const tag = f.grade === 'hail' ? (f.stoodBy ? ' · hail, stood by' : ' · hail') : '';
    const toggle = a ? [button(isOpen ? 'Close' : 'Open', false, () => { expanded = isOpen ? null : f.item.id; render(); })] : [];
    return row('row', `${f.item.goal}${tag}`, f.item.what, unblocks(f), toggle,
      isOpen && a ? h('div', { class: 'tw:col-start-2 tw:col-span-2' }, ...actsEl(f.item, a, '')) : null);
  };

  // a goal the chief of staff started from its direct line, until the user hears of it (Got it) or closes it (its
  // undo, as the line's Close: Focus warns first about work that would be lost); its goal is a press away, at the conn
  const titleOf = (s: LineStart) => focus.agent(s.leadId)?.lead?.title ?? s.text;
  const startedRow = (s: LineStart) => {
    const title = titleOf(s);
    const shut = button('Close', false, () => void busy(shut, () => closeStarted(s), ui.error), 'Close the goal it started: its undo');
    const got = button('Got it', false, () => void busy(got, () => callPlugin(CHIEF_OF_STAFF, '/line/ack', { key: s.key }), ui.error), 'Heard: the goal runs on');
    const goal = h('button', {
      class: 'tw:bg-transparent tw:border-0 tw:p-0 tw:text-ink tw:font-semibold tw:cursor-pointer tw:font-read tw:text-[13.5px] tw:hover:underline',
      title: `Take the conn: ${title}`, onclick: () => take(s.leadId),
    }, title);
    return row('started', `${title} · started`, [`${SENDER} started `, goal, ` in ${s.project}: ${s.why}`], null, [shut, got]);
  };

  // the reports, in a row: heard with one press, nothing sent
  const reportsRow = (words: readonly Filed[], heard: readonly LandedItem[]) => {
    const says = [heard.length ? `${plural(heard.length, 'slice')} landed in Show` : '', words.length ? `${plural(words.length, 'word')} ready from the chief of staff` : ''].filter(Boolean).join(' · ');
    const got = button('Got it', false, () => void busy(got, () => Promise.all([
      ...words.map((f) => inbox.decide(f.item.id, { ack: true })),
      ...heard.map((i) => inbox.decideLanded(i.id, { ack: true })),
    ]).then(refreshInbox), ui.error));
    return row('reports', `Reports · ${words.length + heard.length}`, says, null, [got]);
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
    const ht = h('div', { class: 'tw:text-[13.5px] tw:mt-[2px]' }, f.item.what);
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
      f.item.cos?.message ? h('div', { class: 'tw:text-[12.5px] tw:text-muted tw:mt-[6px]' }, f.item.cos.message) : null,
      h('div', { class: 'tw:mt-2' }, standBy),
      ...(a ? actsEl(f.item, a, 'tw:mt-2') : []));
  };

  // the panel, slid in from the right to talk to the lead: their words and the captain's, and the box
  const renderTalk = (lead: Agent | undefined) => {
    // opening, the panel shows the lead's latest words from their start (what's being asked), once there are some
    if (talking && panel.classList.contains('tw:hidden')) findLatest = true;
    show(panel, talking);
    viewer.classList.toggle('tw:right-3', !talking && !browsing);
    viewer.classList.toggle('tw:right-[484px]', talking || browsing);
    if (!lead) return;
    const close = h('button', { class: 'tw:bg-transparent tw:border-0 tw:p-0 tw:text-label tw:cursor-pointer tw:font-display tw:text-[11px] tw:tracking-[.12em] tw:uppercase tw:hover:text-ink', onclick: () => talk(false) }, 'Close');
    fill(talkHead, h('span', null, `Comms · ${lead.name}`), close);
    show(topic, !!discussing);
    fill(topic, discussing ? h('div', null, h('small', { class: 'tw:block tw:text-[12.5px] tw:text-muted' }, 'Discussing'), discussing.what) : null);
    box.placeholder = `Talk to ${lead.name}`;
    const key = `${lead.id}|${entries.at(-1)?.at ?? 0}|${entries.length}`;
    if (said.dataset.key !== key) drawSaid(lead, key);
    if (!findLatest || !talking || !entries.length) return;
    findLatest = false;
    const latest = [...said.querySelectorAll<HTMLElement>('[data-from=lead]')].at(-1);
    said.scrollTop = latest ? latest.offsetTop - said.offsetTop : said.scrollHeight;
  };
  const drawSaid = (lead: Agent, key: string) => {
    said.dataset.key = key;
    fill(said, ...conversation(entries).map((e) => {
      // what Ops, QA, the chief of staff or the scheduler told them: folded to a line, opening to all of it
      if (e.kind === 'ops') return collapsedMessage({ id: `${e.from}@${e.at}`, head: `${e.from} told ${lead.name} · ${clock(e.at)}`, text: e.text, open: unfolded, part: 'told' });
      const text = h('div', { class: 'cos-md' });
      text.innerHTML = markdownHtml(e.kind === 'lead' || e.kind === 'you' ? e.text : '');
      return h('div', { class: `tw:text-[14.5px]/[1.65] ${e.kind === 'you' ? 'tw:pl-3 tw:border-0 tw:border-l-2 tw:border-solid tw:border-line' : ''}`, attrs: { 'data-from': e.kind } },
        h('small', { class: 'tw:block tw:text-[12.5px] tw:text-muted tw:mb-1' }, `${e.kind === 'you' ? 'You' : lead.name} · ${clock(e.at)}`), text);
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
    const about = discussing;
    discussing = null;
    render();
    void messageAgent(lead.id, lead.name, about ? aboutIt(about.what, words) : words).then(() => refreshThread(), (err: Error) => {
      box.value = words;
      discussing = about;
      render();
      ui.error(err.message);
    });
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
    renderGallery(lead);
    show(muster, mustering);
    if (mustering) renderMuster(all);
    const onLine = lining && !mustering;
    show(line.el, onLine);
    if (onLine) line.render();
    show(viewer, !mustering && !onLine && !!lead);
    show(empty, !mustering && !onLine && !lead);
    if (!lead || mustering || onLine) return;
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

  // the bridge's keys: M stands down (or brings the muster up), T talks (Esc stops), B beams to the lead at the conn,
  // 1–9 take the conn of a berth, 0 the direct line to the chief of staff
  const keys = (e: KeyboardEvent) => {
    // Esc puts the panel away before it closes Comms
    if (e.key === 'Escape' && talking) {
      e.preventDefault();
      e.stopPropagation();
      return talk(false);
    }
    // then the exhibit open on the sheet, then their panel
    if (e.key === 'Escape' && (opened || browsing)) {
      e.preventDefault();
      e.stopPropagation();
      return opened ? look(null) : browse(false);
    }
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const berth = /^Digit([1-9])$/.exec(e.code);
    if (e.code === 'KeyM') muster_();
    else if (e.code === 'KeyT') talk(!talking);
    else if (e.code === 'KeyB' && conn) ui.goToAgent(conn);
    else if (e.code === 'KeyE' && conn) browse(!browsing);
    else if (e.code === 'Digit0') takeLine();
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
