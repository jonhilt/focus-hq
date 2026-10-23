// The threads plugin in the browser: a Threads view in each project's goals panel, after Closed, listing the
// contacts its goals' leads logged and left open, and where the captain decided each of a closed goal's ends.
import { busy, callPlugin, type ClientPlugin, focus, h, pluginState, timeAgo, type Ui } from '../../plugin-api/client';
import { register, type RegisterThread, THREAD_ENDS, type ThreadEnd, THREADS, type ThreadsState } from './shared';
import './threads.css';

/** Project `projectId`'s register as the browser has it now: the server's closed goals', and its goals under way. */
const threadsOf = (projectId: string): RegisterThread[] => register(pluginState<ThreadsState>(THREADS)?.closed[projectId], focus.leadsIn(projectId));

/** Where a thread came from and how old it is: its goal, the contact's id on it, and whether that goal's still under way. */
export function threadSource(t: RegisterThread): string {
  const goal = t.live ? 'goal under way' : t.closedAt === undefined ? 'goal closed' : `goal closed ${timeAgo(t.closedAt)}`;
  return [t.goalTitle, t.contact, `noticed ${timeAgo(t.at)}`, goal].join(' · ');
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

/** The note being written for one thread, kept across the panel being drawn again (it is, as the ship changes). */
let writing: { key: string; as: ThreadEnd; text: string } | null = null;
const keyOf = (t: RegisterThread) => `${t.goal}:${t.contact}`;

/** Asks Focus to write the captain's decision on thread `t`; the register reads it back from the ledger. */
const decide = (projectId: string, t: RegisterThread, as: ThreadEnd | 'open', note = '') =>
  callPlugin(THREADS, '/decide', { projectId, goal: t.goal, contact: t.contact, as, note });

/** The note for a decision being made on `t`, saved with Enter or the button, left with Esc or Cancel. */
function noteForm(ui: Ui, projectId: string, t: RegisterThread, draft: NonNullable<typeof writing>, redraw: () => void): HTMLElement {
  const input = h('input', { class: 'threads-note', placeholder: ENDS[draft.as].ask, value: draft.text });
  const save = h('button', { class: 'btn small primary' }, ENDS[draft.as].button);
  const cancel = h('button', { class: 'btn small' }, 'Cancel');
  input.oninput = () => (draft.text = input.value);
  // the note's put away as it's sent: the register can come back decided (and the panel be drawn again) before Focus
  // answers, and only a refusal brings it back, to be put right
  save.onclick = () =>
    void busy(save, async () => {
      writing = null;
      try {
        await decide(projectId, t, draft.as, input.value);
      } catch (err) {
        writing = { ...draft, text: input.value };
        redraw();
        throw err;
      }
    }, ui.error);
  cancel.onclick = () => ((writing = null), redraw());
  input.onkeydown = (e) => {
    if (e.key === 'Enter') save.click();
    if (e.key === 'Escape') cancel.click();
  };
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'row threads-form' }, input, save, cancel);
}

/** What was decided of a thread, in words. */
export const decidedLine = (t: RegisterThread): string | null => {
  const d = t.decided;
  if (!d) return null;
  const note = d.note ?? (d.as === 'next' ? 'you' : '');
  return `${note ? `${ENDS[d.as].said} ${note}` : ENDS[d.as].button} · ${timeAgo(d.at)}`;
};

/** One thread: what it is, where it came from, and what can be decided of it (or a way to its lead, while its goal's under way). */
function threadRow(ui: Ui, projectId: string, t: RegisterThread, redraw: () => void): HTMLElement {
  const draft = writing?.key === keyOf(t) ? writing : null;
  const ends = offered(t).map((as) =>
    h('button', { class: 'btn small', onclick: () => ((writing = { key: keyOf(t), as, text: '' }), redraw()) }, ENDS[as].button),
  );
  const undo = h('button', { class: 'btn small', title: 'Take the decision back: it goes back to be decided' }, 'Undo');
  undo.onclick = () => void busy(undo, () => decide(projectId, t, 'open'), ui.error);
  const actions = t.live
    ? [h('button', { class: 'btn small', title: `Talk to ${t.leadName}: the thread is theirs while the goal’s under way`, onclick: () => ui.openAgent(t.goal) }, 'Talk')]
    : [...ends, t.decided ? undo : null];
  return h('div', { class: `card threads-row${t.live ? ' live' : ''}${t.decided ? ` ${t.decided.as}` : ''}` },
    h('div', { class: 'row' }, h('span', { class: 'grow threads-text' }, t.text), ...(draft ? [] : actions)),
    h('small', { class: 'muted threads-source' }, threadSource(t)),
    decidedLine(t) ? h('small', { class: 'threads-decided' }, decidedLine(t)) : null,
    draft ? noteForm(ui, projectId, t, draft, redraw) : null,
  );
}

/** The register's sections, in the order they're shown: what's left to decide first, what's been let go last. */
const SECTIONS: { title: string; holds: (t: RegisterThread) => boolean; folded?: true }[] = [
  { title: 'To decide', holds: (t) => !t.live && !t.decided },
  { title: 'Under way', holds: (t) => !!t.live },
  { title: 'Next', holds: (t) => t.decided?.as === 'next' },
  { title: 'Parked', holds: (t) => t.decided?.as === 'parked' },
  { title: 'Dropped or resolved', holds: (t) => t.decided?.as === 'dropped' || t.decided?.as === 'resolved', folded: true },
];

/** Whether a thread still asks something of someone: not dropped or resolved. */
const stillOpen = (t: RegisterThread) => t.decided?.as !== 'dropped' && t.decided?.as !== 'resolved';

/** Project `projectId`'s threads, by where they stand, oldest first in each. */
export function threadsView(ui: Ui, projectId: string): HTMLElement {
  const threads = threadsOf(projectId);
  if (!threads.length) return h('p', { class: 'muted' }, 'No loose threads: every contact this project’s leads logged was pursued or dropped.');
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
    h('p', { class: 'muted threads-intro' }, 'Contacts this project’s leads logged and never pursued or dropped, kept after their goal closed. Decide where each ends: you’re the one who drops a thread.'),
    view,
  );
}

const threads: ClientPlugin = {
  id: THREADS,
  about: {
    name: 'Threads',
    summary: 'Keeps the loose threads a goal’s lead logged and left open, after the goal closes, until you decide where each ends.',
    adds: ['A Threads view in each project’s goals panel, after Closed: next, park, drop or resolved for each closed goal’s thread'],
    cost: 'free',
    costDetail: 'No model calls: it reads the contacts Ops already keeps, and the ledger, where it writes your decisions.',
  },
  project: { label: 'Threads', about: 'A Threads view in the goals panel: every contact its leads logged and left open, the closed goals’ included, and where you decided each ends.' },
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
