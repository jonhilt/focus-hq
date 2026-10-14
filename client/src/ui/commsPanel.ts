import { statusLine } from '../../../shared/agentStatus';
import { openQuestion } from '../../../shared/artifacts';
import { goalState } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import { type Attention, turnRead } from '../../../shared/tricorder';
import { type Agent, TEAM_STATIONS } from '../../../shared/types';
import { api } from '../net/api';
import { attention } from '../net/attention';
import { state } from '../net/state';
import { onTraffic, traffic, type TrafficEntry, type TrafficLink } from '../net/traffic';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import type { ToastAction } from './hud';
import { busy, fill, h, timeAgo } from './dom';
import { closeGoal } from './goals';

/** What a hail is about, the same hail from render to render: its row is built once and kept while it stands. */
function hailKey(a: Attention): string {
  switch (a.kind) {
    case 'hand':
      return `hand:${a.agent.id}:${a.agent.permission?.id}`;
    case 'question':
      return `question:${a.agent.id}:${openQuestion(a.agent)?.id}`;
    case 'error':
      return `error:${a.agent.id}:${a.agent.finishedAt}`;
    case 'wrap-up':
      return `wrap-up:${a.agent.id}:${a.agent.lead?.closing?.at}`;
    case 'turn':
      return `turn:${a.agent.id}:${a.agent.finishedAt}`;
    case 'qa':
    case 'conflicts':
      return `${a.kind}:${a.projectId}:${a.pr.repo}#${a.pr.number}`;
  }
}

/** Who and where, on the line under what's needed: a lead's station and goal, or what anyone else is on, and the project. */
function from(agent: Agent): HTMLElement {
  const project = state.project(agent.projectId);
  const work = agent.lead;
  return h('small', { class: 'need-from' },
    agent.name,
    work ? ` · Station ${work.station + 1} · ${work.title}` : agent.task === 'climb' ? ` · Climb: ${agent.issue.title}` : ` · ${agent.task === 'issue' ? '#' : 'PR #'}${agent.issue.number} ${agent.issue.title}`,
    project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null,
  );
}

const beam = (ui: Ui, agent: Agent) => h('button', { class: 'btn small', title: 'Teleport to them', onclick: () => ui.goToAgent(agent.id) }, 'Beam there');
const talk = (ui: Ui, agent: Agent, label: string) => h('button', { class: 'btn small primary', title: 'Their panel: terminal, goal and crew', onclick: () => ui.openAgent(agent.id) }, label);

/** One line of Needs you: an icon, what's needed, who and where under it, and the buttons that answer it. */
function needRow(tone: string, icon: string, what: string, where: HTMLElement, ...actions: HTMLElement[]): HTMLElement {
  return h('div', { class: 'need', style: `--tone:${tone}` },
    h('span', { class: 'need-icon' }, icon),
    h('div', { class: 'grow' }, h('div', { class: 'need-what', title: what }, what), where),
    ...actions,
  );
}

/** A lead waiting for the captain's reply: Reply opens their panel, where the conversation is. Read, it's quieter. */
function turnRow(ui: Ui, lead: Agent, read: boolean): HTMLElement {
  const row = needRow(LCARS.orange, '💬', read ? 'Waiting for your reply · read' : 'Waiting for your reply', from(lead), talk(ui, lead, 'Reply'), beam(ui, lead));
  row.classList.toggle('read', read);
  return row;
}

/** What a piece of news's button does: the toast's own, rebuilt from the link it was kept with. */
export function linkAction(ui: Ui, link: TrafficLink): ToastAction | undefined {
  switch (link.kind) {
    case 'agent':
      // gone home since: nowhere to go
      if (!state.agents.has(link.id)) return undefined;
      return link.talk ? { label: 'Talk', run: () => ui.openAgent(link.id) } : { label: 'Go there', run: () => ui.goToAgent(link.id) };
    case 'number-one':
      return { label: 'Read it', run: () => ui.openNumberOne() };
    case 'preview':
      return { label: 'Log', run: () => ui.openPreview(link.projectId) };
    case 'url':
      return { label: link.label, run: () => window.open(link.url, '_blank', 'noopener') };
  }
}

/** A line of recent traffic: when, what, and its toast's button. */
function trafficRow(ui: Ui, entry: TrafficEntry): HTMLElement {
  const action = entry.link && linkAction(ui, entry.link);
  return h('div', { class: `traffic ${entry.level}` },
    h('small', { class: 'traffic-at', title: new Date(entry.at).toLocaleString() }, timeAgo(entry.at)),
    h('span', { class: 'grow' }, entry.text),
    action ? h('button', { class: 'btn small', onclick: action.run }, action.label) : null,
  );
}

function hailRow(ui: Ui, a: Attention): HTMLElement {
  switch (a.kind) {
    case 'hand': {
      const req = a.agent.permission;
      const allow = h('button', { class: 'btn small go' }, 'Approve');
      const deny = h('button', { class: 'btn small danger' }, 'Decline');
      if (req) {
        allow.onclick = () => void busy(allow, () => api.permission(a.agent.id, req.id, true), ui.error);
        deny.onclick = () => void busy(deny, () => api.permission(a.agent.id, req.id, false), ui.error);
      }
      return needRow(LCARS.gold, '✋', `Approve: ${req?.summary ?? 'something'}`, from(a.agent), allow, deny, talk(ui, a.agent, 'Open'));
    }
    case 'question': {
      // the options are pictures: they're picked on the station's screen, up close
      const pick = h('button', { class: 'btn small primary', title: 'See the options up close and pick one', onclick: () => ui.openScreen(a.agent.id) }, 'Pick one');
      return needRow(LCARS.gold, '❓', `Pick: ${openQuestion(a.agent)?.question ?? 'they ask you'}`, from(a.agent), pick, beam(ui, a.agent));
    }
    case 'error':
      return needRow(LCARS.red, '❗', `Stuck: ${a.agent.error ?? 'hit a problem'}`, from(a.agent), talk(ui, a.agent, 'Open'), beam(ui, a.agent));
    case 'wrap-up': {
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
      close.onclick = () => void busy(close, () => closeGoal(a.agent), ui.error);
      return needRow('#99cc66', '🏁', `Ready to close: ${a.agent.lead?.closing?.reason ?? ''}`, from(a.agent), close, talk(ui, a.agent, 'Carry on'));
    }
    case 'turn':
      return turnRow(ui, a.agent, false);
    case 'qa':
    case 'conflicts': {
      const review = a.kind === 'qa' ? state.reviews.get(prKey(a.pr.repo, a.pr.number))?.followUp : undefined;
      const what = a.kind === 'qa' ? `QA needs you${review?.kind === 'needs-you' ? `: ${review.reason}` : ''}` : 'Resolve conflicts with its base branch';
      const project = state.project(a.projectId);
      return needRow(a.kind === 'qa' ? LCARS.lilac : LCARS.red, a.kind === 'qa' ? '🙋' : '⚠', what,
        h('small', { class: 'need-from' }, `${a.pr.repo.split('/')[1] ?? a.pr.repo}#${a.pr.number} · ${a.pr.title}`, project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null),
        h('button', { class: 'btn small primary', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Pull requests'),
        h('a', { class: 'btn small', href: a.pr.url, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
      );
    }
  }
}

/** A goal that's getting on without the captain: a line each, to talk to its lead or beam over. */
function underWayRow(ui: Ui, lead: Agent): HTMLElement {
  const project = state.project(lead.projectId);
  return h('div', { class: 'under-way', style: `--tone:${UNIFORM[lead.avatar.division]}` },
    h('span', { class: 'under-way-station' }, String((lead.lead?.station ?? 0) + 1).padStart(2, '0')),
    h('div', { class: 'grow' },
      h('div', null, h('strong', null, lead.lead?.title ?? lead.issue.title), project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null),
      h('small', { class: 'muted' }, `${lead.name} · ${goalState(lead)} · ${statusLine(lead)}`),
    ),
    h('button', { class: 'btn small', onclick: () => ui.openAgent(lead.id) }, 'Talk'),
    beam(ui, lead),
  );
}

/**
 * Rows kept by key while they stand: the list is only rebuilt when what's in it changes, so a button that's busy
 * (Approve, Close goal) isn't swapped for a fresh one under the pointer by the next render.
 */
class KeptRows<T> {
  private rows = new Map<string, HTMLElement>();

  constructor(
    readonly el: HTMLElement,
    private readonly key: (item: T) => string,
    private readonly build: (item: T) => HTMLElement,
    private readonly empty: HTMLElement,
  ) {}

  show(items: readonly T[]): void {
    const next = new Map(items.map((item) => [this.key(item), this.rows.get(this.key(item)) ?? this.build(item)]));
    if ([...next.keys()].join('|') !== [...this.rows.keys()].join('|') || !this.el.childElementCount) {
      fill(this.el, ...(next.size ? next.values() : [this.empty]));
    }
    this.rows = next;
  }
}

/** A line of Needs you: a hail, or a lead whose turn the captain has read but not answered yet. */
type Need = { hail: Attention } | { read: Agent };

/**
 * Comms: what needs the captain, across the ship, opened from anywhere with C. Needs you comes first, a line each
 * saying what's needed and the buttons that answer it: the hails from `attention()`, then the leads whose turn the
 * captain has read but not answered (quieter, and not on the badge). The conversation itself is in the lead's panel,
 * which Reply opens. Then the goals getting on without them, each project's goals panel, and, folded away, the recent
 * traffic the toasts brought. Nothing to mark as read: a line clears when what it's about does.
 */
export function openCommsPanel(ui: Ui): void {
  const needs = new KeptRows<Need>(
    h('div', { class: 'needs' }),
    (n) => ('hail' in n ? hailKey(n.hail) : `read:${n.read.id}:${n.read.finishedAt}`),
    (n) => ('hail' in n ? hailRow(ui, n.hail) : turnRow(ui, n.read, true)),
    h('p', { class: 'muted' }, '✓ All quiet. Nothing needs you.'),
  );
  const recent = h('div', { class: 'traffic-list' });
  const recentFold = h('details', { class: 'traffic-fold' }, h('summary', { title: 'The last news the toasts brought, newest first' }, 'Recent traffic'), recent);
  const underWay = h('div', { class: 'under-way-list' });
  const underWayHead = h('h3', null, 'Under way');
  const gateways = h('div', { class: 'row' });
  const needsHead = h('h3');
  const body = h('div', { class: 'comms' },
    needsHead, needs.el,
    underWayHead, underWay,
    h('h3', null, 'Goals'), gateways,
    recentFold,
  );

  const renderTraffic = () => {
    const log = traffic();
    fill(recent, ...(log.length ? log.map((e) => trafficRow(ui, e)) : [h('p', { class: 'muted' }, 'No news yet.')]));
  };

  const render = () => {
    const now = attention();
    const hailing = new Set(now.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
    const leads = state.shown.flatMap((p) => state.leadsIn(p.id)).filter((l) => !hailing.has(l.id));
    const read = leads.filter((l) => turnRead(l));
    needs.show([...now.map((hail) => ({ hail })), ...read.map((l) => ({ read: l }))]);
    const count = now.length + read.length;
    needsHead.textContent = count ? `Needs you (${count})` : 'Needs you';

    const going = leads.filter((l) => !turnRead(l));
    underWayHead.hidden = underWay.hidden = !going.length;
    fill(underWay, ...going.map((l) => underWayRow(ui, l)));

    fill(gateways, ...state.shown.map((p) => {
      const waiting = p.goalQueue?.length ?? 0;
      return h('button', { class: 'btn small', style: `--tone:${p.color}`, title: `${p.name}’s goals: start one, see the line and the closed ones`, onclick: () => ui.openGoals(p.id) },
        `${p.name} · ${state.leadsIn(p.id).length}/${TEAM_STATIONS}${waiting ? ` +${waiting}` : ''}`);
    }));
  };

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  render();
  renderTraffic();
  ui.panels.own(onTraffic(renderTraffic));
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects'] as const) ui.panels.own(state.on(event, render));
}
