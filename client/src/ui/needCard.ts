import { artifactUrl, openQuestion, optionUrl } from '../../../shared/artifacts';
import { type Attention, needLine, turnRead } from '../../../shared/tricorder';
import type { Agent } from '../../../shared/types';
import { api } from '../net/api';
import { attention } from '../net/attention';
import { state } from '../net/state';
import { goalTags } from '../plugins';
import { LCARS } from '../world/starship';
import { lastWords, shownThisTurn } from './briefing';
import type { Ui } from './context';
import { busy, h } from './dom';
import { closeGoal } from './goals';
import { answerLead, messageAgent } from './resume';
import { markdownHtml } from './terminal';

// What needs the captain, and one of them shown large to decide and answer: the right of Comms' inbox (commsPanel.ts).

/** What a hail is about, the same hail from render to render. */
export function hailKey(a: Attention): string {
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

/** Who and where: a lead's station and goal, or what anyone else is on, with the project and any plugin's tags. */
export function from(agent: Agent): HTMLElement {
  const project = state.project(agent.projectId);
  const work = agent.lead;
  return h('small', { class: 'need-from' },
    agent.name,
    work ? ` · Station ${work.station + 1} · ${work.title}` : agent.brief ? ` · ${agent.brief.label}: ${agent.issue.title}` : ` · ${agent.task === 'issue' ? '#' : 'PR #'}${agent.issue.number} ${agent.issue.title}`,
    project ? h('span', { class: 'hail-project', style: `--tone:${project.color}` }, project.name) : null,
    ...goalTags(agent, 'line').map((tag) => tag.el),
  );
}

/** The colour of each kind of hail. */
export const TONE: Record<Attention['kind'], string> = {
  hand: LCARS.gold,
  error: LCARS.red,
  question: LCARS.gold,
  turn: LCARS.orange,
  'wrap-up': '#99cc66',
  qa: LCARS.lilac,
  conflicts: LCARS.red,
};

/** A lead's turn keeps its key once it's read, so reading it here doesn't move it out from under the captain. */
export const keyOf = (a: Attention): string => (a.kind === 'turn' ? `turn:${a.agent.id}:${a.agent.finishedAt}` : hailKey(a));

/** Everything that needs the captain: the hails, most urgent first, then the leads whose turn they've read but not answered. */
export function needs(): Attention[] {
  const hails = attention();
  const hailing = new Set(hails.flatMap((a) => ('agent' in a ? [a.agent.id] : [])));
  const read = state.shown.flatMap((p) => state.leadsIn(p.id)).filter((l) => !hailing.has(l.id) && turnRead(l));
  return [...hails, ...read.map((agent): Attention => ({ kind: 'turn', agent }))];
}

const said = (agent: Agent) => lastWords(state.lines.get(agent.id) ?? []);
const open = (ui: Ui, agent: Agent, label: string) => h('button', { class: 'btn small', title: 'Their panel: terminal, goal and crew', onclick: () => ui.openAgent(agent.id) }, label);

/** What a lead showed on their screen this turn, as pictures: what they're asking about is often there. */
function shownBox(ui: Ui, agent: Agent): HTMLElement[] {
  const shown = shownThisTurn(agent.lead?.artifacts, state.lines.get(agent.id) ?? []);
  if (!shown.length) return [];
  const cards = shown.map((a) =>
    h('a', { class: 'briefing-option', href: artifactUrl(agent.id, a, 'html'), target: '_blank', rel: 'noopener', title: 'Open it live' },
      a.image ? h('img', { src: artifactUrl(agent.id, a, 'jpg'), alt: a.title }) : null,
      h('strong', null, a.title),
    ));
  return [
    h('div', { class: 'briefing-options' }, ...cards),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ui.openScreen(agent.id) }, 'See their screen up close')),
  ];
}

/** A reply to a lead, written and sent from here. */
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
function body(ui: Ui, a: Attention): { context: string; answers: HTMLElement[]; then: string } {
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
      return { context: [said(a.agent), req ? `Tool: ${req.tool}` : ''].filter(Boolean).join('\n\n'), answers: [h('div', { class: 'row' }, allow, deny, open(ui, a.agent, 'Open their panel'))], then: 'Approve: the tool runs and they carry on. Decline: they’re told no, and find another way or ask you.' };
    }
    case 'error':
      return { context: said(a.agent), answers: [h('div', { class: 'row' }, open(ui, a.agent, 'Open their panel'))], then: 'Their panel shows what went wrong, and starts them again.' };
    case 'question':
      return { context: openQuestion(a.agent)?.context ?? '', answers: pickBox(ui, a.agent), then: 'Pick: they hear your pick, and your word with it, and carry on.' };
    case 'turn':
      return { context: said(a.agent), answers: [...shownBox(ui, a.agent), ...replyBox(ui, a.agent)], then: 'Send: they carry on with your reply.' };
    case 'wrap-up': {
      const done = a.agent.lead?.note?.done;
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
      close.onclick = () => void busy(close, () => closeGoal(a.agent), ui.error);
      return { context: [done ? `Done looks like: ${done}` : '', said(a.agent)].filter(Boolean).join('\n\n'), answers: [h('div', { class: 'row' }, close, open(ui, a.agent, 'Carry on'))], then: 'Close goal: it’s filed in the room’s log and the station frees. Carry on: their panel, to say what’s left.' };
    }
    case 'qa':
    case 'conflicts':
      return {
        context: `${a.pr.repo}#${a.pr.number} · ${a.pr.title}`,
        answers: [h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Pull requests'),
          h('a', { class: 'btn small', href: a.pr.url, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
        )],
        then: a.kind === 'qa' ? 'Pull requests: read QA’s report, then merge, close or send it back.' : 'Pull requests: send it back to its lead to resolve, or resolve it on GitHub.',
      };
  }
}

/** Where a hail's from, as a trail: the project, the goal, and who. */
function trail(a: Attention): string {
  const project = state.project('agent' in a ? a.agent.projectId : a.projectId)?.name;
  if (!('agent' in a)) return [project, `${a.pr.repo}#${a.pr.number}`].filter(Boolean).join(' › ');
  const work = a.agent.lead;
  return [project, work?.title ?? a.agent.issue.title, work ? `${a.agent.name}, Station ${work.station + 1}` : a.agent.name].filter(Boolean).join(' › ');
}

/** One hail, large: where it's from, what's needed, what to read to decide, the answers, and what each leads to. */
export function needCard(ui: Ui, a: Attention): HTMLElement {
  const { icon, what } = needLine(a, state.reviews);
  const { context, answers, then } = body(ui, a);
  return h('div', { class: 'briefing-card', style: `--tone:${TONE[a.kind]}` },
    h('div', { class: 'need-trail' }, trail(a), ...('agent' in a ? goalTags(a.agent, 'line').map((tag) => tag.el) : [])),
    h('div', { class: 'briefing-what' }, h('span', null, icon), what),
    context ? h('div', { class: 'briefing-context', innerHTML: markdownHtml(context) }) : null,
    ...answers,
    h('small', { class: 'need-then' }, then),
  );
}
