import { statusLine } from '../../../shared/agentStatus';
import { goalState } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import { lastReply } from '../../../shared/termText';
import { type Attention, turnKey } from '../../../shared/tricorder';
import { type Agent, TEAM_STATIONS } from '../../../shared/types';
import { api } from '../net/api';
import { attention, markSeen, onSeen } from '../net/attention';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';
import { closeGoal } from './goals';

/** What a hail is about, the same hail from render to render: its card is built once and kept while it stands. */
function hailKey(a: Attention): string {
  switch (a.kind) {
    case 'hand':
      return `hand:${a.agent.id}:${a.agent.permission?.id}`;
    case 'error':
      return `error:${a.agent.id}:${a.agent.finishedAt}`;
    case 'wrap-up':
      return `wrap-up:${a.agent.id}:${a.agent.lead?.closing?.at}`;
    case 'turn':
      return `turn:${turnKey(a.agent)}`;
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
    work ? ` · Station ${work.station + 1} · “${work.title}”` : ` · ${agent.task === 'issue' ? '#' : 'PR #'}${agent.issue.number} ${agent.issue.title}`,
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
      await api.message(agent.id, text);
      input.value = '';
    }, ui.error);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send.click();
  });
  return h('div', { class: 'row hail-reply' }, h('div', { class: 'grow' }, withMic(ui, input)), send);
}

const beam = (ui: Ui, agent: Agent) => h('button', { class: 'btn small go', title: 'Teleport to them', onclick: () => ui.goToAgent(agent.id) }, 'Beam there');
const open = (ui: Ui, agent: Agent) => h('button', { class: 'btn small', title: 'Their panel: terminal, goal and crew', onclick: () => ui.openAgent(agent.id) }, 'Open');

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
    case 'error':
      return card(LCARS.red, from(a.agent), h('p', { class: 'hail-what' }, `❗ ${a.agent.error ?? 'Hit a problem'}`), reply(ui, a.agent, 'Tell them how to carry on…'), h('div', { class: 'row' }, open(ui, a.agent), beam(ui, a.agent)));
    case 'wrap-up': {
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
      close.onclick = () => void busy(close, () => closeGoal(a.agent), ui.error);
      return card('#99cc66', from(a.agent), h('p', { class: 'hail-what' }, `🏁 Ready to wrap up: ${a.agent.lead?.closing?.reason ?? ''}`), reply(ui, a.agent, 'Or carry on…'), h('div', { class: 'row' }, close, open(ui, a.agent), beam(ui, a.agent)));
    }
    case 'turn': {
      const later = h('button', { class: 'btn small', title: 'Stop hailing about this turn: they’ll hail again when they next wait for you' }, 'Later');
      later.onclick = () => markSeen(a.agent);
      return card(LCARS.orange, from(a.agent), quote(a.agent) ?? h('p', { class: 'hail-what' }, '🖖 Waiting for you'), reply(ui, a.agent, 'Reply…'), h('div', { class: 'row' }, open(ui, a.agent), beam(ui, a.agent), later));
    }
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
 * Comms: the whole ship's traffic in one place, opened from anywhere with C. Hails first (whatever waits on the
 * captain, from `attention()`, each with what it takes to answer it there and then: a reply, an approval, closing the
 * goal), then the goals getting on without them, then each project's goals panel. Nothing to mark as read: a hail
 * clears when what it's about does (the lead's at work again, the hand's lowered), or once you've read a lead's turn.
 */
export function openCommsPanel(ui: Ui): void {
  const hails = h('div', { class: 'cards' });
  const underWay = h('div', { class: 'under-way-list' });
  const gateways = h('div', { class: 'row' });
  const hailsHead = h('h3');
  const body = h('div', { class: 'comms' },
    hailsHead, hails,
    h('h3', null, 'Under way'), underWay,
    h('h3', null, 'Goals'), gateways,
  );
  // each hail's card, kept while it stands so a half-typed reply survives the next render
  let cards = new Map<string, HTMLElement>();

  const render = () => {
    const now = attention();
    const next = new Map(now.map((a) => [hailKey(a), cards.get(hailKey(a)) ?? hailCard(ui, a)]));
    // only touch the list when the hails change: moving a card would take the focus off its reply box
    if ([...next.keys()].join('|') !== [...cards.keys()].join('|')) {
      fill(hails, ...(next.size ? next.values() : [h('p', { class: 'muted' }, '✓ All quiet. Nobody is waiting on you.')]));
    }
    cards = next;
    hailsHead.textContent = now.length ? `Hailing you (${now.length})` : 'Hailing you';

    const hailing = new Set(now.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
    const leads = state.shown.flatMap((p) => state.leadsIn(p.id)).filter((l) => !hailing.has(l.id));
    fill(underWay, ...(leads.length ? leads.map((l) => underWayRow(ui, l)) : [h('p', { class: 'muted' }, hailing.size ? 'Every goal under way is waiting on you.' : 'No goals under way.')]));

    fill(gateways, ...state.shown.map((p) => {
      const waiting = p.goalQueue?.length ?? 0;
      return h('button', { class: 'btn small', style: `--tone:${p.color}`, title: `${p.name}’s goals: start one, see the line and the closed ones`, onclick: () => ui.openGoals(p.id) },
        `${p.name} · ${state.leadsIn(p.id).length}/${TEAM_STATIONS}${waiting ? ` +${waiting}` : ''}`);
    }));
  };

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  render();
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects'] as const) ui.panels.own(state.on(event, render));
  ui.panels.own(onSeen(render));
}
