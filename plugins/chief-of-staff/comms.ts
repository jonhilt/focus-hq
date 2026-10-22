import { fill, focus, h, LCARS, type Ui, viaNote } from '../../plugin-api/client';
import type { Attention } from '../../plugin-api/shared';
import { focusIndex, keptOrder } from './briefing';
import { COMMS_KEYS, commsKey } from './commsKeys';
import { agentOfDecision, byGoal, decidedBy, decidedByCaptain, lanes, perProject, readingLine, sendsIn, sentByCos, stepped, tagOf, trayLine as trayLineText, waited } from './commsList';
import { waitingNow } from './here';
import { type DecisionEvent, hailKey as keyOf, type InboxItem } from './inbox';
import { inbox } from './inboxApi';
import type { LandedItem } from './landed';
import { landedCard, landedRow } from './landedCard';
import { decidedCard, needCard, TONE } from './needCard';
import { readOf } from './shared';

/** How many of the captain's recent decisions Comms lists. */
const DECIDED_SHOWN = 6;

/** The item the captain had picked when Comms last closed: it opens on it again, while it's still waiting. */
let kept: string | null = null;
/** The project the list was narrowed to when Comms last closed, if it was. */
let keptProject: string | null = null;

/** Its read of a lead's turn, for anything else nothing. */
const readOfHail = (a: Attention | undefined) => (a?.kind === 'turn' ? readOf(a.agent) : undefined);

/** What the reading pane shows for a hail: rebuilt only when that changes (it's judged since, or held), so a reply being written isn't wiped. */
const showingOf = (id: string, a: Attention): string => `${id}|${readOfHail(a)?.judged?.route ?? ''}|${readOfHail(a)?.sendsAt ?? ''}`;

/** The colour down an item's edge: an interrupt is red, a card gold, anything else its kind's. */
const toneOf = (i: InboxItem): string => (i.cos?.route === 3 ? LCARS.red : i.cos?.route === 2 ? LCARS.gold : TONE[i.kind]);

/** Who, as the list says it: a lead without their rank. */
const shortWho = (who: string): string => who.replace(/^Lt\. /, '');

/** One line of the list, under its goal: what it asks in a word, what's needed, and how long it's waited. */
function itemRow(i: InboxItem, pick: () => void): HTMLElement {
  return h('button', { class: 'cos-need cos-inbox-row', style: `--tone:${toneOf(i)}`, onclick: pick },
    h('div', { class: 'cos-inbox-row-head' },
      h('span', { class: 'cos-inbox-tag' }, tagOf(i)),
      h('span', { class: 'cos-need-what', title: i.what }, i.what),
      i.since ? h('small', { class: 'muted' }, waited(i.since, Date.now())) : null,
    ),
    h('small', { class: 'cos-need-sends' }),
  );
}

/** The list's rows under a heading each for their goal and who's on it. */
const grouped = (list: readonly InboxItem[], rowOf: (it: InboxItem) => HTMLElement | undefined): HTMLElement[] =>
  byGoal(list).flatMap((g) => [
    h('div', { class: 'cos-inbox-goal-head', title: g.goal }, h('span', { class: 'cos-inbox-goal' }, g.goal), h('small', { class: 'muted' }, ` · ${shortWho(g.who)}`)),
    ...g.items.flatMap((it) => rowOf(it) ?? []),
  ]);

/** Something decided lately: the goal and when, then what was said, and who said it; pressed, it's brought back up. */
function decidedRow(d: DecisionEvent, pick: () => void): HTMLElement {
  const via = viaNote(d.via);
  return h('button', { class: 'cos-decided', title: `${d.item.what}${via ? ` (${via})` : ''}: press to bring it back up`, onclick: pick },
    h('div', { class: 'cos-inbox-row-head' }, h('span', { class: 'cos-inbox-goal' }, d.goal ?? d.agent), h('small', { class: 'muted' }, `· ${waited(d.at, Date.now())}`)),
    h('div', { class: 'cos-decided-answer' }, `${decidedBy(d)}: “${d.answer}”`),
  );
}

/** What Comms asks of the app: its panel, and the panels it goes on to (an agent's, a board, the goals, a lead's screen). */
export type CommsUi = Pick<Ui, 'openAgent' | 'openBoard' | 'openGoals' | 'openScreen' | 'goToAgent' | 'error'> & { panels: Pick<Ui['panels'], 'open' | 'own' | 'backTo'> };

/** Whether a key comes from the captain writing in a field, where Comms' keys don't count. */
const typingIn = (target: EventTarget | null): boolean => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

/**
 * Comms, opened from anywhere with C and from the captain's chair with E: the captain's inbox (inbox.ts),
 * read from Focus as a bot reads it, so both see the same. Along the top each project with what waits there, to
 * narrow the list to it. On the left what the chief of staff flags for the captain, under a heading each for its goal,
 * the most urgent goal first, then what they decided lately (each brought back up on the right when pressed), then its tray: the turns it has words ready for, and what it sent by itself today. On the right the
 * one picked, large: the goal, what to read to decide, and the answers. Answered, it leaves the list and the next one's
 * picked. Picking a lead's turn reads it, as their panel does. The list keeps its order while it's open (`keptOrder`),
 * so nothing moves under the pointer.
 */
export function openComms(ui: CommsUi): void {
  let picked: string | null = kept;
  let project: string | null = keptProject;
  let shown: string | null = null;
  let at = 0;
  let order: string[] = [];
  let open: InboxItem[] = [];
  let decidedLately: DecisionEvent[] = [];
  // what landed in Show for the captain to hear of, and the one of them picked, shown instead of a hail
  let landedNow: LandedItem[] = [];
  let pickedLanded: string | null = null;
  // a decision brought back up to read again, by its ledger line, shown instead of a hail
  let pickedDecided: number | null = null;
  let trayOpen = false;
  const rows = new Map<string, HTMLElement>();
  // from Comms to an agent's panel, Esc comes back to it
  const back = () => ui.panels.backTo('Comms', () => openComms(ui));
  const openAgent = (id: string) => {
    ui.openAgent(id);
    back();
  };
  const tabs = h('div', { class: 'cos-comms-tabs' });
  const queueHead = h('h3');
  const queue = h('div', { class: 'cos-needs' });
  const reading = h('small', { class: 'muted cos-reading' });
  const landedHead = h('h3');
  const landedList = h('div', { class: 'cos-needs cos-landed' });
  const decidedHead = h('h3', null, 'Recently decided');
  const decided = h('div', { class: 'cos-decided-list' });
  const trayLine = h('button', { class: 'cos-tray-line', title: 'The turns the chief of staff carries on or sends back: its words, ready to send', onclick: () => { trayOpen = !trayOpen; render(); } });
  const tray = h('div', { class: 'cos-needs cos-tray' });
  const keysHint = h('small', { class: 'muted cos-comms-keys' }, COMMS_KEYS);
  const detail = h('div', { class: 'cos-inbox-detail' });
  const body = h('div', { class: 'cos-comms' },
    tabs,
    h('div', { class: 'cos-inbox-left' }, queueHead, queue, reading, landedHead, landedList, decidedHead, decided, trayLine, tray, keysHint),
    h('div', { class: 'cos-inbox-right' }, detail),
  );

  // along the top, each shown project with what waits there, to narrow the list to it, and the goals
  const renderTabs = (counts: Map<string, number>) => fill(tabs,
    ...focus.shown.map((p) =>
      h('button', { class: `cos-comms-tab${project === p.id ? ' on' : ''}`, style: `--tone:${p.color}`, title: project === p.id ? 'Show every project' : `Only ${p.name}`, onclick: () => { project = keptProject = project === p.id ? null : p.id; render(); } },
        p.name, counts.get(p.id) ? h('b', null, String(counts.get(p.id))) : null)),
    h('button', { class: 'cos-comms-tab goals', title: 'The goals: start one, see the line and the closed ones', onclick: () => {
      // its panel has its own way back out here (`everyGoal`)
      ui.openGoals(project ?? focus.shown[0]?.id ?? '');
    } }, 'Goals ›'),
  );

  // a row is built once per item and kept, so the list isn't rebuilt under the pointer
  const renderRows = (items: InboxItem[], ready: InboxItem[], pickable: InboxItem[], selected: string | undefined, local: Map<string, Attention>, now: number) => {
    const rowKey = (it: InboxItem) => `${it.id}|${it.lane}`;
    const next = new Map(pickable.map((it) => [rowKey(it), rows.get(rowKey(it)) ?? itemRow(it, () => { picked = it.id; pickedLanded = pickedDecided = null; render(); })] as const));
    for (const it of pickable) {
      const row = next.get(rowKey(it));
      row?.classList.toggle('read', !!it.read);
      row?.classList.toggle('sel', it.id === selected);
      const sends = row?.querySelector('.cos-need-sends');
      if (sends) sends.textContent = sendsIn(readOfHail(local.get(it.id))?.sendsAt, now);
    }
    if ([...next.keys()].join('|') !== [...rows.keys()].join('|') || !queue.childElementCount) {
      const rowsOf = (list: InboxItem[]) => grouped(list, (it) => next.get(rowKey(it)));
      fill(queue, ...(items.length ? rowsOf(items) : [h('p', { class: 'muted' }, '✓ Nothing needs you.')]));
      fill(tray, ...(trayOpen ? rowsOf(ready) : []));
    }
    rows.clear();
    for (const [k, row] of next) rows.set(k, row);
  };

  // under the list: what landed in Show for the captain to hear of, a card each, nothing waiting on them
  const renderLanded = () => {
    const mine = landedNow.filter((l) => !project || l.projectId === project);
    landedHead.hidden = landedList.hidden = !mine.length;
    landedHead.textContent = `Landed in Show · ${mine.length}`;
    fill(landedList, ...mine.map((l) => {
      const row = landedRow(l, () => { pickedLanded = l.id; pickedDecided = null; render(); });
      row.classList.toggle('sel', l.id === pickedLanded);
      return row;
    }));
    return mine.find((l) => l.id === pickedLanded);
  };

  // under the list: what the captain decided lately, then the chief of staff's tray line
  const renderFoot = (ready: number, now: number) => {
    const line = trayLineText(ready, sentByCos(decidedLately, new Date(now).setHours(0, 0, 0, 0)), trayOpen);
    trayLine.hidden = !line;
    trayLine.textContent = line;
    const mine = decidedByCaptain(decidedLately, project, DECIDED_SHOWN);
    decidedHead.hidden = decided.hidden = !mine.length;
    fill(decided, ...mine.map((d) => {
      const row = decidedRow(d, () => { pickedDecided = d.seq; pickedLanded = null; render(); });
      row.classList.toggle('sel', d.seq === pickedDecided);
      return row;
    }));
    return mine.find((d) => d.seq === pickedDecided);
  };

  // on the right, the one picked, large; picking a lead's turn reads it
  const renderDetail = (id: string | undefined, a: Attention | undefined) => {
    if (!id) {
      picked = shown = kept = null;
      fill(detail, h('div', { class: 'cos-card cos-card-clear' }, h('div', { class: 'cos-card-what' }, h('span', null, '✓'), 'Nothing needs you.')));
      return;
    }
    picked = kept = id;
    if (!a || showingOf(id, a) === shown) return;
    shown = showingOf(id, a);
    if (a.kind === 'turn') focus.markRead(a.agent);
    fill(detail, needCard(ui, a, openAgent));
  };

  const render = (step = 0) => {
    const now = Date.now();
    const local = new Map(waitingNow(now).map((a) => [keyOf(a), a]));
    // only what Focus's inbox has, and this browser knows of (a bot's answer can land before this browser hears)
    const known = open.filter((i) => local.has(i.id));
    const { flagged, ready, reading: judging } = lanes(known, project);
    const keys = (order = keptOrder(order, flagged.map((i) => i.id)));
    const byId = new Map(known.map((i) => [i.id, i]));
    // in the order they're shown, under their goals, so J and K go down the list as it reads
    const items = byGoal(keys.flatMap((k) => byId.get(k) ?? [])).flatMap((g) => g.items);
    const trayItems = byGoal(ready).flatMap((g) => g.items);
    // the tray's rows are picked like the list's, when it's open
    const pickable = [...items, ...(trayOpen ? trayItems : [])];
    const ids = pickable.map((i) => i.id);
    const i = focusIndex(ids, step ? null : picked, stepped(at, step, ids.length));
    if (i >= 0) at = i;

    renderTabs(perProject(lanes(known, null).flagged));
    queueHead.textContent = items.length ? `Needs you · ${items.length}` : 'Needs you';
    reading.textContent = readingLine(judging);
    reading.hidden = !judging;
    // moving through the queue leaves the landed card for the hail
    if (step) pickedLanded = pickedDecided = null;
    const landedPick = renderLanded();
    const decidedPick = renderFoot(ready.length, now);
    renderRows(items, trayItems, pickable, landedPick || decidedPick ? undefined : ids[i], local, now);
    if (decidedPick) {
      const key = `decided:${decidedPick.seq}`;
      if (shown !== key) fill(detail, decidedCard(ui, decidedPick, agentOfDecision(decidedPick), openAgent));
      shown = key;
      return;
    }
    if (landedPick) {
      if (shown !== landedPick.id) fill(detail, landedCard(ui, landedPick, () => { pickedLanded = null; refresh(); }));
      shown = landedPick.id;
      return;
    }
    renderDetail(ids[i], local.get(ids[i]));
  };

  // the inbox is Focus's, asked for again (at most every quarter second) whenever anything it's made of changes
  let asking: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(asking);
    asking = setTimeout(() => void inbox.view().then((view) => {
      open = view.open.filter((i) => !focus.isHidden(i.projectId));
      decidedLately = view.decided.filter((d) => !focus.isHidden(d.projectId));
      landedNow = view.landed.filter((l) => !focus.isHidden(l.projectId));
      render();
    }, () => undefined), 250);
  };

  // G: the one picked's own place, an agent's panel or a pull request's board
  const openPicked = () => {
    const a = waitingNow().find((n) => keyOf(n) === picked);
    if (!a) return;
    if ('agent' in a) return openAgent(a.agent.id);
    ui.openBoard(a.projectId);
    back();
  };

  // by keyboard (commsKeys.ts): never while the captain is writing in the pane
  const onKey = (e: KeyboardEvent) => {
    const act = commsKey(e, typingIn(e.target));
    if (!act) return;
    e.preventDefault();
    if ('move' in act) return render(act.move);
    if ('press' in act) return detail.querySelector<HTMLButtonElement>(`[data-act="${act.press}"]:not(:disabled)`)?.click();
    if ('reply' in act) return detail.querySelector('textarea')?.focus();
    openPicked();
  };

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  window.addEventListener('keydown', onKey);
  ui.panels.own(() => window.removeEventListener('keydown', onKey));
  decidedHead.hidden = decided.hidden = trayLine.hidden = landedHead.hidden = landedList.hidden = true;
  render();
  refresh();
  // what the chief of staff has been reading a minute comes out of hiding by itself, and the countdowns move on
  const tick = setInterval(refresh, 5000);
  ui.panels.own(() => {
    clearInterval(tick);
    clearTimeout(asking);
  });
  ui.panels.own(focus.onShip(refresh));
}
