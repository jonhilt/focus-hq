import { busy, fill, focus, h, LCARS, markdownHtml, messageAgent, readPlugin, type Ui } from '../../plugin-api/client';
import type { Agent, Attention } from '../../plugin-api/shared';
import { waitingNow } from './here';
import { hailKey, type InboxItem } from './inbox';
import { inbox } from './inboxApi';
import { needCard } from './needCard';
import { CHIEF_OF_STAFF } from './shared';
import { type BundledRow, bundleRows, bundleSays, doing, entryView, footOf, goalRow, goalSections, latestNews, pickGoal, prCount, seenOf, threadKey, threadRows } from './streamList';
import type { ThreadEntry } from './thread';
import { workspace } from './workspace';

// The stream (README.md#a-thread-per-goal): Comms as a thread per goal. On the left every shown project's goals in one
// list, what needs the captain first and then each project's others under its name, a compact row each (a dot for its
// state, how long since anything came in), and what waits on them outside any goal's conversation; the list folds away
// to a strip. On the right the goal picked: what's agreed on it up top (done looks like, its pull requests, its
// decisions), then its thread (the conversation in order, quiet lines between messages bundled, a line where what's new
// since they last looked begins, and what needs them there asked at its end), and at the foot quick replies. At the
// right the lead's workspace (workspace.ts), with the box to talk to them; it folds away to a strip too.

/** The goal picked when the stream last closed: it opens on it again. */
let keptGoal: string | null = null;

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

/** Whether the goals list, and the lead's workspace, are folded to a strip, kept in this browser. */
const FOLDED = 'cos-stream-goals-folded';
const WS_FOLDED = 'cos-stream-workspace-folded';

/** When something last came into each goal's thread from anyone but the captain, as last fetched: the goals' rows say what's new by it. */
const latestOf = new Map<string, number>();

/** What the quick replies say to the lead, a press each. */
const QUICK = ['Carry on', 'Show me first', 'Hold off for now', 'Why?'];

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

/** Two or more quiet lines in a row, as one: how many, and what they amount to (`bundleSays`); opened, the lines. */
function bundleEl(entries: ThreadEntry[], lead: string): HTMLElement {
  const says = bundleSays(entries);
  return h('details', { class: 'cos-st-bundle' },
    h('summary', null, h('b', null, `${entries.length} updates`), says.length ? h('span', null, says.join(' · ')) : null, '›'),
    h('div', { class: 'cos-st-bundle-lines' }, ...entries.map((e) => entryEl(e, lead))));
}

/** A thread's title, and under it what's agreed: done looks like, its pull requests merged, and a way into the lead's room. */
function headEls(lead: Agent, openRoom: () => void): HTMLElement[] {
  const work = lead.lead;
  const { merged, prs } = prCount([...(work?.landed ?? []), ...(work?.prs ?? [])]);
  const live = lead.status === 'error' ? 'error' : ['working', 'testing', 'pushing', 'setting-up'].includes(lead.status) ? 'working' : 'quiet';
  const room = h('a', { href: '#', class: 'cos-st-chip', onclick: (e: Event) => { e.preventDefault(); openRoom(); } }, 'Their room ›');
  const done = work?.note?.done;
  return [
    h('div', { class: 'cos-st-head-top' },
      h('div', { class: 'cos-st-title' }, work?.title ?? lead.name),
      h('span', { class: 'cos-st-who' }, h('i', { class: `cos-st-dot ${live}` }), `${lead.name} · ${doing(lead.status)}`)),
    ...(done ? [h('div', { class: 'cos-st-done' }, h('b', null, 'Done looks like'), done)] : []),
    h('div', { class: 'cos-st-chips' },
      prs ? h('span', { class: 'cos-st-chip' }, `${merged} of ${prs} pull request${prs === 1 ? '' : 's'} merged`) : null,
      room),
  ];
}

/** A thread's rows: its entries with quiet lines bundled, and the line where what's new since the captain last looked begins. */
function threadEls(entries: readonly ThreadEntry[], lead: Agent): HTMLElement[] {
  const rowEl = (r: BundledRow): HTMLElement => {
    if ('bundle' in r) return bundleEl(r.bundle, lead.name);
    if ('entry' in r) return entryEl(r.entry, lead.name);
    return h('div', { class: 'cos-st-new' }, 'New since you last looked');
  };
  const rows = bundleRows(threadRows(entries, seenAt(lead.id))).map(rowEl);
  return rows.length ? rows : [h('p', { class: 'muted' }, 'Nothing said here yet.')];
}

/** The captain has seen a goal's thread to its latest entry, at `latest`: what came in until then is no longer new. */
function seen(goal: string, latest: number | undefined): void {
  if (latest !== undefined) markSeen(goal, latest);
}

/** Every shown project's goals: the leads under way in each. */
const allLeads = (): Agent[] => focus.shown.flatMap((p) => focus.leadsIn(p.id));

/** What Comms asks of the app: its panel, and the panels it goes on to (an agent's, a board, the goals, a lead's screen). */
export type CommsUi = Pick<Ui, 'openAgent' | 'openBoard' | 'openGoals' | 'openScreen' | 'goToAgent' | 'error'> & { panels: Pick<Ui['panels'], 'open' | 'own' | 'backTo'> };

/** Opens the stream on the goal picked last, or the first that needs the captain. */
export function openStream(ui: CommsUi): void {
  let goal: string | null = keptGoal;
  let open: InboxItem[] = [];
  let entries: ThreadEntry[] = [];
  let shownThread = '';
  let shownAsk = '';

  const goals = h('div', { class: 'cos-st-goals' });
  const left = h('div', { class: 'cos-st-left' });
  const head = h('div', { class: 'cos-st-head' });
  const thread = h('div', { class: 'cos-st-thread' });
  // what needs the captain on the goal, asked at the end of its thread
  const ask = h('div', { class: 'cos-st-ask' });
  const foot = h('div', { class: 'cos-st-foot' });
  const side = h('div', { class: 'cos-st-side' });
  const body = h('div', { class: 'cos-stream' }, left, h('div', { class: 'cos-st-right' }, head, thread, foot), side);
  const back = () => ui.panels.backTo('Comms', () => openStream(ui));
  const openAgent = (id: string) => {
    ui.openAgent(id);
    back();
  };

  // the lead's workspace at the right, or the strip it folds to
  const ws = workspace({
    entryEl,
    fold: () => { localStorage.setItem(WS_FOLDED, '1'); render(); },
    send: (lead, words) => messageAgent(lead.id, lead.name, words).then(() => refreshThread()),
    error: ui.error,
    own: (stop) => ui.panels.own(stop),
  });
  const renderSide = (lead: Agent) => {
    const folded = localStorage.getItem(WS_FOLDED) === '1';
    body.classList.toggle('ws-folded', folded);
    if (folded) {
      if (side.dataset.strip !== lead.id) {
        side.dataset.strip = lead.id;
        fill(side, h('button', { class: 'cos-st-strip', title: 'Show their workspace', onclick: () => { localStorage.setItem(WS_FOLDED, '0'); render(); } }, h('span', null, `${lead.name}'s workspace`)));
      }
      return;
    }
    delete side.dataset.strip;
    if (side.firstChild !== ws.el) fill(side, ws.el);
    ws.show(lead, entries);
  };

  const flaggedFor = (leadId: string) => open.filter((i) => i.lane === 'needs-you' && i.agentId === leadId);

  // the goals list, or the strip it folds to
  const renderLeft = (leads: Agent[]) => {
    const folded = localStorage.getItem(FOLDED) === '1';
    body.classList.toggle('folded', folded);
    const fold = (to: boolean) => () => {
      localStorage.setItem(FOLDED, to ? '1' : '0');
      render();
    };
    if (folded) {
      const needing = leads.filter((l) => flaggedFor(l.id).length).length;
      fill(left, h('button', { class: 'cos-st-strip', title: 'Show the goals', onclick: fold(false) }, h('span', null, `Goals${needing ? ` · ${needing} need you` : ''}`)));
      return;
    }
    fill(left,
      h('div', { class: 'cos-st-left-top' },
        h('button', { class: 'cos-st-foldbtn', title: 'Fold the goals away', onclick: fold(true) }, '‹')),
      goals);
    renderGoals(leads);
  };

  const renderGoals = (leads: Agent[]) => {
    const now = Date.now();
    const sections = goalSections(leads, focus.shown, (id) => flaggedFor(id).length > 0);
    // what waits on the captain that isn't a goal's conversation: pull requests with nobody's lead on them, by project
    const loose = open.filter((i) => i.lane === 'needs-you' && !i.agentId);
    const row = (l: Agent) => {
      const r = goalRow(flaggedFor(l.id).length, latestOf.get(l.id), seenAt(l.id), l.status, now);
      return h('button', { class: `cos-st-row ${r.dot}${l.id === goal ? ' sel' : ''}`, title: `${l.lead?.title ?? l.name}\n${l.name} · ${doing(l.status)}`, onclick: () => { goal = keptGoal = l.id; render(); } },
        h('i', { class: 'cos-st-dot' }),
        h('span', { class: 'cos-st-row-title' }, l.lead?.title ?? l.name),
        h('small', null, r.right));
    };
    const looseIn = (projectId: string) => loose.filter((i) => i.projectId === projectId).map((i) => h('div', { class: 'cos-st-loose' }, h('span', null, i.what), h('small', null, `Ready for you · ${i.who}`)));
    const els = sections.flatMap((s) => {
      const project = focus.project(s.key);
      return [h('h3', { class: `cos-st-section${s.key === 'needs' ? ' needs' : ''}`, style: project ? `--tone:${project.color}` : '' }, s.name), ...s.goals.map(row), ...(project ? looseIn(project.id) : [])];
    });
    // a project with nothing under way may still have something ready for the captain
    const listed = new Set(sections.map((s) => s.key));
    for (const p of focus.shown) if (!listed.has(p.id) && looseIn(p.id).length) els.push(h('h3', { class: 'cos-st-section', style: `--tone:${p.color}` }, p.name), ...looseIn(p.id));
    fill(goals, ...(els.length ? els : [h('p', { class: 'muted' }, 'No goals under way.')]));
  };

  const renderThread = (lead: Agent) => {
    const key = threadKey(lead.id, lead.status, entries);
    if (key === shownThread) return;
    shownThread = key;
    fill(head, ...headEls(lead, () => openAgent(lead.id)));
    fill(thread, ...threadEls(entries, lead), ask);
    const to = thread.querySelector<HTMLElement>('.cos-st-new');
    thread.scrollTop = to ? to.offsetTop - thread.offsetTop - 8 : thread.scrollHeight;
    seen(lead.id, entries.at(-1)?.at);
  };

  // what needs the captain on this goal (the card Comms shows), asked at the end of its thread
  const renderAsk = (lead: Agent) => {
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const { card, key } = footOf(lead.id, flaggedFor(lead.id), (id) => local.has(id));
    if (key === shownAsk) return;
    shownAsk = key;
    const a = card ? local.get(card) : undefined;
    if (!a) return fill(ask);
    if (a.kind === 'turn') focus.markRead(a.agent);
    fill(ask, h('div', { class: 'cos-st-needs' }, 'The chief of staff · needs you'), needCard(ui, a, openAgent));
  };

  // at the foot, quick replies to the lead, their thread asked for again once one's sent; the box to talk to them is in their workspace
  const renderFoot = (lead: Agent) => {
    if (foot.dataset.lead === lead.id) return;
    foot.dataset.lead = lead.id;
    const say = (words: string, el: HTMLButtonElement) => void busy(el, () => messageAgent(lead.id, lead.name, words).then(() => refreshThread()), ui.error);
    fill(foot, h('div', { class: 'cos-st-quick' }, ...QUICK.map((q) => {
      const b = h('button', { onclick: () => say(q, b) }, q);
      return b;
    })));
  };

  const render = () => {
    const leads = allLeads();
    goal = pickGoal(goal, leads, (id) => flaggedFor(id).length > 0);
    for (const l of leads) if (!asked.has(l.id) && l.id !== goal) refreshLatest(l.id);
    renderLeft(leads);
    if (goal !== fetched) picked();
    const lead = goal ? focus.agent(goal) : undefined;
    if (!lead) return noGoal();
    renderThread(lead);
    renderAsk(lead);
    renderFoot(lead);
    renderSide(lead);
  };

  const noGoal = () => {
    fill(head);
    fill(thread, h('p', { class: 'muted' }, 'No goals under way.'));
    fill(foot);
    fill(side);
    delete foot.dataset.lead;
    delete side.dataset.strip;
  };

  // a goal newly picked, by the captain or for them, has its thread asked for
  const picked = () => {
    fetched = goal;
    entries = [];
    shownThread = shownAsk = '';
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
  // for when something last came in: their rows say whether it's new since the captain looked
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
