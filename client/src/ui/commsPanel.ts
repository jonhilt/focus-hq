import type { DecisionEvent, InboxItem } from '../../../shared/captainsInbox';
import { type Attention } from '../../../shared/tricorder';
import { viaNote } from '../../../shared/ledger';
import { api } from '../net/api';
import { markRead } from '../net/attention';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { focusIndex, keptOrder } from './briefing';
import type { Ui } from './context';
import { fill, h } from './dom';
import { COMMS_KEYS, commsKey } from './commsKeys';
import { decidedBy, lanes, perProject, sentByCos, tagOf, waited } from './commsList';
import { keyOf, needCard, needs, openFromComms, TONE } from './needCard';

/** How many of the captain's recent decisions Comms lists. */
const DECIDED_SHOWN = 6;

/** The item the captain had picked when Comms last closed: it opens on it again, while it's still waiting. */
let kept: string | null = null;
/** The project the list was narrowed to when Comms last closed, if it was. */
let keptProject: string | null = null;

/** When the chief of staff's words go by themselves, on the tray's line: to the minute, as the line is redrawn every few seconds. */
const sendsIn = (a: Attention | undefined, now: number): string => {
  const at = a?.kind === 'turn' ? a.agent.lead?.cos?.sendsAt : undefined;
  if (at === undefined) return '';
  const min = Math.ceil((at - now) / 60_000);
  return min > 1 ? `⏱ sends itself in ${min} min` : '⏱ sends itself within a minute';
};

/** The colour down an item's edge: an interrupt is red, a card gold, anything else its kind's. */
const toneOf = (i: InboxItem): string => (i.cos?.route === 3 ? LCARS.red : i.cos?.route === 2 ? LCARS.gold : TONE[i.kind]);

/** One line of the list: what it asks in a word, the goal, who and how long it's waited, then what's needed. */
function itemRow(i: InboxItem, pick: () => void): HTMLElement {
  return h('button', { class: 'need inbox-row', style: `--tone:${toneOf(i)}`, onclick: pick },
    h('div', { class: 'inbox-row-head' },
      h('span', { class: 'inbox-tag' }, tagOf(i)),
      h('span', { class: 'inbox-goal', title: i.goal }, i.goal),
      h('small', { class: 'muted' }, `· ${i.who.replace(/^Lt\. /, '')}${i.since ? ` · ${waited(i.since, Date.now())}` : ''}`),
    ),
    h('div', { class: 'need-what', title: i.what }, i.what),
    h('small', { class: 'need-sends' }),
  );
}

/** Something decided lately: the goal and when, then what was said, and who said it. */
function decidedRow(d: DecisionEvent): HTMLElement {
  const via = viaNote(d.via);
  return h('div', { class: 'decided', title: `${d.item.what}${via ? ` (${via})` : ''}` },
    h('div', { class: 'inbox-row-head' }, h('span', { class: 'inbox-goal' }, d.goal ?? d.agent), h('small', { class: 'muted' }, `· ${waited(d.at, Date.now())}`)),
    h('div', { class: 'decided-answer' }, `${decidedBy(d)}: “${d.answer}”`),
  );
}

/**
 * Comms, opened from anywhere with C and from the captain's chair with E: the captain's inbox (shared/captainsInbox.ts),
 * read from Focus as a bot reads it, so both see the same. Along the top each project with what waits there, to
 * narrow the list to it. On the left what the chief of staff flags for the captain, most urgent first, then what they
 * decided lately, then its tray: the turns it has words ready for, and what it sent by itself today. On the right the
 * one picked, large: the goal, what to read to decide, and the answers. Answered, it leaves the list and the next one's
 * picked. Picking a lead's turn reads it, as their panel does. The list keeps its order while it's open (`keptOrder`),
 * so nothing moves under the pointer.
 */
export function openCommsPanel(ui: Ui): void {
  let picked: string | null = kept;
  let project: string | null = keptProject;
  let shown: string | null = null;
  let at = 0;
  let order: string[] = [];
  let open: InboxItem[] = [];
  let decidedLately: DecisionEvent[] = [];
  let trayOpen = false;
  const rows = new Map<string, HTMLElement>();
  const tabs = h('div', { class: 'comms-tabs' });
  const queueHead = h('h3');
  const queue = h('div', { class: 'needs' });
  const reading = h('small', { class: 'muted cos-reading' });
  const decidedHead = h('h3', null, 'Recently decided');
  const decided = h('div', { class: 'decided-list' });
  const trayLine = h('button', { class: 'cos-tray-line', title: 'The turns the chief of staff carries on or sends back: its words, ready to send', onclick: () => { trayOpen = !trayOpen; render(); } });
  const tray = h('div', { class: 'needs cos-tray' });
  const keysHint = h('small', { class: 'muted comms-keys' }, COMMS_KEYS);
  const detail = h('div', { class: 'inbox-detail' });
  const body = h('div', { class: 'comms inbox' },
    tabs,
    h('div', { class: 'inbox-left' }, queueHead, queue, reading, decidedHead, decided, trayLine, tray, keysHint),
    h('div', { class: 'inbox-right' }, detail),
  );

  const render = (step = 0) => {
    const now = Date.now();
    const local = new Map(needs().map((a) => [keyOf(a), a]));
    // only what Focus's inbox has, and this browser knows of (a bot's answer can land before this browser hears)
    const known = open.filter((i) => local.has(i.id));
    const { flagged, ready, reading: judging } = lanes(known, project);
    const keys = (order = keptOrder(order, flagged.map((i) => i.id)));
    const byId = new Map(known.map((i) => [i.id, i]));
    const items = keys.flatMap((k) => byId.get(k) ?? []);
    // the tray's rows are picked like the list's, when it's open
    const pickable = [...items, ...(trayOpen ? ready : [])];
    const ids = pickable.map((i) => i.id);
    const i = focusIndex(ids, step ? null : picked, step && ids.length ? (((at + step) % ids.length) + ids.length) % ids.length : at);

    const counts = perProject(lanes(known, null).flagged);
    fill(tabs, ...state.shown.map((p) =>
      h('button', { class: `comms-tab${project === p.id ? ' on' : ''}`, style: `--tone:${p.color}`, title: project === p.id ? 'Show every project' : `Only ${p.name}`, onclick: () => { project = keptProject = project === p.id ? null : p.id; render(); } },
        p.name, counts.get(p.id) ? h('b', null, String(counts.get(p.id))) : null)),
      h('button', { class: 'comms-tab goals', title: 'The goals: start one, see the line and the closed ones', onclick: () => ui.openGoals(project ?? state.shown[0]?.id ?? '') }, 'Goals ›'),
    );
    queueHead.textContent = items.length ? `Needs you · ${items.length}` : 'Needs you';
    reading.hidden = !judging;
    reading.textContent = `The chief of staff is reading ${judging === 1 ? '1 turn' : `${judging} turns`}…`;

    // a row is built once per item and kept, so the list isn't rebuilt under the pointer
    const next = new Map(pickable.map((it) => [`${it.id}|${it.lane}`, rows.get(`${it.id}|${it.lane}`) ?? itemRow(it, () => { picked = it.id; render(); })] as const));
    for (const it of pickable) {
      const row = next.get(`${it.id}|${it.lane}`);
      row?.classList.toggle('read', !!it.read);
      row?.classList.toggle('sel', it.id === ids[i]);
      const sends = row?.querySelector('.need-sends');
      if (sends) sends.textContent = sendsIn(local.get(it.id), now);
    }
    if ([...next.keys()].join('|') !== [...rows.keys()].join('|') || !queue.childElementCount) {
      const rowsOf = (list: InboxItem[]) => list.flatMap((it) => next.get(`${it.id}|${it.lane}`) ?? []);
      fill(queue, ...(items.length ? rowsOf(items) : [h('p', { class: 'muted' }, '✓ Nothing needs you.')]));
      fill(tray, ...(trayOpen ? rowsOf(ready) : []));
    }
    rows.clear();
    for (const [k, row] of next) rows.set(k, row);

    const today = new Date(now).setHours(0, 0, 0, 0);
    const sent = sentByCos(decidedLately, today);
    trayLine.hidden = !ready.length && !sent;
    trayLine.textContent = `Chief of staff: ${[ready.length ? `${ready.length} ready to send` : '', sent ? `sent ${sent} by itself today` : ''].filter(Boolean).join(' · ')} ${trayOpen ? '‹' : '›'}`;
    const mine = decidedLately.filter((d) => d.via !== 'chief-of-staff' && (!project || d.projectId === project)).slice(0, DECIDED_SHOWN);
    decidedHead.hidden = decided.hidden = !mine.length;
    fill(decided, ...mine.map(decidedRow));

    if (i < 0) {
      picked = shown = kept = null;
      fill(detail, h('div', { class: 'briefing-card briefing-clear' }, h('div', { class: 'briefing-what' }, h('span', null, '✓'), 'Nothing needs you.')));
      return;
    }
    at = i;
    picked = kept = ids[i];
    const a = local.get(ids[i]);
    if (!a) return;
    // rebuilt only when it's another item (or the chief of staff has judged it since, or it's held), so a reply being written isn't
    // wiped by the next update
    const showing = `${picked}|${a.kind === 'turn' ? `${a.agent.lead?.cos?.judged?.route ?? ''}|${a.agent.lead?.cos?.sendsAt ?? ''}` : ''}`;
    if (showing === shown) return;
    shown = showing;
    if (a.kind === 'turn') markRead(a.agent);
    fill(detail, needCard(ui, a));
  };

  // the inbox is Focus's, asked for again (at most every quarter second) whenever anything it's made of changes
  let asking: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(asking);
    asking = setTimeout(() => void api.inbox().then((inbox) => {
      open = inbox.open.filter((i) => !state.isHidden(i.projectId));
      decidedLately = inbox.decided.filter((d) => !state.isHidden(d.projectId));
      render();
    }, () => undefined), 250);
  };

  // by keyboard (commsKeys.ts): never while the captain is writing in the pane
  const onKey = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const act = commsKey(e, typing);
    if (!act) return;
    e.preventDefault();
    if ('move' in act) return render(act.move);
    if ('press' in act) return detail.querySelector<HTMLButtonElement>(`[data-act="${act.press}"]:not(:disabled)`)?.click();
    if ('reply' in act) return detail.querySelector('textarea')?.focus();
    const a = needs().find((n) => keyOf(n) === picked);
    if (a && 'agent' in a) openFromComms(ui, a.agent.id);
    else if (a) {
      ui.openBoard(a.projectId);
      ui.panels.backTo('Comms', () => ui.openComms());
    }
  };

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  window.addEventListener('keydown', onKey);
  ui.panels.own(() => window.removeEventListener('keydown', onKey));
  decidedHead.hidden = decided.hidden = trayLine.hidden = true;
  render();
  refresh();
  // what the chief of staff has been reading a minute comes out of hiding by itself, and the countdowns move on
  const tick = setInterval(refresh, 5000);
  ui.panels.own(() => {
    clearInterval(tick);
    clearTimeout(asking);
  });
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects', 'report'] as const) ui.panels.own(state.on(event, refresh));
}
