import { busy, fill, focus, h, LCARS, markdownHtml, messageAgent, readPlugin } from '../../plugin-api/client';
import type { Agent, Attention } from '../../plugin-api/shared';
import { type CommsUi, openComms } from './comms';
import { lanes } from './commsList';
import { waitingNow } from './here';
import { hailKey, type InboxItem } from './inbox';
import { inbox } from './inboxApi';
import { needCard } from './needCard';
import { CHIEF_OF_STAFF } from './shared';
import { doing, entryView, footOf, goalLine, headLine, latestNews, pickGoal, seenOf, threadKey, threadRows } from './streamList';
import type { ThreadEntry } from './thread';

// The stream (README.md#a-thread-per-goal): Comms as one stream per project, a thread per goal. Along the top the
// projects, each with what needs the captain there; on the left the project's goals, each with what needs them, what's
// new since they last looked, or what its lead is doing, and the pull requests and closes waiting on them; on the right
// the goal picked, as a thread: the conversation in order, the rest as quiet lines, a line where what's new since they
// last looked begins, and at the foot what needs them there (the card Comms would show) or a box to talk to the lead.

/** The goal picked, and the project, when the stream last closed: it opens on them again. */
let keptGoal: string | null = null;
let keptProject: string | null = null;

/** When the captain last looked at each goal's thread (its latest entry's time), kept in this browser. */
const SEEN = 'cos-stream-seen';
const seenAll = (): Record<string, number> => {
  try {
    return seenOf(JSON.parse(localStorage.getItem(SEEN) ?? '{}'));
  } catch {
    return {};
  }
};
const seenAt = (goal: string): number | undefined => seenAll()[goal];
const markSeen = (goal: string, at: number) => localStorage.setItem(SEEN, JSON.stringify({ ...seenAll(), [goal]: at }));

/** When something last came into each goal's thread from anyone but the captain, as last fetched: the goals' lines say what's new by it. */
const latestOf = new Map<string, number>();

const time = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** One entry of a thread, as it reads (`entryView`). */
function entryEl(e: ThreadEntry, lead: string): HTMLElement {
  const v = entryView(e);
  if (v.as === 'you') return h('div', { class: 'cos-st-you' }, h('small', null, `You${v.via ? `, from ${v.via}` : ''} · ${time(e.at)}`), h('div', { class: 'cos-st-text' }, v.text));
  if (v.as === 'lead') {
    const text = h('div', { class: 'cos-st-text cos-st-md' });
    text.innerHTML = markdownHtml(v.text);
    return h('div', { class: 'cos-st-lead' }, h('small', null, `${lead} · ${time(e.at)}`), text);
  }
  const line = h('div', { class: `cos-st-line ${v.tone}` }, h('span', null, v.text), h('small', null, time(e.at)));
  if (!v.more) return line;
  return h('details', { class: `cos-st-fold ${v.tone}` }, h('summary', null, line), h('div', { class: 'cos-st-more' }, v.more));
}

/** A thread's title, and under it who leads it, what they're doing, what done looks like, and a way into their room. */
function headEls(lead: Agent, openRoom: () => void): HTMLElement[] {
  const room = h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); openRoom(); } }, 'Open their room');
  return [h('div', { class: 'cos-st-title' }, lead.lead?.title ?? lead.name), h('small', null, `${headLine(lead.name, lead.status, lead.lead?.note?.done)} · `, room)];
}

/** A thread's rows, with the line where what's new since the captain last looked begins (`threadRows`). */
function threadEls(entries: readonly ThreadEntry[], lead: Agent): HTMLElement[] {
  const rows = threadRows(entries, seenAt(lead.id)).map((r) => ('entry' in r ? entryEl(r.entry, lead.name) : h('div', { class: 'cos-st-new' }, 'New since you last looked')));
  return rows.length ? rows : [h('p', { class: 'muted' }, 'Nothing said here yet.')];
}

/** The captain has seen a goal's thread to its latest entry, at `latest`: what came in until then is no longer new. */
function seen(goal: string, latest: number | undefined): void {
  if (latest !== undefined) markSeen(goal, latest);
}

/** Opens the stream on the goal picked last, or the first that needs the captain. */
export function openStream(ui: CommsUi): void {
  let project = keptProject && focus.shown.some((p) => p.id === keptProject) ? keptProject : (focus.shown[0]?.id ?? null);
  let goal: string | null = keptGoal;
  let open: InboxItem[] = [];
  let entries: ThreadEntry[] = [];
  let shownThread = '';
  let shownFoot = '';

  const tabs = h('div', { class: 'cos-comms-tabs' });
  const goals = h('div', { class: 'cos-st-goals' });
  const shelf = h('div', { class: 'cos-st-shelf' });
  const head = h('div', { class: 'cos-st-head' });
  const thread = h('div', { class: 'cos-st-thread' });
  const foot = h('div', { class: 'cos-st-foot' });
  const body = h('div', { class: 'cos-stream' },
    tabs,
    h('div', { class: 'cos-st-left' }, h('h3', null, 'Goals'), goals, shelf),
    h('div', { class: 'cos-st-right' }, head, thread, foot),
  );
  const back = () => ui.panels.backTo('Comms', () => openStream(ui));
  const openAgent = (id: string) => {
    ui.openAgent(id);
    back();
  };

  const flaggedFor = (leadId: string) => open.filter((i) => i.lane === 'needs-you' && i.agentId === leadId);

  const renderTabs = () => {
    const counts = new Map<string, number>();
    for (const i of lanes(open, null).flagged) counts.set(i.projectId, (counts.get(i.projectId) ?? 0) + 1);
    fill(tabs,
      ...focus.shown.map((p) => h('button', { class: `cos-comms-tab${project === p.id ? ' on' : ''}`, style: `--tone:${p.color}`, onclick: () => { project = keptProject = p.id; goal = null; render(); } },
        p.name, counts.get(p.id) ? h('b', null, String(counts.get(p.id))) : null)),
      h('button', { class: 'cos-comms-tab goals', title: 'The inbox as it was: everything waiting on you, in one list', onclick: () => openComms(ui) }, 'Inbox ›'),
    );
  };

  const renderGoals = (leads: Agent[]) => {
    fill(goals, ...(leads.length ? leads.map((l) => {
      const line = goalLine(flaggedFor(l.id), latestOf.get(l.id), seenAt(l.id), doing(l.status));
      return h('button', { class: `cos-st-goal ${line.tone}${l.id === goal ? ' sel' : ''}`, onclick: () => { goal = keptGoal = l.id; render(); } },
        h('span', { class: 'cos-st-goal-title' }, l.lead?.title ?? l.name),
        h('small', null, `${l.name.replace(/^Lt\. /, '')} · ${line.text}`));
    }) : [h('p', { class: 'muted' }, 'No goals under way here.')]));
    // what waits on the captain that isn't a goal's conversation: pull requests with nobody's lead on them
    const loose = lanes(open, project).flagged.filter((i) => !i.agentId);
    shelf.hidden = !loose.length;
    fill(shelf, h('h3', null, `Ready for you · ${loose.length}`), ...loose.map((i) => h('div', { class: 'cos-st-shelf-item' }, h('span', null, i.what), h('small', null, i.who))));
  };

  const renderThread = (lead: Agent) => {
    const key = threadKey(lead.id, lead.status, entries);
    if (key === shownThread) return;
    shownThread = key;
    fill(head, ...headEls(lead, () => openAgent(lead.id)));
    fill(thread, ...threadEls(entries, lead));
    (thread.querySelector('.cos-st-new') ?? thread.lastElementChild)?.scrollIntoView({ block: 'start' });
    seen(lead.id, entries.at(-1)?.at);
  };

  // at the foot, what needs the captain on this goal (the card Comms shows), or a box to talk to its lead
  const renderFoot = (lead: Agent) => {
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const { card, key } = footOf(lead.id, flaggedFor(lead.id), (id) => local.has(id));
    if (key === shownFoot) return;
    shownFoot = key;
    const a = card ? local.get(card) : undefined;
    if (a) {
      if (a.kind === 'turn') focus.markRead(a.agent);
      fill(foot, h('div', { class: 'cos-st-needs' }, 'Needs you'), needCard(ui, a, openAgent));
      return;
    }
    fill(foot, talkBox(lead));
  };

  // a box to talk to the lead, their thread asked for again once it's sent
  const talkBox = (lead: Agent) => {
    const box = h('textarea', { rows: 3, placeholder: `Talk to ${lead.name}…` });
    const send = h('button', { class: 'cos-st-send', onclick: () => {
      const words = box.value.trim();
      if (words) void busy(send, () => messageAgent(lead.id, lead.name, words).then(() => { box.value = ''; refreshThread(); }), ui.error);
    } }, 'Send');
    return h('div', { class: 'cos-st-talk' }, box, send);
  };

  const render = () => {
    const leads = project ? focus.leadsIn(project) : [];
    goal = pickGoal(goal, leads, (id) => flaggedFor(id).length > 0);
    for (const l of leads) if (!asked.has(l.id) && l.id !== goal) refreshLatest(l.id);
    renderTabs();
    renderGoals(leads);
    if (goal !== fetched) picked();
    const lead = goal ? focus.agent(goal) : undefined;
    if (!lead) return noGoal();
    renderThread(lead);
    renderFoot(lead);
  };

  const noGoal = () => {
    fill(head);
    fill(thread, h('p', { class: 'muted' }, 'Pick a goal.'));
    fill(foot);
  };

  // a goal newly picked, by the captain or for them, has its thread asked for
  const picked = () => {
    fetched = goal;
    entries = [];
    shownThread = shownFoot = '';
    refreshThread();
  };

  // the goal's thread is Focus's, asked for as it's picked and whenever its lead changes (a turn ends, say), at most
  // every second
  let fetched: string | null = null;
  let asking: ReturnType<typeof setTimeout> | undefined;
  function refreshThread() {
    clearTimeout(asking);
    asking = setTimeout(() => {
      const id = goal;
      if (!id) return;
      void readPlugin<{ entries: ThreadEntry[] }>(CHIEF_OF_STAFF, `/thread/${encodeURIComponent(id)}`).then((t) => {
        noteLatest(id, t.entries);
        if (goal !== id) return;
        entries = t.entries;
        render();
      }, () => undefined);
    }, fetched === goal && entries.length ? 1000 : 0);
  }
  // the goals not picked have their threads asked for too, once as they're shown and again as their lead's turn ends,
  // for when something last came in: their lines say whether it's new since the captain looked
  const asked = new Set<string>();
  const noteLatest = (id: string, list: readonly ThreadEntry[]) => {
    const at = latestNews(list);
    if (at !== undefined) latestOf.set(id, at);
  };
  const refreshLatest = (id: string) => {
    asked.add(id);
    void readPlugin<{ entries: ThreadEntry[] }>(CHIEF_OF_STAFF, `/thread/${encodeURIComponent(id)}`).then((t) => {
      noteLatest(id, t.entries);
      render();
    }, () => undefined);
  };
  const refreshInbox = () => void inbox.view().then((view) => {
    open = view.open.filter((i) => !focus.isHidden(i.projectId));
    render();
  }, () => undefined);

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  render();
  refreshInbox();
  const tick = setInterval(refreshInbox, 5000);
  ui.panels.own(() => {
    clearInterval(tick);
    clearTimeout(asking);
  });
  ui.panels.own(focus.onShip(refreshInbox));
  // a turn ending is a lead's status turning to done: an agent changes far more often than that
  const statusOf = new Map<string, string>();
  ui.panels.own(focus.onAgent((a) => {
    const ended = a.status === 'done' && statusOf.get(a.id) !== 'done';
    statusOf.set(a.id, a.status);
    if (a.id === goal) refreshThread();
    else if (ended && asked.has(a.id)) refreshLatest(a.id);
  }));
}
