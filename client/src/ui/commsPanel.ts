import { statusLine } from '../../../shared/agentStatus';
import { goalState } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { type Attention, laneOf, needLine, turnRead } from '../../../shared/tricorder';
import { type Agent, TEAM_STATIONS } from '../../../shared/types';
import type { DecisionEvent } from '../../../shared/captainsInbox';
import { viaNote } from '../../../shared/ledger';
import { api } from '../net/api';
import { markRead } from '../net/attention';
import { state } from '../net/state';
import { goalTags } from '../plugins';
import { LCARS } from '../world/starship';
import { focusIndex, keptOrder } from './briefing';
import type { Ui } from './context';
import { fill, h, timeAgo } from './dom';
import { COMMS_KEYS, commsKey } from './commsKeys';
import { keyOf, needCard, needs, openFromComms, TONE } from './needCard';

/** How many of the captain's recent decisions Comms lists. */
const DECIDED_SHOWN = 8;

/** The item the captain had picked when Comms last closed: it opens on it again, while it's still waiting. */
let kept: string | null = null;

/** When the chief of staff's words go by themselves, on the queue's line: to the minute, as the line is redrawn every few seconds. */
const sendsIn = (a: Attention, now: number): string => {
  const at = a.kind === 'turn' ? a.agent.lead?.cos?.sendsAt : undefined;
  if (at === undefined) return '';
  const min = Math.ceil((at - now) / 60_000);
  return min > 1 ? `⏱ sends itself in ${min} min` : '⏱ sends itself within a minute';
};

const beam = (ui: Ui, agent: Agent) => h('button', { class: 'btn small', title: 'Teleport to them', onclick: () => ui.goToAgent(agent.id) }, 'Beam there');

/** One line of the inbox's queue: what's needed, then the project and goal, then who (and any plugin's tags). */
function queueRow(a: Attention, pick: () => void): HTMLElement {
  const { icon, what } = needLine(a, state.reviews);
  const project = state.project('agent' in a ? a.agent.projectId : a.projectId);
  const goal = 'agent' in a ? (a.agent.lead?.title ?? a.agent.issue.title) : `${a.pr.repo.split('/')[1] ?? a.pr.repo}#${a.pr.number} ${a.pr.title}`;
  const who = 'agent' in a ? `${a.agent.name}${a.agent.lead ? ` · Station ${a.agent.lead.station + 1}` : ''}` : 'Pull request';
  return h('button', { class: 'need inbox-row', style: `--tone:${TONE[a.kind]}`, onclick: pick },
    h('div', { class: 'need-what', title: what }, h('span', { class: 'need-icon' }, icon), what),
    h('div', { class: 'inbox-where' }, project ? h('b', { style: `color:${project.color}` }, project.name) : null, project ? ' · ' : null, goal),
    h('small', { class: 'need-from' }, who, ...('agent' in a ? goalTags(a.agent, 'line').map((tag) => tag.el) : [])),
    h('small', { class: 'need-sends' }),
  );
}

/** Something the captain decided lately: what it was, who for, and what they said. */
function decidedRow(d: DecisionEvent): HTMLElement {
  const project = state.project(d.projectId);
  return h('div', { class: 'decided' },
    h('small', { class: 'muted' }, `${timeAgo(d.at)} · ${d.agent}${d.goal ? ` · ${d.goal}` : ''}${viaNote(d.via) ? ` · ${viaNote(d.via)}` : ''}`,
      project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null),
    h('div', { class: 'decided-what', title: d.item.what }, d.item.what),
    h('div', { class: 'decided-answer', title: d.answer }, `→ ${d.answer}`),
  );
}

/** A goal that's getting on without the captain: a line each, to talk to its lead or beam over. */
function underWayRow(ui: Ui, lead: Agent): HTMLElement {
  const project = state.project(lead.projectId);
  return h('div', { class: 'under-way', style: `--tone:${UNIFORM[lead.avatar.division]}` },
    h('span', { class: 'under-way-station' }, String((lead.lead?.station ?? 0) + 1).padStart(2, '0')),
    h('div', { class: 'grow' },
      h('div', null, h('strong', null, lead.lead?.title ?? lead.issue.title), project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null),
      h('small', { class: 'muted' }, `${lead.name} · ${goalState(lead)} · ${statusLine(lead)}`, ...goalTags(lead, 'line').map((tag) => tag.el)),
    ),
    h('button', { class: 'btn small', onclick: () => openFromComms(ui, lead.id) }, 'Talk'),
    beam(ui, lead),
  );
}

/**
 * Comms, opened from anywhere with C and from the captain's chair with E: an inbox of what needs the captain across
 * the ship. On the left the queue, most urgent first (the hails from `attention()`, then the leads whose turn they've
 * read but not answered, quieter), each line saying what's needed, the project and goal, and who; below it the goals
 * getting on without them, and each project's goals. On the right the one picked, large: what to read to decide (a
 * lead's last words, what they showed, a question's options) and the answers, each saying what it leads to. Answered,
 * it leaves the queue and the next one's picked; Later moves on and leaves it there. Picking a lead's turn reads it,
 * as their panel does. The queue keeps its order while it's open (`keptOrder`), so nothing moves under the pointer.
 */
export function openCommsPanel(ui: Ui): void {
  let picked: string | null = kept;
  let shown: string | null = null;
  let at = 0;
  let order: string[] = [];
  const rows = new Map<string, HTMLElement>();
  const queueHead = h('h3');
  const queue = h('div', { class: 'needs' });
  const readyHead = h('h3', { title: 'Turns the chief of staff would carry on, or send back to the lead: its words are ready for you to send' });
  const ready = h('div', { class: 'needs' });
  const reading = h('small', { class: 'muted cos-reading' });
  const decidedHead = h('h3', null, 'Recently decided');
  const decided = h('div', { class: 'decided-list' });
  const underWayHead = h('h3', null, 'Under way');
  const underWay = h('div', { class: 'under-way-list' });
  const gateways = h('div', { class: 'row' });
  const later = h('button', { class: 'btn small', title: 'Leave it in the queue and look at the next (J)' }, 'Later ›');
  const keysHint = h('small', { class: 'muted comms-keys' }, COMMS_KEYS);
  const detail = h('div', { class: 'inbox-detail' });
  const body = h('div', { class: 'comms inbox' },
    h('div', { class: 'inbox-left' }, queueHead, queue, reading, readyHead, ready, decidedHead, decided, underWayHead, underWay, h('h3', null, 'Goals'), gateways),
    h('div', { class: 'inbox-right' }, h('div', { class: 'inbox-head' }, keysHint, later), detail),
  );

  const render = (step = 0) => {
    const now = Date.now();
    const all = needs();
    // what the chief of staff is still reading waits out of sight, for a minute at most (`laneOf`)
    const judging = all.filter((a) => laneOf(a, now) === 'judging');
    const list = all.filter((a) => laneOf(a, now) !== 'judging');
    const keys = (order = keptOrder(order, list.map(keyOf)));
    const byKey = new Map(list.map((a) => [keyOf(a), a]));
    // what needs the captain first, then what's ready to send, each in the order it's kept
    const items = [...keys.flatMap((k) => byKey.get(k) ?? [])].sort((a, b) => Number(laneOf(a, now) === 'ready') - Number(laneOf(b, now) === 'ready'));
    const keyed = items.map(keyOf);
    const i = focusIndex(keyed, step ? null : picked, step && keyed.length ? (((at + step) % keyed.length) + keyed.length) % keyed.length : at);
    const readyCount = items.filter((a) => laneOf(a, now) === 'ready').length;
    const needCount = items.length - readyCount;
    queueHead.textContent = needCount ? `Needs you (${needCount})` : 'Needs you';
    readyHead.textContent = `Ready to send (${readyCount})`;
    readyHead.hidden = ready.hidden = !readyCount;
    reading.hidden = !judging.length;
    reading.textContent = `The chief of staff is reading ${judging.length === 1 ? '1 turn' : `${judging.length} turns`}…`;
    later.disabled = keyed.length < 2;

    // a row is built once per item and kept, so the queue isn't rebuilt under the pointer
    const next = new Map(items.map((a) => {
      const k = keyOf(a);
      return [`${k}|${laneOf(a, now)}`, rows.get(`${k}|${laneOf(a, now)}`) ?? queueRow(a, () => { picked = k; render(); })] as const;
    }));
    for (const a of items) {
      const row = next.get(`${keyOf(a)}|${laneOf(a, now)}`);
      row?.classList.toggle('read', a.kind === 'turn' && turnRead(a.agent));
      row?.classList.toggle('sel', keyOf(a) === keyed[i]);
      const sends = row?.querySelector('.need-sends');
      if (sends) sends.textContent = sendsIn(a, now);
    }
    if ([...next.keys()].join('|') !== [...rows.keys()].join('|') || !queue.childElementCount) {
      const rowsIn = (lane: 'needs-you' | 'ready') => items.filter((a) => (laneOf(a, now) === 'ready') === (lane === 'ready')).flatMap((a) => next.get(`${keyOf(a)}|${laneOf(a, now)}`) ?? []);
      const needRows = rowsIn('needs-you');
      fill(queue, ...(needRows.length ? needRows : [h('p', { class: 'muted' }, '✓ All quiet.')]));
      fill(ready, ...rowsIn('ready'));
    }
    rows.clear();
    for (const [k, row] of next) rows.set(k, row);

    const needing = new Set(items.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
    const going = state.shown.flatMap((p) => state.leadsIn(p.id)).filter((l) => !needing.has(l.id));
    underWayHead.hidden = underWay.hidden = !going.length;
    fill(underWay, ...going.map((l) => underWayRow(ui, l)));
    fill(gateways, ...state.shown.map((p) => {
      const waiting = p.goalQueue?.length ?? 0;
      return h('button', { class: 'btn small', style: `--tone:${p.color}`, title: `${p.name}’s goals: start one, see the line and the closed ones`, onclick: () => ui.openGoals(p.id) },
        `${p.name} · ${state.leadsIn(p.id).length}/${TEAM_STATIONS}${waiting ? ` +${waiting}` : ''}`);
    }));

    if (i < 0) {
      picked = shown = kept = null;
      fill(detail, h('div', { class: 'briefing-card briefing-clear' },
        h('div', { class: 'briefing-what' }, h('span', null, '✓'), 'Nothing needs you.'),
        h('small', { class: 'muted' }, going.length ? `${going.length} goal${going.length === 1 ? '' : 's'} under way without you.` : 'No goals under way.'),
      ));
      return;
    }
    at = i;
    picked = kept = keyed[i];
    const a = items[i];
    // rebuilt only when it's another item (or the chief of staff has judged it since, or it's held), so a reply being written isn't
    // wiped by the next update
    const showing = `${picked}|${a.kind === 'turn' ? `${a.agent.lead?.cos?.judged?.route ?? ''}|${a.agent.lead?.cos?.sendsAt ?? ''}` : ''}`;
    if (showing === shown) return;
    shown = showing;
    if (a.kind === 'turn') markRead(a.agent);
    fill(detail, needCard(ui, a));
  };
  later.onclick = () => render(1);

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

  // what the captain decided lately is the ledger's, asked for again whenever the ledger grows
  const showDecided = () =>
    void api.inbox().then(({ decided: ds }) => {
      const shown = ds.filter((d) => !state.isHidden(d.projectId)).slice(0, DECIDED_SHOWN);
      decidedHead.hidden = decided.hidden = !shown.length;
      fill(decided, ...shown.map(decidedRow));
    }, () => undefined);

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  window.addEventListener('keydown', onKey);
  ui.panels.own(() => window.removeEventListener('keydown', onKey));
  render();
  // a turn the chief of staff hasn't judged in a minute comes out of hiding by itself
  const tick = setInterval(() => render(), 5000);
  ui.panels.own(() => clearInterval(tick));
  decidedHead.hidden = decided.hidden = true;
  showDecided();
  ui.panels.own(state.on('report', showDecided));
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects'] as const) ui.panels.own(state.on(event, () => render()));
}
