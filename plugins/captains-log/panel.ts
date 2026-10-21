import { byDay, callPlugin, fill, h, keysOf, LCARS, focus, shownProjects, type Ui } from '../../plugin-api/client';
import { awayPhrases, awaySummary, CAPTAINS_LOG, type LogLine, type LogSource } from './shared';

/** When the captain last looked at the log, in this browser: "while you were away" counts from there. */
const SEEN = 'focus.captainsLog.seen';
const DAY = 86_400_000;
/** The log's newest lines, at most. */
const MOST = 500;

const SOURCES: Record<LogSource, { label: string; color: string }> = {
  slice: { label: 'Slices', color: LCARS.peach },
  review: { label: 'QA', color: LCARS.periwinkle },
  run: { label: 'Crew', color: LCARS.lilac },
  ledger: { label: 'Ledger', color: LCARS.sky },
};

const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const when = (t: number) => `${new Date(t).toDateString() === new Date().toDateString() ? '' : `${new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} `}${time(t)}`;

function dayOf(t: number): string {
  const day = new Date(t).toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - DAY).toDateString()) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The captain's log: what happened across the ship, from every crew member's run journal, every QA review's, every
 * goal's slices and the ledger, on one timeline, newest first, with what happened since you last looked at the top.
 * Read-only, filtered by where it came from, the room, the goal, or who.
 */
export function openCaptainsLogPanel(ui: Ui): void {
  const now = Date.now();
  const looked = Number(localStorage.getItem(SEEN));
  // the first time, "while you were away" is the last day
  const seen = looked || now - DAY;
  localStorage.setItem(SEEN, String(now));
  const windows = [
    ...(looked ? [{ label: 'Since you last looked', since: seen }] : []),
    { label: 'Last day', since: now - DAY },
    { label: 'Last week', since: now - 7 * DAY },
  ];
  let since = Math.min(seen, now - DAY);
  let lines: LogLine[] = [];
  const show = new Set<LogSource>(keysOf(SOURCES));
  let projectId = '';
  let goal = '';
  let who = '';

  const away = h('div', { class: 'captains-log-away' });
  const row = h('div', { class: 'row' });
  const filters = h('div', { class: 'row ledger-filters' });
  const log = h('div', { class: 'ledger-log' });
  const body = h('div', { class: 'ledger captains-log' }, away, row, filters, log);

  const load = () => {
    fill(log, h('p', { class: 'muted' }, 'Reading the journals…'));
    callPlugin<LogLine[]>(CAPTAINS_LOG, '/log', { since }).then(
      (l) => {
        lines = l;
        render();
      },
      (err: Error) => fill(log, h('p', { class: 'muted' }, `Couldn’t read the log: ${err.message}`)),
    );
  };

  const select = (label: string, options: string[], value: string, pick: (v: string) => void, name = (v: string) => v) => {
    const s = h('select', { style: 'width:auto;max-width:240px', attrs: { 'aria-label': label } }, h('option', { value: '' }, label), ...options.map((o) => h('option', { value: o }, name(o))));
    s.value = value;
    s.onchange = () => pick(s.value);
    return s;
  };

  const render = () => {
    // what happened since you last looked, and what's waiting on you now
    const phrases = awayPhrases(awaySummary(lines, seen));
    const waiting = focus.agents.filter((a) => a.permission || a.status === 'error');
    fill(away,
      h('h3', null, `While you were away (since ${when(seen)})`),
      h('p', null, phrases.length ? phrases.join(' · ') : 'Nothing worth a line.'),
      waiting.length ? h('p', { class: 'captains-log-waiting' }, `Waiting on you: ${waiting.map((a) => `${a.name} (${a.permission ? 'hand up' : 'hit a problem'})`).join(', ')}`) : null,
    );

    const rooms = shownProjects([...focus.projects]).filter((p) => lines.some((l) => l.projectId === p.id));
    const goals = [...new Set(lines.map((l) => l.goal).filter((g): g is string => !!g))];
    const crew = [...new Set(lines.map((l) => l.who))].sort();
    fill(row,
      ...windows.map((w) => {
        const b = h('button', { class: `chip${w.since === since ? '' : ' off'}` }, w.label);
        b.onclick = () => {
          since = w.since;
          load();
        };
        return b;
      }),
      h('span', { class: 'grow' }),
      select('Every room', rooms.map((p) => p.id), projectId, (v) => ((projectId = v), render()), (id) => rooms.find((p) => p.id === id)?.name ?? id),
      select('Every goal', goals, goal, (v) => ((goal = v), render())),
      select('Everyone', crew, who, (v) => ((who = v), render())),
    );

    const picked = lines.filter((l) => (!projectId || l.projectId === projectId) && (!goal || l.goal === goal) && (!who || l.who === who));
    fill(filters, ...keysOf(SOURCES).map((source) => {
      const { label, color } = SOURCES[source];
      const n = picked.filter((l) => l.source === source).length;
      const b = h('button', { class: `chip${show.has(source) ? '' : ' off'}`, style: show.has(source) ? `--tone:${color}` : undefined }, `${label} ${n}`);
      b.onclick = () => {
        if (show.has(source)) show.delete(source);
        else show.add(source);
        render();
      };
      return b;
    }));

    const shown = picked.filter((l) => show.has(l.source)).reverse();
    const rows = shown.slice(0, MOST).map((l) => ({ ...l, at: l.t }));
    fill(log, ...(rows.length
      ? byDay(rows, dayOf).flatMap(({ day, rows }) => [h('h3', null, day), ...rows.map((l) => logRow(l))])
      : [h('p', { class: 'muted' }, 'Nothing in the log for that window and those filters.')]),
      shown.length > MOST ? h('p', { class: 'muted' }, `The newest ${MOST} of ${shown.length}: pick a shorter window or fewer kinds to see further back.`) : null,
    );
  };

  const logRow = (l: LogLine) =>
    h('div', { class: `ledger-row captains-log-row tone-${l.tone}${l.t > seen ? ' new' : ''}` },
      h('span', { class: 'muted' }, time(l.t)),
      h('span', { class: 'chip', style: `--tone:${SOURCES[l.source].color}` }, l.tag),
      h('strong', { class: 'captains-log-who' }, l.who),
      h('div', { class: 'grow' }, h('div', null, l.text), ...(l.quotes ?? []).map((q) => h('q', null, q)), l.goal ? h('small', { class: 'muted' }, l.goal) : null),
    );

  ui.panels.open({ title: 'Captain’s log', body, wide: true });
  load();
}
