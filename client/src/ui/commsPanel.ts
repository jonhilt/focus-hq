import { statusLine } from '../../../shared/agentStatus';
import { goalState } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { type Attention, needLine, turnRead } from '../../../shared/tricorder';
import { type Agent, TEAM_STATIONS } from '../../../shared/types';
import type { DecisionEvent } from '../../../shared/captainsInbox';
import { api } from '../net/api';
import { markRead } from '../net/attention';
import { state } from '../net/state';
import { goalTags } from '../plugins';
import { LCARS } from '../world/starship';
import { focusIndex, keptOrder } from './briefing';
import type { Ui } from './context';
import { fill, h, timeAgo } from './dom';
import { keyOf, needCard, needs, TONE } from './needCard';

/** How many of the captain's recent decisions Comms lists. */
const DECIDED_SHOWN = 8;

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
  );
}

/** Something the captain decided lately: what it was, who for, and what they said. */
function decidedRow(d: DecisionEvent): HTMLElement {
  const project = state.project(d.projectId);
  return h('div', { class: 'decided' },
    h('small', { class: 'muted' }, `${timeAgo(d.at)} · ${d.agent}${d.goal ? ` · ${d.goal}` : ''}${d.via === 'api' ? ' · via the API' : ''}`,
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
    h('button', { class: 'btn small', onclick: () => ui.openAgent(lead.id) }, 'Talk'),
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
  let picked: string | null = null;
  let shown: string | null = null;
  let at = 0;
  let order: string[] = [];
  const rows = new Map<string, HTMLElement>();
  const queueHead = h('h3');
  const queue = h('div', { class: 'needs' });
  const decidedHead = h('h3', null, 'Recently decided');
  const decided = h('div', { class: 'decided-list' });
  const underWayHead = h('h3', null, 'Under way');
  const underWay = h('div', { class: 'under-way-list' });
  const gateways = h('div', { class: 'row' });
  const later = h('button', { class: 'btn small', title: 'Leave it in the queue and look at the next' }, 'Later ›');
  const detail = h('div', { class: 'inbox-detail' });
  const body = h('div', { class: 'comms inbox' },
    h('div', { class: 'inbox-left' }, queueHead, queue, decidedHead, decided, underWayHead, underWay, h('h3', null, 'Goals'), gateways),
    h('div', { class: 'inbox-right' }, h('div', { class: 'inbox-head' }, later), detail),
  );

  const render = (step = 0) => {
    const list = needs();
    const keys = (order = keptOrder(order, list.map(keyOf)));
    const byKey = new Map(list.map((a) => [keyOf(a), a]));
    const items = keys.flatMap((k) => byKey.get(k) ?? []);
    const i = focusIndex(keys, step ? null : picked, step && keys.length ? (at + step) % keys.length : at);
    queueHead.textContent = keys.length ? `Needs you (${keys.length})` : 'Needs you';
    later.disabled = keys.length < 2;

    // a row is built once per item and kept, so the queue isn't rebuilt under the pointer
    const next = new Map(items.map((a) => {
      const k = keyOf(a);
      return [k, rows.get(k) ?? queueRow(a, () => { picked = k; render(); })] as const;
    }));
    for (const a of items) {
      const row = next.get(keyOf(a));
      row?.classList.toggle('read', a.kind === 'turn' && turnRead(a.agent));
      row?.classList.toggle('sel', keyOf(a) === keys[i]);
    }
    if ([...next.keys()].join('|') !== [...rows.keys()].join('|') || !queue.childElementCount) {
      fill(queue, ...(next.size ? next.values() : [h('p', { class: 'muted' }, '✓ All quiet.')]));
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
      picked = shown = null;
      fill(detail, h('div', { class: 'briefing-card briefing-clear' },
        h('div', { class: 'briefing-what' }, h('span', null, '✓'), 'Nothing needs you.'),
        h('small', { class: 'muted' }, going.length ? `${going.length} goal${going.length === 1 ? '' : 's'} under way without you.` : 'No goals under way.'),
      ));
      return;
    }
    at = i;
    picked = keys[i];
    // rebuilt only when it's another item, so a reply being written isn't wiped by the next update
    if (picked === shown) return;
    shown = picked;
    const a = items[i];
    if (a.kind === 'turn') markRead(a.agent);
    fill(detail, needCard(ui, a));
  };
  later.onclick = () => render(1);

  // what the captain decided lately is the ledger's, asked for again whenever the ledger grows
  const showDecided = () =>
    void api.inbox().then(({ decided: ds }) => {
      const shown = ds.filter((d) => !state.isHidden(d.projectId)).slice(0, DECIDED_SHOWN);
      decidedHead.hidden = decided.hidden = !shown.length;
      fill(decided, ...shown.map(decidedRow));
    }, () => undefined);

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  render();
  decidedHead.hidden = decided.hidden = true;
  showDecided();
  ui.panels.own(state.on('report', showDecided));
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects'] as const) ui.panels.own(state.on(event, () => render()));
}
