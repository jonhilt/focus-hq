import { statusLine } from '../../../shared/agentStatus';
import { openQuestion } from '../../../shared/artifacts';
import { goalState } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import { lastReply } from '../../../shared/termText';
import { type Attention, turnRead } from '../../../shared/tricorder';
import { type Agent, TEAM_STATIONS } from '../../../shared/types';
import { api } from '../net/api';
import { attention, markRead } from '../net/attention';
import { state } from '../net/state';
import { onTraffic, traffic, type TrafficEntry, type TrafficLink } from '../net/traffic';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import type { ToastAction } from './hud';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { messageAgent } from './resume';
import { closeGoal } from './goals';

/** What a hail is about, the same hail from render to render: its card is built once and kept while it stands. */
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

/** Who's hailing, and from where: a lead's station and goal, or what anyone else is on, and the project. */
function from(agent: Agent): HTMLElement {
  const project = state.project(agent.projectId);
  const work = agent.lead;
  return h('div', { class: 'hail-from' },
    h('strong', null, agent.name),
    work ? ` · Station ${work.station + 1} · “${work.title}”` : agent.task === 'climb' ? ` · Climb: ${agent.issue.title}` : ` · ${agent.task === 'issue' ? '#' : 'PR #'}${agent.issue.number} ${agent.issue.title}`,
    project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null,
  );
}

/** What the lead last said, a few lines of it: the rest is in their panel. */
function quote(agent: Agent): HTMLElement | null {
  const said = lastReply(state.lines.get(agent.id) ?? []);
  return said ? h('blockquote', { class: 'hail-said' }, said) : null;
}

/** A reply box straight into the agent's session: Enter sends it, and the hail clears once they're at work on it. */
function reply(ui: Ui, agent: Agent, placeholder: string): HTMLElement {
  const input = h('input', { type: 'text', placeholder, autocomplete: 'off' });
  const send = h('button', { class: 'btn small primary' }, 'Send');
  send.onclick = () => {
    const text = input.value.trim();
    if (!text) return;
    void busy(send, async () => {
      if (await messageAgent(agent.id, agent.name, text)) input.value = '';
    }, ui.error);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send.click();
  });
  return h('div', { class: 'row hail-reply' }, h('div', { class: 'grow' }, withMic(ui, input)), send);
}

const beam = (ui: Ui, agent: Agent) => h('button', { class: 'btn small go', title: 'Teleport to them', onclick: () => ui.goToAgent(agent.id) }, 'Beam there');
const open = (ui: Ui, agent: Agent) => h('button', { class: 'btn small', title: 'Their panel: terminal, goal and crew', onclick: () => ui.openAgent(agent.id) }, 'Open');

/**
 * A lead waiting for the captain: what they last said, and a reply box. Unread, it hails (with Later, to stop it
 * hailing without replying); read (the `read` class), it waits quietly in Your turn until the lead's at work again.
 * The same card moves from one to the other, half-typed reply and all.
 */
function turnCard(ui: Ui, lead: Agent): HTMLElement {
  const later = h('button', { class: 'btn small later', title: 'Stop hailing about this turn: they’ll hail again when they next wait for you' }, 'Later');
  later.onclick = () => markRead(lead, true);
  return h('div', { class: 'hail', style: `--tone:${LCARS.orange}` },
    from(lead),
    quote(lead) ?? h('p', { class: 'hail-what' }, '🖖 Waiting for you'),
    reply(ui, lead, 'Reply…'),
    h('div', { class: 'row' }, open(ui, lead), beam(ui, lead), later),
  );
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

function hailCard(ui: Ui, a: Attention): HTMLElement {
  const card = (tone: string, ...children: (Node | null)[]) => h('div', { class: 'hail', style: `--tone:${tone}` }, ...children);
  switch (a.kind) {
    case 'hand': {
      const req = a.agent.permission;
      const allow = h('button', { class: 'btn small go' }, 'Approve');
      const deny = h('button', { class: 'btn small danger' }, 'Decline');
      if (req) {
        allow.onclick = () => void busy(allow, () => api.permission(a.agent.id, req.id, true), ui.error);
        deny.onclick = () => void busy(deny, () => api.permission(a.agent.id, req.id, false), ui.error);
      }
      return card(LCARS.gold, from(a.agent), h('p', { class: 'hail-what' }, `✋ Wants to run ${req?.summary ?? 'something'}`), h('div', { class: 'row' }, allow, deny, open(ui, a.agent), beam(ui, a.agent)));
    }
    case 'question': {
      // the options are pictures: they're picked on the station's screen, up close
      const pick = h('button', { class: 'btn small go', title: 'See the options up close and pick one', onclick: () => ui.openScreen(a.agent.id) }, 'See the options');
      return card(LCARS.gold, from(a.agent), h('p', { class: 'hail-what' }, `❓ ${openQuestion(a.agent)?.question ?? 'Asks you'}`), h('div', { class: 'row' }, pick, open(ui, a.agent), beam(ui, a.agent)));
    }
    case 'error':
      return card(LCARS.red, from(a.agent), h('p', { class: 'hail-what' }, `❗ ${a.agent.error ?? 'Hit a problem'}`), reply(ui, a.agent, 'Tell them how to carry on…'), h('div', { class: 'row' }, open(ui, a.agent), beam(ui, a.agent)));
    case 'wrap-up': {
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
      close.onclick = () => void busy(close, () => closeGoal(a.agent), ui.error);
      return card('#99cc66', from(a.agent), h('p', { class: 'hail-what' }, `🏁 Ready to wrap up: ${a.agent.lead?.closing?.reason ?? ''}`), reply(ui, a.agent, 'Or carry on…'), h('div', { class: 'row' }, close, open(ui, a.agent), beam(ui, a.agent)));
    }
    case 'turn':
      return turnCard(ui, a.agent);
    case 'qa':
    case 'conflicts': {
      const review = a.kind === 'qa' ? state.reviews.get(prKey(a.pr.repo, a.pr.number))?.followUp : undefined;
      const what = a.kind === 'qa' ? `🙋 QA needs you${review?.kind === 'needs-you' ? `: ${review.reason}` : ''}` : '⚠ Conflicts with its base branch';
      const project = state.project(a.projectId);
      return card(a.kind === 'qa' ? LCARS.lilac : LCARS.red,
        h('div', { class: 'hail-from' }, h('strong', null, `${a.pr.repo.split('/')[1] ?? a.pr.repo}#${a.pr.number}`), ` · ${a.pr.title}`, project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null),
        h('p', { class: 'hail-what' }, what),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Pull requests'),
          h('a', { class: 'btn small', href: a.pr.url, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
        ),
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
    h('button', { class: 'btn small primary', onclick: () => ui.openAgent(lead.id) }, 'Talk'),
    beam(ui, lead),
  );
}

/**
 * Cards kept by key while they stand, so a half-typed reply survives the next render: the list is only touched when
 * its cards change, since moving a card would take the focus off its reply box.
 */
class KeptCards<T> {
  private cards = new Map<string, HTMLElement>();

  constructor(
    readonly el: HTMLElement,
    private readonly key: (item: T) => string,
    private readonly build: (item: T) => HTMLElement,
    private readonly empty: HTMLElement | null = null,
  ) {}

  show(items: readonly T[]): void {
    const next = new Map(items.map((item) => [this.key(item), this.cards.get(this.key(item)) ?? this.build(item)]));
    if ([...next.keys()].join('|') !== [...this.cards.keys()].join('|') || !this.el.childElementCount) {
      fill(this.el, ...(next.size ? next.values() : [this.empty]));
    }
    this.cards = next;
  }
}

/**
 * Comms: the whole ship's traffic in one place, opened from anywhere with C. Hails first (whatever waits on the
 * captain, from `attention()`, each with what it takes to answer it there and then: a reply, an approval, closing the
 * goal), then the leads whose turn the captain has read but not answered, then the goals getting on without them, then
 * each project's goals panel, then the recent traffic: the news the toasts brought, for one you missed. Nothing to mark as read: a hail clears when what it's about does (the lead's at work
 * again, the hand's lowered), and a lead's turn, once read, moves to Your turn rather than out of sight.
 */
export function openCommsPanel(ui: Ui): void {
  // each lead's turn has one card, hailing or read: reading it (on another screen, say) moves it with your draft in it
  const turns = new Map<string, HTMLElement>();
  const turn = (lead: Agent, read: boolean) => {
    const key = `${lead.id}:${lead.finishedAt}`;
    const card = turns.get(key) ?? turnCard(ui, lead);
    turns.set(key, card);
    card.classList.toggle('read', read);
    return card;
  };
  const hails = new KeptCards<Attention>(h('div', { class: 'cards' }), hailKey, (a) => (a.kind === 'turn' ? turn(a.agent, false) : hailCard(ui, a)), h('p', { class: 'muted' }, '✓ All quiet. Nobody is waiting on you.'));
  const read = new KeptCards<Agent>(h('div', { class: 'cards' }), (l) => `${l.id}:${l.finishedAt}`, (l) => turn(l, true));
  const recent = h('div', { class: 'traffic-list' });
  const underWay = h('div', { class: 'under-way-list' });
  const gateways = h('div', { class: 'row' });
  const hailsHead = h('h3');
  const readHead = h('h3', { title: 'Leads whose turn you’ve read: still waiting for your reply, but not hailing' }, 'Your turn · read');
  const body = h('div', { class: 'comms' },
    hailsHead, hails.el,
    readHead, read.el,
    h('h3', null, 'Under way'), underWay,
    h('h3', null, 'Goals'), gateways,
    h('h3', { title: 'The last news the toasts brought, newest first' }, 'Recent traffic'), recent,
  );

  const renderTraffic = () => {
    const log = traffic();
    fill(recent, ...(log.length ? log.map((e) => trafficRow(ui, e)) : [h('p', { class: 'muted' }, 'No news yet.')]));
  };

  const render = () => {
    // a card that moves between lists loses the focus on the way: give it back
    const focused = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement : null;
    const now = attention();
    hails.show(now);
    hailsHead.textContent = now.length ? `Hailing you (${now.length})` : 'Hailing you';

    const hailing = new Set(now.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
    const all = state.shown.flatMap((p) => state.leadsIn(p.id)).filter((l) => !hailing.has(l.id));
    const yourTurn = all.filter((l) => turnRead(l));
    read.show(yourTurn);
    readHead.hidden = read.el.hidden = !yourTurn.length;
    const leads = all.filter((l) => !turnRead(l));
    fill(underWay, ...(leads.length ? leads.map((l) => underWayRow(ui, l)) : [h('p', { class: 'muted' }, hailing.size || yourTurn.length ? 'Every goal under way is waiting on you.' : 'No goals under way.')]));

    fill(gateways, ...state.shown.map((p) => {
      const waiting = p.goalQueue?.length ?? 0;
      return h('button', { class: 'btn small', style: `--tone:${p.color}`, title: `${p.name}’s goals: start one, see the line and the closed ones`, onclick: () => ui.openGoals(p.id) },
        `${p.name} · ${state.leadsIn(p.id).length}/${TEAM_STATIONS}${waiting ? ` +${waiting}` : ''}`);
    }));
    if (focused?.isConnected && document.activeElement !== focused) focused.focus();
  };

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  render();
  renderTraffic();
  ui.panels.own(onTraffic(renderTraffic));
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects'] as const) ui.panels.own(state.on(event, render));
}
