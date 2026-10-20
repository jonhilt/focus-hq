import { openQuestion, optionUrl } from '../../../shared/artifacts';
import { type Attention, needLine, turnRead } from '../../../shared/tricorder';
import type { Agent } from '../../../shared/types';
import { api } from '../net/api';
import { attention, markRead } from '../net/attention';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { focusIndex, lastWords } from './briefing';
import { from, hailKey } from './commsPanel';
import type { Ui } from './context';
import { busy, fill, h } from './dom';
import { closeGoal } from './goals';
import { answerLead, messageAgent } from './resume';

/** The colour of each kind of hail, as in Comms. */
const TONE: Record<Attention['kind'], string> = {
  hand: LCARS.gold,
  error: LCARS.red,
  question: LCARS.gold,
  turn: LCARS.orange,
  'wrap-up': '#99cc66',
  qa: LCARS.lilac,
  conflicts: LCARS.red,
};

/** A lead's turn keeps its key once it's read, so reading it here doesn't move it out from under the captain. */
const keyOf = (a: Attention): string => (a.kind === 'turn' ? `turn:${a.agent.id}:${a.agent.finishedAt}` : hailKey(a));

/** Everything that needs the captain, in Comms' order: the hails, then the leads whose turn they've read but not answered. */
function needs(): Attention[] {
  const hails = attention();
  const hailing = new Set(hails.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
  const read = state.shown.flatMap((p) => state.leadsIn(p.id)).filter((l) => !hailing.has(l.id) && turnRead(l));
  return [...hails, ...read.map((agent): Attention => ({ kind: 'turn', agent }))];
}

const said = (agent: Agent) => lastWords(state.lines.get(agent.id) ?? []);
const open = (ui: Ui, agent: Agent, label: string) => h('button', { class: 'btn small', title: 'Their panel: terminal, goal and crew', onclick: () => ui.openAgent(agent.id) }, label);

/** A reply to a lead, written and sent from the briefing. */
function replyBox(ui: Ui, agent: Agent): HTMLElement[] {
  const text = h('textarea', { class: 'briefing-reply', rows: 3, placeholder: `Reply to ${agent.name}…` });
  const send = h('button', { class: 'btn small primary' }, 'Send');
  send.onclick = () => {
    const words = text.value.trim();
    if (words) void busy(send, () => messageAgent(agent.id, agent.name, words), ui.error);
  };
  return [text, h('div', { class: 'row' }, send, open(ui, agent, 'Open their panel'))];
}

/** A lead's question, its options side by side with their pictures, each picked from here. */
function pickBox(ui: Ui, agent: Agent): HTMLElement[] {
  const q = openQuestion(agent);
  if (!q) return [];
  const note = h('input', { class: 'briefing-note', placeholder: 'Add a word with your pick (optional)' });
  const options = q.options.map((o) => {
    const pick = h('button', { class: 'btn small primary' }, `Pick ${o.id.toUpperCase()}`);
    pick.onclick = () => void busy(pick, () => answerLead(agent.id, q.id, o.id, note.value.trim() || undefined), ui.error);
    return h('div', { class: 'briefing-option' },
      o.image ? h('img', { src: optionUrl(agent.id, q, o.id, 'jpg'), alt: o.label }) : null,
      h('strong', null, `${o.id.toUpperCase()} · ${o.label}`),
      o.detail ? h('small', { class: 'muted' }, o.detail) : null,
      pick,
    );
  });
  return [
    h('div', { class: 'briefing-options' }, ...options),
    note,
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ui.openScreen(agent.id) }, 'See them up close')),
  ];
}

/** What the captain reads to decide, and what answers it, for one hail. */
function body(ui: Ui, a: Attention): { context: string; answers: HTMLElement[] } {
  switch (a.kind) {
    case 'hand': {
      const req = a.agent.permission;
      const allow = h('button', { class: 'btn small go' }, 'Approve');
      const deny = h('button', { class: 'btn small danger' }, 'Decline');
      if (req) {
        allow.onclick = () => void busy(allow, () => api.permission(a.agent.id, req.id, true), ui.error);
        deny.onclick = () => void busy(deny, () => api.permission(a.agent.id, req.id, false), ui.error);
      }
      // what they said as they raised it, and the tool it's for (the request itself is the heading)
      return { context: [said(a.agent), req ? `Tool: ${req.tool}` : ''].filter(Boolean).join('\n\n'), answers: [h('div', { class: 'row' }, allow, deny, open(ui, a.agent, 'Open their panel'))] };
    }
    case 'error':
      return { context: said(a.agent), answers: [h('div', { class: 'row' }, open(ui, a.agent, 'Open their panel'))] };
    case 'question':
      return { context: openQuestion(a.agent)?.context ?? '', answers: pickBox(ui, a.agent) };
    case 'turn':
      return { context: said(a.agent), answers: replyBox(ui, a.agent) };
    case 'wrap-up': {
      const done = a.agent.lead?.note?.done;
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
      close.onclick = () => void busy(close, () => closeGoal(a.agent), ui.error);
      return { context: [done ? `Done looks like: ${done}` : '', said(a.agent)].filter(Boolean).join('\n\n'), answers: [h('div', { class: 'row' }, close, open(ui, a.agent, 'Carry on'))] };
    }
    case 'qa':
    case 'conflicts':
      return {
        context: `${a.pr.repo}#${a.pr.number} · ${a.pr.title}`,
        answers: [h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Pull requests'),
          h('a', { class: 'btn small', href: a.pr.url, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
        )],
      };
  }
}

/** One hail, large: what's needed, who and where, what to read to decide, and the answers. */
function card(ui: Ui, a: Attention): HTMLElement {
  const { icon, what } = needLine(a, state.reviews);
  const { context, answers } = body(ui, a);
  const project = 'projectId' in a ? state.project(a.projectId) : undefined;
  return h('div', { class: 'briefing-card', style: `--tone:${TONE[a.kind]}` },
    h('div', { class: 'briefing-what' }, h('span', null, icon), what),
    'agent' in a ? from(a.agent) : project ? h('small', { class: 'need-from' }, project.name) : null,
    context ? h('div', { class: 'briefing-context' }, context) : null,
    ...answers,
  );
}

/**
 * The briefing, from the captain's chair: what needs them, one thing at a time rather than a list across every
 * project. Each is shown large with what to read to decide (a lead's last words, a question's options and their
 * pictures, a raised hand's request) and answered right here; answered, the next takes its place. Back and Next step
 * through without answering. Reading a lead's turn here reads it, as their panel does.
 */
export function openBriefingPanel(ui: Ui): void {
  let shown: string | null = null;
  let at = 0;
  const count = h('span', { class: 'briefing-count' });
  const back = h('button', { class: 'btn small' }, '‹ Back');
  const next = h('button', { class: 'btn small' }, 'Next ›');
  const stage = h('div');
  const root = h('div', { class: 'briefing' }, h('div', { class: 'briefing-head' }, count, back, next), stage);

  const render = (step = 0) => {
    const list = needs();
    const keys = list.map(keyOf);
    const i = focusIndex(keys, step ? null : shown, step ? at + step : at);
    back.disabled = i <= 0;
    next.disabled = i < 0 || i >= keys.length - 1;
    if (i < 0) {
      count.textContent = 'All clear';
      shown = null;
      const going = state.shown.flatMap((p) => state.leadsIn(p.id)).length;
      fill(stage, h('div', { class: 'briefing-card briefing-clear' },
        h('div', { class: 'briefing-what' }, h('span', null, '✓'), 'Nothing needs you.'),
        h('small', { class: 'muted' }, going ? `${going} goal${going === 1 ? '' : 's'} under way without you.` : 'No goals under way.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ui.openComms() }, 'Comms')),
      ));
      return;
    }
    at = i;
    count.textContent = `Decision ${i + 1} of ${keys.length}`;
    // rebuilt only when it's another hail, so a reply being written isn't wiped by the next update
    if (keys[i] === shown) return;
    shown = keys[i];
    const a = list[i];
    if (a.kind === 'turn') markRead(a.agent);
    fill(stage, card(ui, a));
  };
  back.onclick = () => render(-1);
  next.onclick = () => render(1);

  ui.panels.open({ title: 'Briefing', body: root, wide: true, accent: LCARS.orange });
  render();
  for (const event of ['agent', 'agent-removed', 'board', 'review', 'projects'] as const) ui.panels.own(state.on(event, () => render()));
}
