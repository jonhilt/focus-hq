import { artifactUrl, openQuestion, optionUrl } from '../../../shared/artifacts';
import { hailKey as keyOf } from '../../../shared/captainsInbox';
export { keyOf };
import { type Attention, needLine } from '../../../shared/tricorder';
import type { Agent } from '../../../shared/types';
import { api } from '../net/api';
export { needs } from '../net/attention';
import { state } from '../net/state';
import { answeredLead, goalTags } from '../plugins';
import { LCARS } from '../world/starship';
import { lastWords, shownThisTurn } from './briefing';
import type { Ui } from './context';
import { busy, h, timeAgo } from './dom';
import { closeGoal } from './goals';
import { answerLead, messageAgent } from './resume';
import { markdownHtml } from './terminal';

// What needs the captain, and one of them shown large to decide and answer: the right of Comms' inbox (commsPanel.ts).

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

/** Answers a lead, then tells the plugins the captain has (the lead as it stood when they did); a failure tells none. */
const answer = (agent: Agent, fn: () => Promise<unknown>) => async () => {
  await fn();
  answeredLead(agent);
};

const said = (agent: Agent) => lastWords(state.lines.get(agent.id) ?? []);
/** Opens the agent's panel from Comms: Esc comes back to the same item. */
export const openFromComms = (ui: Ui, id: string) => {
  ui.openAgent(id);
  ui.panels.backTo('Comms', () => ui.openComms());
};
const open = (ui: Ui, agent: Agent, label: string) => h('button', { class: 'btn small', title: 'Their panel: terminal, goal and crew (G)', onclick: () => openFromComms(ui, agent.id) }, label);

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

/**
 * The chief of staff's words for a lead whose turn it would carry on or send back, sent as they are with one press, or
 * by themselves when they're due (`CosRead.sendsAt`), counted down here, unless the captain holds them.
 */
function sendBox(ui: Ui, a: Attention & { agent: Agent }, words: string): HTMLElement[] {
  const send = h('button', { class: 'btn small primary', title: 'Send the lead these words, from the chief of staff (Enter)', attrs: { 'data-act': 'send' } }, 'Send the chief of staff’s words');
  send.onclick = () => void busy(send, answer(a.agent, () => api.decide(keyOf(a), { send: true })), ui.error);
  const sendsAt = a.agent.lead?.cos?.sendsAt;
  const row = h('div', { class: 'row' }, send);
  if (sendsAt !== undefined) {
    const hold = h('button', { class: 'btn small', title: 'Keep these words here until you send them, or reply in your own (H)', attrs: { 'data-act': 'hold' } }, 'Hold');
    hold.onclick = () => void busy(hold, () => api.hold(keyOf(a)), ui.error);
    const left = h('small', { class: 'muted cos-countdown' });
    // counts down while it's on screen, and stops once it's gone from it
    let shown = false;
    const tick = () => {
      const s = Math.max(0, Math.ceil((sendsAt - Date.now()) / 1000));
      left.textContent = s ? `Sends itself in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Sending…';
      shown ||= left.isConnected;
      if (shown && !left.isConnected) clearInterval(timer);
    };
    const timer = setInterval(tick, 1000);
    tick();
    row.append(hold, left);
  }
  return [h('small', { class: 'muted' }, `The chief of staff’s words for ${a.agent.name}:`), h('blockquote', { class: 'cos-words', innerHTML: markdownHtml(words) }), row];
}

/** What the chief of staff made of a lead's turn, when it has: why it goes where it does, and to the captain its words. */
function cosContext(agent: Agent): string {
  const cos = agent.lead?.cos?.judged;
  if (!cos) return '';
  const toCaptain = cos.route === 2 || cos.route === 3;
  return [`**Chief of Staff:** ${cos.why}`, toCaptain && cos.message ? `> ${cos.message.replaceAll('\n', '\n> ')}` : ''].filter(Boolean).join('\n\n');
}

/** A reply to a lead, written and sent from here. */
function replyBox(ui: Ui, agent: Agent): HTMLElement[] {
  const text = h('textarea', { class: 'briefing-reply', rows: 3, placeholder: `Reply to ${agent.name}…` });
  const send = h('button', { class: 'btn small primary' }, 'Send');
  send.onclick = () => {
    const words = text.value.trim();
    if (words) void busy(send, answer(agent, () => messageAgent(agent.id, agent.name, words)), ui.error);
  };
  return [text, h('div', { class: 'row' }, send, open(ui, agent, 'Open their panel'))];
}

/** A lead's question, its options side by side with their pictures, each picked from here. */
function pickBox(ui: Ui, agent: Agent): HTMLElement[] {
  const q = openQuestion(agent);
  if (!q) return [];
  const note = h('input', { class: 'briefing-note', placeholder: 'Add a word with your pick (optional)' });
  const options = q.options.map((o, i) => {
    const pick = h('button', { class: 'btn small primary', title: `Pick it (${i + 1})`, attrs: { 'data-act': `pick-${i + 1}` } }, `Pick ${o.id.toUpperCase()}`);
    pick.onclick = () => void busy(pick, answer(agent, () => answerLead(agent.id, q.id, o.id, note.value.trim() || undefined)), ui.error);
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
      const allow = h('button', { class: 'btn small go', title: 'Approve (A)', attrs: { 'data-act': 'allow' } }, 'Approve');
      const deny = h('button', { class: 'btn small danger', title: 'Decline (D)', attrs: { 'data-act': 'decline' } }, 'Decline');
      if (req) {
        allow.onclick = () => void busy(allow, answer(a.agent, () => api.permission(a.agent.id, req.id, true)), ui.error);
        deny.onclick = () => void busy(deny, answer(a.agent, () => api.permission(a.agent.id, req.id, false)), ui.error);
      }
      // what they said as they raised it, and the tool it's for (the request itself is the heading)
      return { context: [said(a.agent), req ? `Tool: ${req.tool}` : ''].filter(Boolean).join('\n\n'), answers: [h('div', { class: 'row' }, allow, deny, open(ui, a.agent, 'Open their panel'))], then: 'Approve: the tool runs and they carry on. Decline: they’re told no, and find another way or ask you.' };
    }
    case 'error':
      return { context: said(a.agent), answers: [h('div', { class: 'row' }, open(ui, a.agent, 'Open their panel'))], then: 'Their panel shows what went wrong, and starts them again.' };
    case 'question':
      return { context: openQuestion(a.agent)?.context ?? '', answers: pickBox(ui, a.agent), then: 'Pick: they hear your pick, and your word with it, and carry on.' };
    case 'turn': {
      const cos = a.agent.lead?.cos?.judged;
      const ready = cos && (cos.route === 1 || cos.route === 4) ? cos.message : '';
      const context = [cosContext(a.agent), said(a.agent)].filter(Boolean).join('\n\n---\n\n');
      if (ready) return { context, answers: [...sendBox(ui, a, ready), ...shownBox(ui, a.agent), ...replyBox(ui, a.agent)], then: 'Send the chief of staff’s words: they hear them from it and carry on. Or reply in your own words.' };
      return { context, answers: [...shownBox(ui, a.agent), ...replyBox(ui, a.agent)], then: 'Send: they carry on with your reply.' };
    }
    case 'wrap-up': {
      const done = a.agent.lead?.note?.done;
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home, which frees the station' }, 'Close goal');
      close.onclick = () => void busy(close, answer(a.agent, () => closeGoal(a.agent)), ui.error);
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

/** What it's part of, as the pane's title: a lead's goal, what anyone else is on, or the pull request. */
function titleOf(a: Attention): string {
  if (!('agent' in a)) return `${a.pr.repo.split('/')[1] ?? a.pr.repo}#${a.pr.number} ${a.pr.title}`;
  return a.agent.lead?.title ?? a.agent.issue.title;
}

/** Where a hail's from, under its title: the project, who, and how long it's waited. */
function trail(a: Attention): string {
  const project = state.project('agent' in a ? a.agent.projectId : a.projectId)?.name;
  if (!('agent' in a)) return [project, 'Pull request'].filter(Boolean).join(' · ');
  const work = a.agent.lead;
  const since = a.kind === 'hand' ? a.agent.permission?.at : a.agent.finishedAt;
  return [project, work ? `${a.agent.name}, Station ${work.station + 1}` : a.agent.name, since ? `waiting ${timeAgo(since).replace(/ ago$/, '')}` : ''].filter(Boolean).join(' · ');
}

/** One hail, large: the goal it's part of, where it's from, what's needed, what to read to decide, the answers, and what each leads to. */
export function needCard(ui: Ui, a: Attention): HTMLElement {
  const { icon, what } = needLine(a, state.reviews);
  const { context, answers, then } = body(ui, a);
  return h('div', { class: 'briefing-card', style: `--tone:${TONE[a.kind]}` },
    h('div', { class: 'need-title' }, titleOf(a)),
    h('div', { class: 'need-trail' }, trail(a), ...('agent' in a ? goalTags(a.agent, 'line').map((tag) => tag.el) : [])),
    h('div', { class: 'briefing-what' }, h('span', null, icon), what),
    context ? h('div', { class: 'briefing-context', innerHTML: markdownHtml(context) }) : null,
    ...answers,
    h('small', { class: 'need-then' }, then),
  );
}
