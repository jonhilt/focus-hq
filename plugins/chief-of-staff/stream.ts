import { busy, callPlugin, fill, focus, h, LCARS, markdownHtml, messageAgent, onPluginState, pluginState, readPlugin, type Ui } from '../../plugin-api/client';
import { ACTIVE_STATUSES, type Agent, type Attention } from '../../plugin-api/shared';
import { waitingNow } from './here';
import { hailKey, type InboxItem } from './inbox';
import { inbox } from './inboxApi';
import type { LandedItem } from './landed';
import { landedCard } from './landedCard';
import { needCard } from './needCard';
import { CHIEF_OF_STAFF, cosStateOf } from './shared';
import { bundleSays, type CosRow, cosRows, doing, entryView, footOf, goalRow, goalSections, landedSplit, latestNews, prCount, previewFor, READING_ROUTE, seenOf, shownSince, threadKey, type WorkspaceTab } from './streamList';
import type { ThreadEntry } from './thread';
import { chartStrip, type Grade, gradeOf, musterOrder, type Reach, reachOf, watchOf } from './watchRules';
import { workspace } from './workspace';

// Comms as the bridge (README.md#the-watch, docs/interface-style/mockups/bridge-grammar.html): one goal at the conn, the
// rest underway. On the left the rail, every shown project's goals in their berths, staying where they are, each with
// how many decisions wait on it (or how long since anything came in); it folds away to a strip. In the viewer the goal
// at the conn as a sheet: what's agreed on it up top (its chart's last waypoint, where it is and what's next, what's come
// in since the watch began, done looks like), then its thread told by the chief of staff (README.md#a-thread-per-goal),
// what needs the captain there asked at its end, and quick replies at the foot. At the right the lead's workspace
// (workspace.ts), folding to a strip too. With nobody at the conn, or the Muster chip pressed, the viewer is the muster:
// what waits outside the goal at the conn, by what each unblocks. A hail from a goal underway sits over the sheet's
// corner, put on screen there or told to stand by into the muster.

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

/** A thread's title, and under it (after what the caller puts there) what's agreed: done looks like, its pull requests merged, and a way into the lead's room. */
function headEls(lead: Agent, openRoom: () => void, under: (HTMLElement | null)[] = []): HTMLElement[] {
  const work = lead.lead;
  const { merged, prs } = prCount([...(work?.landed ?? []), ...(work?.prs ?? [])]);
  const live = lead.status === 'error' ? 'error' : ['working', 'testing', 'pushing', 'setting-up'].includes(lead.status) ? 'working' : 'quiet';
  const room = h('a', { href: '#', class: 'cos-st-chip', onclick: (e: Event) => { e.preventDefault(); openRoom(); } }, 'Their room ›');
  const done = work?.note?.done;
  return [
    h('div', { class: 'cos-st-head-top' },
      h('div', { class: 'cos-st-title' }, work?.title ?? lead.name),
      h('span', { class: 'cos-st-who' }, h('i', { class: `cos-st-dot ${live}` }), `${lead.name} · ${doing(lead.status)}`)),
    ...under.filter((el) => el !== null),
    ...(done ? [h('div', { class: 'cos-st-done' }, h('b', null, 'Done looks like'), done)] : []),
    h('div', { class: 'cos-st-chips' },
      prs ? h('span', { class: 'cos-st-chip' }, `${merged} of ${prs} pull request${prs === 1 ? '' : 's'} merged`) : null,
      room),
  ];
}

/** Where a reading's ways into the lead's workspace go. */
type OpenWorkspace = (tab: WorkspaceTab, to?: { at?: number; art?: string }) => void;

/**
 * The chief of staff's reading of a turn of the lead's (`says`, or before it wrote one, `why`), and its ways into the
 * workspace: the turn's words, what the lead put on their screen meanwhile (`arts`), their preview when it's the latest.
 */
function readingEl(r: Extract<CosRow, { reading: unknown }>, arts: readonly { id: string; title: string }[], preview: boolean, openWs: OpenWorkspace): HTMLElement {
  const e = r.reading;
  const chip = (label: string, go: () => void) => h('button', { class: 'cos-st-rd-chip', onclick: go }, label);
  const chips = [
    r.turn ? chip('Their words ›', () => openWs('talk', { at: r.turn?.at })) : null,
    ...arts.map((a) => chip(`▣ ${a.title}`, () => openWs('screen', { art: a.id }))),
    preview ? chip('◍ Their preview', () => openWs('browser')) : null,
  ].filter((c) => c !== null);
  return h('div', { class: `cos-st-rd r${e.route}` },
    h('div', { class: 'cos-st-rd-h' }, h('b', null, 'Chief of staff'), h('span', null, READING_ROUTE[e.route]), h('small', null, time(e.at))),
    h('div', { class: 'cos-st-rd-says' }, e.says ?? e.why),
    e.route === 4 && e.message ? h('details', { class: 'cos-st-rd-sent' }, h('summary', null, 'What it told the lead'), h('div', null, e.message)) : null,
    chips.length ? h('div', { class: 'cos-st-rd-chips' }, ...chips) : null);
}

/** A thread's rows as the chief of staff tells it (`cosRows`), with the line where what's new since the captain last looked begins. */
function threadEls(entries: readonly ThreadEntry[], lead: Agent, openWs: OpenWorkspace): HTMLElement[] {
  const arts = lead.lead?.artifacts ?? [];
  const preview = !!previewFor(focus.preview(lead.projectId), [...(lead.lead?.landed ?? []), ...(lead.lead?.prs ?? [])]);
  const rows = cosRows(entries, seenAt(lead.id));
  const latest = rows.findLast((r) => 'reading' in r);
  let after = 0;
  const els = rows.map((r): HTMLElement => {
    if ('reading' in r) {
      const el = readingEl(r, shownSince(arts, after, r.reading.at), preview && r === latest, openWs);
      after = r.reading.at;
      return el;
    }
    if ('bundle' in r) return bundleEl(r.bundle, lead.name);
    if ('entry' in r) return entryEl(r.entry, lead.name);
    return h('div', { class: 'cos-st-new' }, 'New since you last looked');
  });
  return els.length ? els : [h('p', { class: 'muted' }, 'Nothing said here yet.')];
}

/** The captain has seen a goal's thread to its latest entry, at `latest`: what came in until then is no longer new. */
function seen(goal: string, latest: number | undefined): void {
  if (latest !== undefined) markSeen(goal, latest);
}

/** Every shown project's goals: the leads under way in each. */
const allLeads = (): Agent[] => focus.shown.flatMap((p) => focus.leadsIn(p.id));

/** What Comms asks of the app: its panel, and the panels it goes on to (an agent's, a board, the goals, a lead's screen). */
export type CommsUi = Pick<Ui, 'openAgent' | 'openBoard' | 'openGoals' | 'openScreen' | 'goToAgent' | 'error'> & { panels: Pick<Ui['panels'], 'open' | 'own' | 'backTo'> };

/** The watch as Focus keeps it: the goal at the conn while its lead's aboard (`watchOf`), and the hails stood by. */
const watchNow = () => {
  const kept = cosStateOf(pluginState<unknown>(CHIEF_OF_STAFF));
  return { conn: watchOf(kept.conn, (id) => !!focus.agent(id)), stoodBy: new Set(kept.stoodBy ?? []) };
};

/** Something waiting, as the bridge files it: how hard it asks, whether someone's idle on it, and where it reaches the captain. */
interface Filed {
  item: InboxItem;
  grade: Grade;
  idle: boolean;
  since?: number;
  stoodBy: boolean;
  reach: Reach;
}

/** What waits on the captain, filed for the watch; a turn the chief of staff is still reading isn't yet anywhere. */
function filed(open: readonly InboxItem[], conn: string | undefined, stoodBy: ReadonlySet<string>): Filed[] {
  return open.filter((i) => i.lane !== 'judging').map((item) => {
    const grade: Grade = item.lane === 'ready' ? 'word' : gradeOf(item.kind === 'turn' ? item.cos : undefined);
    const agent = item.agentId ? focus.agent(item.agentId) : undefined;
    const idle = !!agent && !ACTIVE_STATUSES.includes(agent.status);
    const by = stoodBy.has(item.id);
    return { item, grade, idle, since: item.since, stoodBy: by, reach: reachOf({ leadId: item.agentId, grade, stoodBy: by }, conn) };
  });
}

/** Who's held up by something in the muster: what it unblocks, in a line. */
function unblocks(f: Filed): string {
  const agent = f.item.agentId ? focus.agent(f.item.agentId) : undefined;
  if (!agent) return `${f.item.who} · nobody waiting`;
  return f.idle ? `${agent.name} idle until you answer` : `${agent.name} still working · nobody waiting yet`;
}

/** The goal's chart as its sheet shows it (`chartStrip`): the last waypoint behind, where it is, the next one dashed. */
function chartEl(lead: Agent): HTMLElement | null {
  const c = chartStrip(lead.lead?.waypoints ?? [], lead.lead?.note?.next ?? []);
  if (!c.here) return null;
  return h('div', { class: 'cos-br-chart', title: 'The whole chart is in their room' },
    c.behind ? h('span', { class: 'cos-br-wp behind' }, `${c.behind} behind`) : null,
    c.last ? h('span', { class: 'cos-br-wp last' }, c.last) : null,
    h('span', { class: 'cos-br-wp here' }, c.here),
    c.next ? h('span', { class: 'cos-br-wp next' }, `${c.next} · next`) : null);
}

/** What came into the goal's thread since the watch began, in a line: how many updates, and what they amount to. */
function sinceEl(entries: readonly ThreadEntry[], from: number | undefined): HTMLElement | null {
  if (from === undefined) return null;
  const since = entries.filter((e) => e.at > from && e.kind !== 'you');
  if (!since.length) return null;
  const at = new Date(from).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return h('div', { class: 'cos-br-since' }, h('b', null, `Since your last watch (${at})`), [`${since.length} update${since.length === 1 ? '' : 's'}`, ...bundleSays(since)].join(' · '));
}

/**
 * Opens Comms, the bridge (README.md#the-watch): the goal at the conn as a sheet in focus, or with none, the muster.
 */
export function openStream(ui: CommsUi): void {
  let { conn } = watchNow();
  // the muster looked at mid-watch, the watch staying on; the muster row opened; the hail put on screen
  let peek = false;
  let expanded: string | null = null;
  let onScreen: string | null = null;
  let reportsOpen = false;
  let open: InboxItem[] = [];
  let landed: LandedItem[] = [];
  let entries: ThreadEntry[] = [];
  let shownThread = '';
  let shownAsk = '';
  // when the captain last looked at the goal at the conn, as the watch began: its sheet opens on what's new since
  let watchFrom = conn ? seenAt(conn) : undefined;

  const status = h('div', { class: 'cos-br-status' });
  const down = h('button', { class: 'cos-br-btn cos-br-down', title: 'The goal goes back to its berth, and the muster comes up' }, 'Stand down');
  const chip = h('button', { class: 'cos-br-chip' });
  const bar = h('div', { class: 'cos-br-bar' }, status, down, chip);
  const goals = h('div', { class: 'cos-st-goals' });
  const left = h('div', { class: 'cos-st-left' });
  const head = h('div', { class: 'cos-st-head' });
  const thread = h('div', { class: 'cos-st-thread' });
  // what needs the captain on the goal, asked at the end of its thread
  const ask = h('div', { class: 'cos-st-ask' });
  const foot = h('div', { class: 'cos-st-foot' });
  const side = h('div', { class: 'cos-st-side' });
  const muster = h('div', { class: 'cos-br-muster' });
  const hail = h('div', { class: 'cos-br-hail', hidden: true });
  const viewer = h('div', { class: 'cos-br-viewer' }, h('div', { class: 'cos-st-right' }, head, thread, foot), muster, hail);
  const body = h('div', { class: 'cos-bridge' }, bar, h('div', { class: 'cos-stream' }, left, viewer, side));
  const back = () => ui.panels.backTo('Comms', () => openStream(ui));
  const openAgent = (id: string) => {
    ui.openAgent(id);
    back();
  };

  // taking the conn of a goal (or standing down, with null): drawn at once, kept by Focus
  // (until Focus has it, what's drawn goes by the captain's press rather than what Focus last said)
  let taking = false;
  const take = (id: string | null) => {
    conn = id ?? undefined;
    peek = false;
    expanded = onScreen = null;
    watchFrom = id ? seenAt(id) : undefined;
    taking = true;
    render();
    void callPlugin(CHIEF_OF_STAFF, '/conn', { lead: id }).catch((e: Error) => ui.error(e.message)).finally(() => {
      taking = false;
      render();
    });
  };
  down.onclick = () => take(null);
  chip.onclick = () => {
    if (!conn) return;
    peek = !peek;
    render();
  };

  // the lead's workspace at the right, or the strip it folds to
  const ws = workspace({
    entryEl,
    fold: () => { localStorage.setItem(WS_FOLDED, '1'); render(); },
    send: (lead, words) => messageAgent(lead.id, lead.name, words).then(() => refreshThread()),
    error: ui.error,
    own: (stop) => ui.panels.own(stop),
  });
  // a reading opens the workspace on what it read, unfolding it first
  const openWs: OpenWorkspace = (tab, to) => {
    if (localStorage.getItem(WS_FOLDED) === '1') {
      localStorage.setItem(WS_FOLDED, '0');
      render();
    }
    ws.open(tab, to);
  };
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

  // the slices that landed in Show: at the end of their goal's thread at the conn, the rest in the muster's reports
  const landedSplitNow = () => landedSplit(landed, (id) => !!focus.agent(id));

  // across the top: the watch, standing down, and the Muster chip with what waits outside the goal at the conn
  const renderBar = (all: readonly Filed[]) => {
    const lead = conn ? focus.agent(conn) : undefined;
    fill(status, lead ? h('span', null, h('b', null, 'On watch'), ` · ${lead.lead?.title ?? lead.name}`) : h('span', null, h('b', null, 'Bridge'), ' · No watch'));
    down.hidden = !lead;
    const count = all.filter((f) => f.reach === 'muster' || f.reach === 'hail').length;
    fill(chip, 'Muster', h('b', null, String(count)));
    chip.classList.toggle('attn', count > 0);
    chip.classList.toggle('on', !lead || peek);
    chip.title = !lead ? 'The muster: what waits on you, by what each unblocks' : peek ? 'Back to the goal at the conn' : 'Look over the muster: the watch stays on';
  };

  // the rail: every goal in its berth by project, staying where it is, with how many decisions wait on it
  const renderLeft = (leads: Agent[], all: readonly Filed[]) => {
    const folded = localStorage.getItem(FOLDED) === '1';
    body.classList.toggle('folded', folded);
    const fold = (to: boolean) => () => {
      localStorage.setItem(FOLDED, to ? '1' : '0');
      render();
    };
    if (folded) {
      const waiting = all.filter((f) => f.reach === 'muster' || f.reach === 'hail').length;
      fill(left, h('button', { class: 'cos-st-strip', title: 'Show the goals', onclick: fold(false) }, h('span', null, `Goals${waiting ? ` · ${waiting} waiting` : ''}`)));
      return;
    }
    fill(left,
      h('div', { class: 'cos-st-left-top' },
        h('button', { class: 'cos-st-foldbtn', title: 'Fold the goals away', onclick: fold(true) }, '‹')),
      goals);
    renderRail(leads, all);
  };

  const renderRail = (leads: Agent[], all: readonly Filed[]) => {
    const now = Date.now();
    const decisions = (id: string) => all.filter((f) => f.item.agentId === id && f.grade !== 'word').length;
    const berth = (l: Agent) => {
      const n = decisions(l.id);
      const r = goalRow(n, latestOf.get(l.id), seenAt(l.id), l.status, now);
      const at = l.id === conn;
      const title = l.lead?.title ?? l.name;
      return h('button', {
        class: `cos-st-row cos-br-berth ${r.dot}${at ? ' sel' : ''}${conn && !at ? ' dim' : ''}`,
        title: `${at ? 'At the conn' : 'Take the conn'}: ${title}\n${l.name} · ${doing(l.status)}`,
        onclick: () => { if (!at) take(l.id); },
      },
      h('i', { class: 'cos-st-dot' }),
      h('span', { class: 'cos-st-row-title' }, title),
      // at the conn, what waits on it is on its sheet
      n && !at ? h('b', { class: 'cos-br-count', title: `${n} decision${n === 1 ? '' : 's'} waiting` }, String(n)) : h('small', null, at ? 'at the conn' : r.right));
    };
    const els = goalSections(leads, focus.shown, () => false).flatMap((s) => {
      const project = focus.project(s.key);
      return [h('h3', { class: 'cos-st-section', style: project ? `--tone:${project.color}` : '' }, s.name), ...s.goals.map(berth)];
    });
    fill(goals, ...(els.length ? els : [h('p', { class: 'muted' }, 'No goals under way.')]));
  };

  // a hail from a goal underway, over the sheet's corner: on screen in place, or told to stand by into the muster
  const renderHail = (all: readonly Filed[]) => {
    const f = all.find((x) => x.reach === 'hail');
    const key = f ? `${f.item.id}|${onScreen === f.item.id}` : '';
    if (hail.dataset.key === key) return;
    hail.dataset.key = key;
    hail.hidden = !f;
    if (!f) return fill(hail);
    const local = waitingNow().find((a) => hailKey(a) === f.item.id);
    const shown = onScreen === f.item.id;
    const standBy = h('button', { class: 'cos-br-btn', title: 'Into the muster, for when you stand down' }, 'Stand by');
    standBy.onclick = () => void busy(standBy, () => callPlugin(CHIEF_OF_STAFF, '/stand-by', { key: f.item.id }), ui.error);
    const screen = h('button', { class: 'cos-br-btn primary', onclick: () => { onScreen = f.item.id; render(); } }, 'On screen');
    fill(hail,
      h('div', { class: 'cos-br-hail-h' }, `Hail · ${f.item.goal} · ${f.item.who}`),
      h('div', { class: 'cos-br-hail-what' }, f.item.what),
      shown && local ? needCard(ui, local, openAgent) : null,
      h('div', { class: 'cos-br-hail-acts' }, standBy, shown ? null : screen));
  };

  // the muster: what waits on the captain outside the goal at the conn, by what each unblocks, the reports folded at its foot
  const renderMuster = (all: readonly Filed[]) => {
    const rows = musterOrder(all.filter((f) => f.reach === 'muster' || f.reach === 'hail'));
    const words = all.filter((f) => f.reach === 'report');
    const landedHere = landed.filter((i) => !(conn && i.leadId === conn));
    const key = JSON.stringify([rows.map((r) => [r.item.id, r.stoodBy, r.idle]), words.map((r) => r.item.id), landedHere.map((i) => i.id), expanded, conn, peek]);
    if (muster.dataset.key === key) return;
    muster.dataset.key = key;
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const lead = conn ? focus.agent(conn) : undefined;
    const reports = words.length + landedHere.length;
    fill(muster,
      h('div', { class: 'cos-br-mh' },
        h('b', null, 'Muster'),
        h('span', null, `${rows.length} decision${rows.length === 1 ? '' : 's'}${reports ? `, ${reports} report${reports === 1 ? '' : 's'}` : ''}`),
        h('small', null, 'by what each unblocks'),
        lead ? h('button', { class: 'cos-br-btn', title: lead.lead?.title ?? lead.name, onclick: () => { peek = false; render(); } }, 'Back to the conn') : null),
      ...(rows.length ? rows.map((f) => musterRow(f, local.get(f.item.id))) : [h('p', { class: 'cos-br-empty' }, lead ? 'Nothing else waits on you.' : 'Nothing waits on you. Take the conn of one goal: the rest stay underway on their orders.')]),
      reports ? reportsEl(words, landedHere, local) : null);
  };

  const musterRow = (f: Filed, a: Attention | undefined) => {
    const agent = f.item.agentId ? focus.agent(f.item.agentId) : undefined;
    const isOpen = expanded === f.item.id;
    const tag = f.grade === 'hail' ? (f.stoodBy ? 'hail, stood by' : 'hail') : '';
    return h('div', { class: `cos-br-row ${f.grade}${isOpen ? ' open' : ''}` },
      h('div', { class: 'cos-br-row-h' },
        h('span', { class: 'cos-br-row-goal' }, f.item.goal, tag ? h('i', null, ` · ${tag}`) : null),
        h('span', { class: 'cos-br-row-what' }, f.item.what),
        h('small', null, unblocks(f))),
      h('div', { class: 'cos-br-row-acts' },
        a ? h('button', { class: 'cos-br-btn primary', onclick: () => { expanded = isOpen ? null : f.item.id; render(); } }, isOpen ? 'Close' : 'Open') : null,
        agent?.task === 'lead' && agent.id !== conn ? h('button', { class: 'cos-br-btn', onclick: () => take(agent.id) }, 'Take the conn') : null),
      isOpen && a ? h('div', { class: 'cos-br-row-card' }, needCard(ui, a, openAgent)) : null);
  };

  // words the chief of staff has ready for leads, and slices that landed in Show: heard with a press, nothing asked
  const reportsEl = (words: readonly Filed[], landedHere: readonly LandedItem[], local: ReadonlyMap<string, Attention>) => {
    const n = words.length + landedHere.length;
    const says = [
      landedHere.length ? `${landedHere.length} slice${landedHere.length === 1 ? '' : 's'} landed in Show` : '',
      words.length ? `${words.length} word${words.length === 1 ? '' : 's'} ready for a lead` : '',
    ].filter(Boolean).join(' · ');
    const el = h('details', { class: 'cos-br-reports', open: reportsOpen },
      h('summary', null, h('b', null, `Reports · ${n}`), h('span', null, says)),
      ...words.flatMap((f) => {
        const a = local.get(f.item.id);
        return a ? [needCard(ui, a, openAgent)] : [];
      }),
      ...landedHere.map((item) => landedCard(ui, item, refreshInbox)));
    el.addEventListener('toggle', () => { reportsOpen = el.open; });
    return el;
  };

  const renderThread = (lead: Agent) => {
    const key = threadKey(lead.id, lead.status, entries);
    if (key === shownThread) return;
    shownThread = key;
    fill(head, ...headEls(lead, () => openAgent(lead.id), [chartEl(lead), sinceEl(entries, watchFrom)]));
    fill(thread, ...threadEls(entries, lead, openWs), ask);
    // from what's new since the captain looked, else the chief of staff's latest reading when it's the last word (what
    // it asks of them comes under it), else the end
    const last = ask.previousElementSibling;
    const to = thread.querySelector<HTMLElement>('.cos-st-new') ?? (last instanceof HTMLElement && last.matches('.cos-st-rd') ? last : null);
    thread.scrollTop = to ? to.offsetTop - thread.offsetTop - 8 : thread.scrollHeight;
    seen(lead.id, entries.at(-1)?.at);
  };

  // what needs the captain on this goal (the card Comms shows), or words the chief of staff has ready for its lead, and
  // what of theirs landed in Show, at the end of its thread
  const renderAsk = (lead: Agent) => {
    const local = new Map(waitingNow().map((a): [string, Attention] => [hailKey(a), a]));
    const { card, ready, key } = footOf(lead.id, open.filter((i) => i.agentId === lead.id), (id) => local.has(id));
    const landedHere = landedSplitNow().byLead.get(lead.id) ?? [];
    // under the chief of staff's reading of the turn, which already says it's for them, the card needs no line of its own
    const read = entries.at(-1)?.kind === 'cos';
    const keyed = `${key}|${read}|${landedHere.map((i) => i.id).join(',')}`;
    if (keyed === shownAsk) return;
    shownAsk = keyed;
    const a = card ? local.get(card) : undefined;
    if (a?.kind === 'turn' && !ready) focus.markRead(a.agent);
    fill(ask,
      ...(a ? [read && !ready ? null : h('div', { class: `cos-st-needs${ready ? ' ready' : ''}` }, ready ? 'The chief of staff · ready to send' : 'The chief of staff · needs you'), needCard(ui, a, openAgent)] : []),
      ...landedHere.flatMap((item) => [h('div', { class: 'cos-st-needs landed' }, 'Landed in Show'), landedCard(ui, item, refreshInbox)]));
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
    if (!taking) ({ conn } = watchNow());
    const all = filed(open, conn, watchNow().stoodBy);
    for (const l of leads) if (!asked.has(l.id) && l.id !== conn) refreshLatest(l.id);
    const mustering = !conn || peek;
    body.classList.toggle('on-watch', !!conn);
    body.classList.toggle('mustering', mustering);
    renderBar(all);
    renderLeft(leads, all);
    renderHail(all);
    if (mustering) renderMuster(all);
    const lead = conn ? focus.agent(conn) : undefined;
    if (!lead) return noGoal();
    if (conn !== fetched) picked();
    renderThread(lead);
    renderAsk(lead);
    renderFoot(lead);
    renderSide(lead);
  };

  const noGoal = () => {
    fetched = null;
    fill(head);
    fill(thread);
    fill(foot);
    fill(side);
    delete foot.dataset.lead;
    delete side.dataset.strip;
  };

  // a goal newly at the conn has its thread asked for
  const picked = () => {
    fetched = conn ?? null;
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
      const id = conn;
      if (!id) return;
      void readPlugin<{ entries: ThreadEntry[] }>(CHIEF_OF_STAFF, `/thread/${encodeURIComponent(id)}`).then((t) => {
        noteLatest(id, t.entries);
        if (conn !== id) return;
        entries = t.entries;
        render();
      }, () => undefined);
    }, fetched === conn && entries.length ? 1000 : 0);
  }
  // the goals underway have their threads asked for too, once as they're shown and again as their lead's turn ends,
  // for when something last came in: their berths say whether it's new since the captain looked
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
  function refreshInbox() {
    void inbox.view().then((view) => {
      open = view.open.filter((i) => !focus.isHidden(i.projectId));
      landed = view.landed.filter((i) => !focus.isHidden(i.projectId));
      render();
    }, () => undefined);
  }

  ui.panels.open({ title: 'Comms', body, wide: true, accent: LCARS.orange });
  render();
  refreshInbox();
  const tick = setInterval(refreshInbox, 5000);
  ui.panels.own(() => {
    clearInterval(tick);
    clearTimeout(asking);
  });
  ui.panels.own(focus.onShip(refreshInbox));
  // the watch changing, here or in another browser: taking the conn, standing down, a hail stood by
  ui.panels.own(onPluginState(CHIEF_OF_STAFF, render));
  // a turn ending is a lead's status turning to done: an agent changes far more often than that
  const statusOf = new Map<string, string>();
  ui.panels.own(focus.onAgent((a) => {
    const ended = a.status === 'done' && statusOf.get(a.id) !== 'done';
    statusOf.set(a.id, a.status);
    if (a.id === conn) refreshThread();
    else if (ended && asked.has(a.id)) refreshLatest(a.id);
  }));
}
