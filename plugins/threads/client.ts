// The threads plugin in the browser: a Threads view in each project's goals panel, after Closed, listing the
// contacts its goals' leads logged and left open and the ideas for next its goals closed with, what a model proposed
// of them (Sort for me), and where the captain decided each of a closed goal's ends.
import { type Agent, busy, callPlugin, type ClientPlugin, focus, goalStarted, goalTitle, h, pluginState, type QueuedGoal, timeAgo, type Ui } from '../../plugin-api/client';
import { type LastSort, register, type RegisterThread, spinOffText, THREAD_ENDS, type ThreadEnd, THREADS, type ThreadsState } from './shared';
import './threads.css';

/** Project `projectId`'s register as the browser has it now: the server's closed goals', and its goals under way. */
const threadsOf = (projectId: string): RegisterThread[] => register(pluginState<ThreadsState>(THREADS)?.closed[projectId], focus.leadsIn(projectId));

/** Where a thread came from and how old it is: its goal, the contact's id on it (or that it's an idea), and whether that goal's still under way. */
export function threadSource(t: RegisterThread): string {
  const goal = t.live ? 'goal under way' : t.closedAt === undefined ? 'goal closed' : `goal closed ${timeAgo(t.closedAt)}`;
  return [t.goalTitle, ...(t.idea ? ['an idea for next'] : [t.contact, `noticed ${timeAgo(t.at)}`]), goal].join(' · ');
}

/** Each end's button, what its note asks for, and how it's said with the note (as typed: "until…", "#1262"). */
const ENDS: Record<ThreadEnd, { button: string; ask: string; said: string }> = {
  next: { button: 'Next', ask: 'Who takes it on? (you, if left empty)', said: 'Taken on by' },
  parked: { button: 'Park', ask: 'Parked until when? (until the first real login, say)', said: 'Parked:' },
  dropped: { button: 'Drop', ask: 'Why drop it?', said: 'Dropped:' },
  resolved: { button: 'Resolved', ask: 'What resolved it? (a pull request, a goal)', said: 'Resolved:' },
};

/** The ends offered for a thread as it stands: every one but its own. */
const offered = (t: RegisterThread): ThreadEnd[] => THREAD_ENDS.filter((end) => end !== t.decided?.as);

/**
 * What's being written for one thread, kept across the panel being drawn again (it is, as the ship changes): the note
 * for a decision, or the first words of the goal of its own it's spun off as.
 */
type Draft = { key: string; as: ThreadEnd; text: string } | { key: string; as: 'goal'; text: string };
let writing: Draft | null = null;
const keyOf = (t: RegisterThread) => `${t.goal}:${t.contact}`;

/** Asks Focus to write the captain's decision on thread `t`; the register reads it back from the ledger. */
const decide = (projectId: string, t: RegisterThread, as: ThreadEnd | 'open', note = '') =>
  callPlugin(THREADS, '/decide', { projectId, goal: t.goal, contact: t.contact, as, note });

/**
 * Sends what's written (`text()`) with `button`. It's put away as it's sent: the register can come back changed (and
 * the panel be drawn again) before Focus answers, and only a refusal brings it back, to be put right.
 */
function send(ui: Ui, button: HTMLButtonElement, draft: Draft, text: () => string, redraw: () => void, go: () => Promise<unknown>): void {
  void busy(button, async () => {
    writing = null;
    try {
      await go();
    } catch (err) {
      writing = { ...draft, text: text() };
      redraw();
      throw err;
    }
  }, ui.error);
}

/** The note for a decision being made on `t`, saved with Enter or the button, left with Esc or Cancel. */
function noteForm(ui: Ui, projectId: string, t: RegisterThread, draft: Draft & { as: ThreadEnd }, redraw: () => void): HTMLElement {
  const input = h('input', { class: 'threads-note', placeholder: ENDS[draft.as].ask, value: draft.text });
  const save = h('button', { class: 'btn small primary' }, ENDS[draft.as].button);
  const cancel = h('button', { class: 'btn small' }, 'Cancel');
  input.oninput = () => (draft.text = input.value);
  save.onclick = () => send(ui, save, draft, () => input.value, redraw, () => decide(projectId, t, draft.as, input.value));
  cancel.onclick = () => ((writing = null), redraw());
  input.onkeydown = (e) => {
    if (e.key === 'Enter') save.click();
    if (e.key === 'Escape') cancel.click();
  };
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'row threads-form' }, input, save, cancel);
}

/** Tells the captain where a goal spun off from a thread went: to a team station, or in line for one. */
function started(ui: Ui, s: { agent: Agent } | { queued: QueuedGoal }): void {
  if ('agent' in s) goalStarted(ui, s.agent);
  else ui.hud.toast('info', `Every team station has a goal: “${goalTitle(s.queued.text)}” waits in line for one`);
}

/** The first words of a goal of its own spun off from `t`, what its lead hears first: started with the button, left with Esc or Cancel. */
function spinOffForm(ui: Ui, projectId: string, t: RegisterThread, draft: Draft, redraw: () => void): HTMLElement {
  const text = h('textarea', { class: 'threads-goal', rows: 5, title: 'What the new goal’s lead hears first' });
  text.value = draft.text;
  const start = h('button', { class: 'btn small primary' }, 'Spin off as a goal');
  const cancel = h('button', { class: 'btn small' }, 'Cancel');
  text.oninput = () => (draft.text = text.value);
  start.onclick = () => send(ui, start, draft, () => text.value, redraw, async () =>
    started(ui, await callPlugin<{ agent: Agent } | { queued: QueuedGoal }>(THREADS, '/spin-off', { projectId, goal: t.goal, contact: t.contact, text: text.value })));
  cancel.onclick = () => ((writing = null), redraw());
  text.onkeydown = (e) => {
    if (e.key === 'Escape') cancel.click();
  };
  setTimeout(() => text.focus(), 0);
  return h('div', { class: 'threads-form' }, text,
    h('div', { class: 'row' }, start, cancel, h('small', { class: 'muted' }, 'It takes the first free team station, or waits in line for one')));
}

/** What was decided of a thread, in words: a goal it was spun off as by `title`, its title now if its lead's on the ship. */
export const decidedLine = (t: RegisterThread, title?: string): string | null => {
  const d = t.decided;
  if (!d) return null;
  if (d.spunOff) return `Spun off as “${title ?? d.spunOff.title}” · ${timeAgo(d.at)}`;
  const note = d.note ?? (d.as === 'next' ? 'you' : '');
  return `${note ? `${ENDS[d.as].said} ${note}` : ENDS[d.as].button} · ${timeAgo(d.at)}`;
};

/** What a model proposed of a thread still to decide, in words, as a decision of it would say it. */
export const proposedLine = (t: RegisterThread): string | null =>
  t.proposed && !t.decided ? `Proposed · ${ENDS[t.proposed.as].said} ${t.proposed.note}` : null;

/** A button that opens a lead's panel, saying why they're the one to talk to. */
const talk = (ui: Ui, lead: Pick<Agent, 'id' | 'name'>, why: string) =>
  h('button', { class: 'btn small', title: `Talk to ${lead.name}: ${why}`, onclick: () => ui.openAgent(lead.id) }, 'Talk');

/**
 * What can be done of a closed goal's thread: each end but its own, a goal of its own (unless it's one already: then a
 * way to that goal's lead, while it's under way), and Undo once it's decided.
 */
function closedActions(ui: Ui, projectId: string, t: RegisterThread, spunLead: Agent | undefined, redraw: () => void): (HTMLElement | null)[] {
  const write = (as: Draft['as'], text: string) => () => ((writing = { key: keyOf(t), as, text }), redraw());
  const ends = offered(t).map((as) => h('button', { class: 'btn small', onclick: write(as, '') }, ENDS[as].button));
  const spin = h('button', { class: 'btn small', title: 'Start a goal of its own from it, with a lead of its own', onclick: write('goal', spinOffText(t)) }, 'Spin off');
  const undo = h('button', { class: 'btn small', title: 'Take the decision back: it goes back to be decided' }, 'Undo');
  undo.onclick = () => void busy(undo, () => decide(projectId, t, 'open'), ui.error);
  const accept = h('button', { class: 'btn small primary', title: 'Decide it as proposed' }, 'Accept');
  accept.onclick = () => void busy(accept, () => callPlugin(THREADS, '/accept', { projectId, goal: t.goal, contact: t.contact }), ui.error);
  return [
    proposedLine(t) ? accept : null,
    spunLead ? talk(ui, spunLead, 'they lead the goal it was spun off as') : null,
    ...ends,
    t.decided?.spunOff ? null : spin,
    t.decided ? undo : null,
  ];
}

/** One thread: what it is, where it came from, and what can be decided of it (or a way to its lead, while its goal's under way). */
function threadRow(ui: Ui, projectId: string, t: RegisterThread, redraw: () => void): HTMLElement {
  const draft = writing?.key === keyOf(t) ? writing : null;
  const spunTo = t.decided?.spunOff?.goal;
  const spunLead = spunTo ? focus.leadsIn(projectId).find((a) => a.id === spunTo) : undefined;
  const actions = t.live ? [talk(ui, { id: t.goal, name: t.leadName }, 'the thread is theirs while the goal’s under way')] : closedActions(ui, projectId, t, spunLead, redraw);
  const decided = decidedLine(t, spunLead?.lead?.title);
  const proposed = proposedLine(t);
  const form = !draft ? null : draft.as === 'goal' ? spinOffForm(ui, projectId, t, draft, redraw) : noteForm(ui, projectId, t, draft, redraw);
  // the thread reads the row's full width, what can be done of it under where it came from
  return h('div', { class: `card threads-row${t.live ? ' live' : ''}${t.decided ? ` ${t.decided.as}` : ''}` },
    h('div', { class: 'threads-text' }, t.text),
    h('small', { class: 'muted threads-source' }, threadSource(t)),
    decided ? h('small', { class: 'threads-decided' }, decided) : null,
    proposed ? h('small', { class: 'threads-proposed' }, proposed) : null,
    form ?? h('div', { class: 'row threads-actions' }, ...actions),
  );
}

/** The register's sections, in the order they're shown: what's left to decide first, what's been let go last. */
const SECTIONS: { title: string; holds: (t: RegisterThread) => boolean; folded?: true }[] = [
  { title: 'To decide', holds: (t) => !t.live && !t.decided && !t.idea },
  { title: 'Ideas left for next', holds: (t) => !t.live && !t.decided && !!t.idea },
  { title: 'Under way', holds: (t) => !!t.live },
  { title: 'Next', holds: (t) => t.decided?.as === 'next' },
  { title: 'Parked', holds: (t) => t.decided?.as === 'parked' },
  { title: 'Dropped or resolved', holds: (t) => t.decided?.as === 'dropped' || t.decided?.as === 'resolved', folded: true },
];

/** Whether a thread still asks something of someone: not dropped or resolved. */
const stillOpen = (t: RegisterThread) => t.decided?.as !== 'dropped' && t.decided?.as !== 'resolved';

/** Each end's bulk accept, one and many: "Accept 1 park", "Accept 4 drops". */
const BULK: Record<ThreadEnd, [string, string]> = { next: ['next', 'next'], parked: ['park', 'parks'], dropped: ['drop', 'drops'], resolved: ['resolved', 'resolved'] };

/** A project's last Sort for me, in words: when, how many it proposed ends for and what it cost, or why it failed. */
export const sortSaid = (last: LastSort): string =>
  last.failed
    ? `The last sort failed ${timeAgo(last.at)}: ${last.failed}`
    : `Sorted ${timeAgo(last.at)}: ends proposed for ${last.proposed} of ${last.asked}${last.costUsd ? ` · $${last.costUsd.toFixed(2)}` : ''}`;

/** Sort for me, and accepting every proposal of one end at once, while there are threads to decide. */
function sortBar(ui: Ui, projectId: string, threads: readonly RegisterThread[]): HTMLElement | null {
  const toDecide = threads.filter((t) => !t.live && !t.decided);
  if (!toDecide.length) return null;
  const sent = pluginState<ThreadsState>(THREADS);
  const running = sent?.sorting[projectId];
  const last = sent?.sorts[projectId];
  const sort = h('button', { class: 'btn small primary', title: 'A model proposes where each thread to decide ends, and which say the same: none ends until you accept it' },
    running ? `Sorting ${running.asked}…` : 'Sort for me');
  sort.disabled = !!running;
  sort.onclick = () => void busy(sort, () => callPlugin(THREADS, '/sort', { projectId }), ui.error);
  const bulk = THREAD_ENDS.flatMap((as) => {
    const n = toDecide.filter((t) => t.proposed?.as === as).length;
    if (!n) return [];
    const b = h('button', { class: 'btn small', title: `Decide every thread with it proposed, as proposed` }, `Accept ${n} ${BULK[as][n === 1 ? 0 : 1]}`);
    b.onclick = () => void busy(b, () => callPlugin(THREADS, '/accept', { projectId, as }), ui.error);
    return [b];
  });
  return h('div', { class: 'threads-sort' }, h('div', { class: 'row threads-actions' }, sort, ...bulk), last ? h('small', { class: 'muted' }, sortSaid(last)) : null);
}

/** Project `projectId`'s threads, by where they stand, oldest first in each. */
export function threadsView(ui: Ui, projectId: string): HTMLElement {
  const threads = threadsOf(projectId);
  if (!threads.length) return h('p', { class: 'muted' }, 'No loose threads: every contact this project’s leads logged was pursued or dropped, and no goal closed with ideas left.');
  const view = h('div', { class: 'threads-view' });
  const redraw = () => view.replaceChildren(...sections());
  const sections = () => SECTIONS.flatMap((s) => {
    const mine = threads.filter(s.holds);
    if (!mine.length) return [];
    const rows = mine.map((t) => threadRow(ui, projectId, t, redraw));
    const head = `${s.title} (${mine.length})`;
    return [s.folded ? h('details', { class: 'threads-section' }, h('summary', null, head), ...rows) : h('div', { class: 'cards threads-section' }, h('h3', null, head), ...rows)];
  });
  redraw();
  return h('div', null,
    h('p', { class: 'muted threads-intro' }, 'Contacts this project’s leads logged and never pursued or dropped, and the ideas for next its goals closed with, kept after their goal closed. Decide where each ends, or have them sorted for you to accept: you’re the one who drops a thread.'),
    sortBar(ui, projectId, threads),
    view,
  );
}

const threads: ClientPlugin = {
  id: THREADS,
  about: {
    name: 'Threads',
    summary: 'Keeps the loose threads a goal’s lead logged and left open, and the ideas for next it closed with, after the goal closes, until you decide where each ends.',
    adds: [
      'A Threads view in each project’s goals panel, after Closed: next, park, drop or resolved for each closed goal’s thread, or a goal of its own',
      'Sort for me: a model proposes where each thread ends, and which say the same, for you to accept one by one or all of an end at once',
    ],
    cost: 'on-demand',
    costDetail: 'Sort for me asks Sonnet once a press, about a batch of a project’s threads, and shows what it cost. Nothing else makes model calls: it reads the contacts and ideas Ops already keeps, and the ledger, where it writes your decisions. A thread you spin off is a goal like any other.',
  },
  project: { label: 'Threads', about: 'A Threads view in the goals panel: every contact its leads logged and left open and every idea for next its goals closed with, what a model proposed of them, and where you decided each ends.' },
  goalsView: {
    label: 'Threads',
    // the threads still asking something of someone; 0 while every one's dropped or resolved, so they can be looked back at
    readout: (projectId) => {
      const threads = threadsOf(projectId);
      return threads.length ? String(threads.filter(stillOpen).length) : '';
    },
    render: threadsView,
  },
  start() {
    // the ledger as it is now, closed goals and decisions and all, in case it changed since Focus started
    callPlugin(THREADS, '/read').catch((err: unknown) => console.error('The threads plugin couldn’t read the ledger', err));
  },
};

export default threads;
