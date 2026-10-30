import { allowTool, answerLead, artifactUrl, busy, closeGoal, confirmDialog, focus, goalTags, h, LCARS, lastWords, markdownHtml, mergeAction, mergePr, mergeWhenPassed, messageAgent, openQuestion, optionUrl, prKey, qaBadge, shownThisTurn, timeAgo, type Ui } from '../../plugin-api/client';
import type { Agent, Attention } from '../../plugin-api/shared';
import { hailKey as keyOf } from './inbox';
import { inbox } from './inboxApi';
import { lineOf } from './laneRules';
import { askBlocksOf, moveAct } from './decisionRules';
import { type BoardPr, mergePress, openPrsOf } from './mergingRules';
import { readOf } from './shared';
import { openZoom, type Zoomable } from './zoom';
import { isRecap } from './mentionRules';

// What needs the captain, one of them shown large to decide and answer, at the end of its goal's thread in Comms (stream.ts). Its answers go
// as the agent's panel's do, so Ops hears each as the captain's (and records it, `captainAnswered`); sending its
// words, or holding them, goes through the inbox.

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

/** Opens an agent's panel from Comms, so Esc comes back to the same item. */
export type OpenAgent = (id: string) => void;

/** What a card asks of the app: a lead's screen up close, a project's board, and a word when an answer fails. */
export type CardUi = Pick<Ui, 'openScreen' | 'openBoard' | 'goToAgent' | 'error'>;

const said = (agent: Agent) => lastWords(focus.lines(agent.id));
const open = (go: OpenAgent, agent: Agent, label: string) => h('button', { class: 'btn small', title: 'Their panel: terminal, goal and crew (G)', onclick: () => go(agent.id) }, label);

/** The prefix Ops shows a slice's system recap under on the lead's screen (docs/goals.md#the-system-recap). */
const RECAP = 'system-recap';
/** Each PR's recap, as Ops saves it: `system-recap-<number>` (server/agents/manager/goalPrs.ts). */
const recapOf = (number: number): string => `${RECAP}-${number}`;

/** A press on one of a card's pictures opens it large over Comms; with ⌘ or Ctrl, a link still opens its own tab. */
const zoomOn = (items: readonly Zoomable[], i: number) => (e: MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  openZoom(items, i);
};

/** What a lead showed on their screen this turn, as pictures: what they're asking about is often there. Their recap is the merge box's. */
function shownBox(ui: CardUi, agent: Agent): HTMLElement[] {
  const shown = shownThisTurn(agent.lead?.artifacts, focus.lines(agent.id)).filter((a) => !isRecap(a.id));
  if (!shown.length) return [];
  const large: Zoomable[] = shown.map((a) => ({ title: a.title, html: artifactUrl(agent.id, a, 'html') }));
  const cards = shown.map((a, i) =>
    h('a', { class: 'cos-card-option', href: artifactUrl(agent.id, a, 'html'), target: '_blank', rel: 'noopener', title: 'See it large here (⌘-click: a tab of its own)', onclick: zoomOn(large, i) },
      a.image ? h('img', { src: artifactUrl(agent.id, a, 'jpg'), alt: a.title }) : null,
      h('strong', null, a.title),
    ));
  return [
    h('div', { class: 'cos-card-options' }, ...cards),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ui.openScreen(agent.id) }, 'See their screen up close')),
  ];
}

/**
 * The chief of staff's words for a lead whose turn it would carry on or send back, sent as they are with one press, or
 * by themselves when they're due (the chief of staff's `CosRead.sendsAt`), counted down here, unless the captain holds them.
 */
function sendBox(ui: CardUi, a: Attention & { agent: Agent }, words: string): HTMLElement[] {
  const send = h('button', { class: 'btn small primary', title: 'Send the lead these words, from the chief of staff (Enter)', attrs: { 'data-act': 'send' } }, 'Send the chief of staff’s words');
  send.onclick = () => void busy(send, () => inbox.decide(keyOf(a), { send: true }), ui.error);
  const sendsAt = readOf(a.agent)?.sendsAt;
  const row = h('div', { class: 'row' }, send);
  if (sendsAt !== undefined) {
    const hold = h('button', { class: 'btn small', title: 'Keep these words here until you send them, or reply in your own (H)', attrs: { 'data-act': 'hold' } }, 'Hold');
    hold.onclick = () => void busy(hold, () => inbox.hold(keyOf(a)), ui.error);
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

/** Something the captain may want to read but needn't to decide, folded away under its label. */
const folded = (label: string, markdown: string): HTMLElement =>
  h('details', { class: 'cos-card-fold' }, h('summary', null, label), h('div', { class: 'cos-card-context', innerHTML: markdownHtml(markdown) }));

/**
 * What the captain reads of a lead's turn: the chief of staff's words to them, when it has some, with the lead's own
 * words and why it routed the turn so folded under it, since its headline and words already say what's being decided.
 * A turn it hasn't judged has only the lead's words, so they're shown open.
 */
function turnContext(agent: Agent): { context: string; folds: HTMLElement[] } {
  const cos = readOf(agent)?.judged;
  const words = said(agent);
  if (!cos) return { context: words, folds: [] };
  const toCaptain = (cos.route === 2 || cos.route === 3) && cos.message;
  return {
    context: toCaptain ? cos.message : '',
    folds: [words ? folded(`What ${agent.name} said`, words) : null, folded('Why the chief of staff routed it here', cos.why)].filter((f) => f !== null),
  };
}

/**
 * The replies the chief of staff suggests to what the lead asked, a button each that sends its words as the captain's
 * (numbered, as a question's picks are), and Got it: the turn's read and off the queue, nothing sent, the lead not woken.
 * A turn that asks several things has a block for each (`askBlocks`), answered on its own and held until all are.
 */
function quickBox(ui: CardUi, a: Attention & { agent: Agent }): HTMLElement[] {
  const asks = readOf(a.agent)?.judged?.asks ?? [];
  const replies = asks.length === 1 ? asks[0]?.replies ?? [] : [];
  const move = asks.length === 1 ? asks[0]?.move : undefined;
  const buttons = replies.map((r, i) => {
    const b = h('button', { class: 'btn small primary cos-reply', title: `Send “${r.text}” (${i + 1})`, attrs: { 'data-act': `pick-${i + 1}` } }, `${i + 1} · ${r.label}`);
    b.onclick = () => void busy(b, () => inbox.decide(keyOf(a), { text: r.text }), ui.error);
    return b;
  });
  const got = h('button', { class: 'btn small cos-got-it', title: 'You’ve read it: off your queue until their next turn. Nothing is sent, and they aren’t woken (O)', attrs: { 'data-act': 'ack' } }, 'Got it');
  got.onclick = () => void busy(got, () => inbox.decide(keyOf(a), { ack: true }), ui.error);
  const moveButton = move ? moveBtn(ui, a, moveAct(move, 0), move.pick === 'move') : null;
  return [...(asks.length > 1 ? askBlocks(ui, a) : []), h('div', { class: 'row cos-quick' }, moveButton, ...buttons, got)];
}

/** The button that moves the work an ask names (handoverRules.ts): done at once, the pick when the chief of staff picks it. */
function moveBtn(ui: CardUi, a: Attention & { agent: Agent }, act: { label: string; ask: number }, pick: boolean): HTMLElement {
  const b = h('button', { class: `btn small ${pick ? 'go' : 'primary'} cos-move`, title: 'The chief of staff tells the receiving lead now, and this lead that it’s gone', attrs: { 'data-act': 'move' } }, act.label);
  b.onclick = () => void busy(b, () => inbox.decide(keyOf(a), { move: act.ask }), ui.error);
  return b;
}

/**
 * A turn's asks, a block each: its headline, its replies (the one held marked), and a line for the user's own
 * words. Each answer is held; once every ask has one, they go to the lead together as one message.
 */
function askBlocks(ui: CardUi, a: Attention & { agent: Agent }): HTMLElement[] {
  const read = readOf(a.agent);
  const { blocks, status } = askBlocksOf(read?.judged?.asks ?? [], read?.answers ?? [], a.agent.name);
  const answer = (i: number, text: string) => inbox.decide(keyOf(a), { answer: { ask: i, text } });
  return [
    ...blocks.map((b) => {
      const picks = b.choices.map((c) => {
        const btn = h('button', { class: `btn small ${c.label === b.picked ? 'go' : 'primary'} cos-reply`, title: `Answer with “${c.text}”` }, c.label);
        btn.onclick = () => void busy(btn, () => answer(b.index, c.text), ui.error);
        return btn;
      });
      const own = h('input', { class: 'cos-card-note', placeholder: 'Or answer in your own words' });
      const hold = h('button', { class: 'btn small' }, 'Answer');
      hold.onclick = () => {
        const words = own.value.trim();
        if (words) void busy(hold, () => answer(b.index, words), ui.error);
      };
      return h('div', { class: 'cos-ask', attrs: { 'data-part': 'ask' } },
        h('strong', null, b.ask),
        b.answer !== undefined ? h('small', { class: 'muted' }, `Your answer: ${b.answer}`) : null,
        h('div', { class: 'row' }, b.move && b.answer === undefined ? moveBtn(ui, a, b.move, b.move.pick) : null, ...picks),
        h('div', { class: 'row' }, own, hold));
    }),
    h('small', { class: 'muted' }, status),
  ];
}

/**
 * A pull request's merge button, as the board's (`mergeAction`, `mergePress`): merge it, asking first when there's a
 * reason to, or merge it once QA passes. `look` is the button's class; what merges is marked `go`, what's under way or
 * cancels it `primary`. Comms' pull request card presses the same one.
 */
export function mergeButton(ui: Pick<CardUi, 'error'>, { projectId, pr }: BoardPr, look: string, go = 'go', not = 'primary'): HTMLButtonElement {
  const review = focus.reviews.get(prKey(pr.repo, pr.number));
  const press = mergePress(mergeAction(review, pr), pr, focus.mergeMethod(projectId, pr.repo));
  const does = press.does;
  // as on the board: what merges is green, what's under way or cancels it isn't
  const merges = does && ('merge' in does || does.whenPassed);
  const b = h('button', { class: `${look} ${merges ? go : not}`, title: press.title, ...(press.act && { attrs: { 'data-act': press.act } }) }, press.label);
  b.disabled = !does;
  if (does) {
    b.onclick = () =>
      void busy(b, async () => {
        if ('whenPassed' in does) return mergeWhenPassed(projectId, pr.repo, pr.number, does.whenPassed);
        if (does.merge.confirm && !await confirmDialog({ title: 'Merge', message: does.merge.confirm, confirmLabel: 'Merge anyway' })) return;
        return mergePr(projectId, pr.repo, pr.number, does.merge.override);
      }, ui.error);
  }
  return b;
}

/**
 * The pull requests a card can merge, a line each with QA's word on it and its merge button, as the board's: merged
 * from here, the captain doesn't go to the board to land what they've just read.
 */
function mergeBox(ui: CardUi, prs: readonly BoardPr[], lead?: Agent): HTMLElement[] {
  if (!prs.length) return [];
  // the slice's recap, what to review them by, whatever the lead or QA said since it went up
  const recaps = lead ? prs.flatMap(({ pr }) => lead.lead?.artifacts?.find((a) => a.id === recapOf(pr.number)) ?? []) : [];
  const recapBox = lead
    ? recaps.map((recap) => h('a', { class: 'cos-card-recap', href: artifactUrl(lead.id, recap, 'html'), target: '_blank', rel: 'noopener', title: 'Open it live' }, h('img', { src: artifactUrl(lead.id, recap, 'jpg'), alt: recap.title })))
    : [];
  const rows = prs.map(({ projectId, pr }) => {
    const review = focus.reviews.get(prKey(pr.repo, pr.number));
    return h('div', { class: 'row cos-merge' }, mergeButton(ui, { projectId, pr }, 'btn small'), h('a', { class: 'muted', href: pr.url, target: '_blank', rel: 'noopener', title: 'Open it on GitHub' }, `${pr.title} · ${qaBadge(review, pr).label}`));
  });
  return [h('small', { class: 'muted' }, prs.length > 1 ? 'Their open pull requests:' : 'Their open pull request:'), ...recapBox, ...rows];
}

/** The lead's own pull requests still open, as the board has them. */
const leadPrs = (agent: Agent): BoardPr[] => openPrsOf(agent, focus.shownPrs());

/** A reply to a lead, written and sent from here. */
function replyBox(ui: CardUi, agent: Agent, go: OpenAgent): HTMLElement[] {
  const text = h('textarea', { class: 'cos-card-reply', rows: 3, placeholder: `Reply to ${agent.name}…` });
  const send = h('button', { class: 'btn small primary' }, 'Send');
  send.onclick = () => {
    const words = text.value.trim();
    if (words) void busy(send, () => messageAgent(agent.id, agent.name, words), ui.error);
  };
  return [text, h('div', { class: 'row' }, send, open(go, agent, 'Open their panel'))];
}

/** A lead's question, its options side by side with their pictures, each picked from here. */
function pickBox(ui: CardUi, agent: Agent): HTMLElement[] {
  const q = openQuestion(agent);
  if (!q) return [];
  const note = h('input', { class: 'cos-card-note', placeholder: 'Add a word with your pick (optional)' });
  const picks = q.options.map((o, i) => {
    const pick = h('button', { class: 'btn small primary', title: `Pick it (${i + 1})`, attrs: { 'data-act': `pick-${i + 1}` } }, `Pick ${o.id.toUpperCase()}`);
    pick.onclick = () => void busy(pick, () => answerLead(agent.id, q.id, o.id, note.value.trim() || undefined), ui.error);
    return pick;
  });
  const large: Zoomable[] = q.options.map((o, i) => ({
    title: `${o.id.toUpperCase()} · ${o.label}`,
    ...(o.detail && { detail: o.detail }),
    html: optionUrl(agent.id, q, o.id, 'html'),
    pick: { label: `Pick ${o.id.toUpperCase()}`, run: () => picks[i]?.click() },
  }));
  const options = q.options.map((o, i) => {
    const pick = picks[i];
    return h('div', { class: 'cos-card-option' },
      o.image ? h('img', { class: 'cos-zoomable', src: optionUrl(agent.id, q, o.id, 'jpg'), alt: o.label, title: 'See it large here', onclick: zoomOn(large, i) }) : null,
      h('strong', null, `${o.id.toUpperCase()} · ${o.label}`),
      o.detail ? h('small', { class: 'muted' }, o.detail) : null,
      pick,
    );
  });
  return [
    h('div', { class: 'cos-card-options' }, ...options),
    note,
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ui.openScreen(agent.id) }, 'See them up close')),
  ];
}

/** What the captain reads to decide, and what answers it, for one hail. */
function body(ui: CardUi, a: Attention, go: OpenAgent): { context: string; folds?: HTMLElement[]; answers: HTMLElement[] } {
  switch (a.kind) {
    case 'hand': {
      const req = a.agent.permission;
      const allow = h('button', { class: 'btn small go', title: 'Approve (A)', attrs: { 'data-act': 'allow' } }, 'Approve');
      const deny = h('button', { class: 'btn small danger', title: 'Decline (D)', attrs: { 'data-act': 'decline' } }, 'Decline');
      if (req) {
        allow.onclick = () => void busy(allow, () => allowTool(a.agent.id, req.id, true), ui.error);
        deny.onclick = () => void busy(deny, () => allowTool(a.agent.id, req.id, false), ui.error);
      }
      // what they said as they raised it, and the tool it's for (the request itself is the heading)
      return { context: [said(a.agent), req ? `Tool: ${req.tool}` : ''].filter(Boolean).join('\n\n'), answers: [h('div', { class: 'row' }, allow, deny, open(go, a.agent, 'Open their panel'))] };
    }
    case 'error':
      return { context: said(a.agent), answers: [h('div', { class: 'row' }, open(go, a.agent, 'Open their panel'))] };
    case 'question':
      return { context: openQuestion(a.agent)?.context ?? '', answers: pickBox(ui, a.agent) };
    case 'turn': {
      const cos = readOf(a.agent)?.judged;
      const ready = cos && (cos.route === 1 || cos.route === 4) ? cos.message : '';
      const { context, folds } = turnContext(a.agent);
      if (ready) return { context, folds, answers: [...mergeBox(ui, leadPrs(a.agent), a.agent), ...sendBox(ui, a, ready), ...quickBox(ui, a), ...shownBox(ui, a.agent), ...replyBox(ui, a.agent, go)] };
      return { context, folds, answers: [...mergeBox(ui, leadPrs(a.agent), a.agent), ...quickBox(ui, a), ...shownBox(ui, a.agent), ...replyBox(ui, a.agent, go)] };
    }
    case 'wrap-up': {
      const done = a.agent.lead?.note?.done;
      const close = h('button', { class: 'btn small go', title: 'File the goal in the room’s log and send its lead home' }, 'Close goal');
      close.onclick = () => void busy(close, () => closeGoal(a.agent), ui.error);
      return { context: [done ? `Done looks like: ${done}` : '', said(a.agent)].filter(Boolean).join('\n\n'), answers: [...mergeBox(ui, leadPrs(a.agent), a.agent), h('div', { class: 'row' }, close, open(go, a.agent, 'Carry on'))] };
    }
    case 'qa':
    case 'conflicts':
      return {
        context: `${a.pr.repo}#${a.pr.number} · ${a.pr.title}`,
        answers: [...(a.kind === 'qa' ? mergeBox(ui, [{ projectId: a.projectId, pr: a.pr }]) : []), h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => ui.openBoard(a.projectId, 'prs') }, 'Pull requests'),
          h('a', { class: 'btn small', href: a.pr.url, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
        )],
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
  const project = focus.project('agent' in a ? a.agent.projectId : a.projectId)?.name;
  if (!('agent' in a)) return [project, 'Pull request'].filter(Boolean).join(' · ');
  const since = a.kind === 'hand' ? a.agent.permission?.at : a.agent.finishedAt;
  return [project, a.agent.name, since ? `waiting ${timeAgo(since).replace(/ ago$/, '')}` : ''].filter(Boolean).join(' · ');
}

/** To the lead's goal in its room (the goal viewing station, tuned to it), where there's more of what they're on than the card has. */
const beamBox = (ui: CardUi, a: Attention): HTMLElement[] =>
  'agent' in a && a.agent.lead
    ? [h('button', { class: 'btn small cos-beam', title: 'View their goal in its room (B)', attrs: { 'data-act': 'beam' }, onclick: () => ui.goToAgent(a.agent.id) }, 'View in room')]
    : [];

/** A lead's open pull requests, each with QA's word and its merge button: what the bridge folds under a decision's More. */
export const mergesOf = (ui: CardUi, lead: Agent): HTMLElement[] => mergeBox(ui, leadPrs(lead), lead);

/** One hail, large: the goal it's part of, where it's from, what's needed, what to read to decide, and the answers. */
export function needCard(ui: CardUi, a: Attention, go: OpenAgent): HTMLElement {
  const { icon, what } = lineOf(a, focus.reviews);
  const { context, folds = [], answers } = body(ui, a, go);
  return h('div', { class: 'cos-card', style: `--tone:${TONE[a.kind]}` },
    h('div', { class: 'cos-need-title' }, titleOf(a)),
    h('div', { class: 'cos-need-trail' }, trail(a), ...('agent' in a ? goalTags(a.agent, 'line').map((tag) => tag.el) : []), ...beamBox(ui, a)),
    h('div', { class: 'cos-card-what' }, h('span', null, icon), what),
    context ? h('div', { class: 'cos-card-context', innerHTML: markdownHtml(context) }) : null,
    ...folds,
    ...answers,
  );
}
