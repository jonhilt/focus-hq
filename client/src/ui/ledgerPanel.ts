import type { LedgerEvent } from '../../../shared/ledger';
import { byDay, GROUP_LABEL, groupCounts, ledgerLog, type LedgerRow, REVIEW_GROUPS, type ReviewGroup, SHOWN_AT_FIRST, trace, type TraceSubject } from '../../../shared/ledgerReview';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { fill, h } from './dom';

/** Each group's colour, on its filter and on its rows' pills. */
const COLOR: Record<ReviewGroup, string> = {
  qa: LCARS.periwinkle,
  merged: LCARS.sky,
  conflicts: LCARS.red,
  goals: LCARS.peach,
  retro: LCARS.gold,
  sessions: LCARS.lilac,
  frictions: LCARS.orange,
};
const WINDOWS = [7, 14, 30, 90];
/** The log's newest rows, at most: a long window's sessions would be thousands. */
const MOST = 400;

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function dayOf(at: number): string {
  const day = new Date(at).toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Reviewing the ledger at main engineering's master systems table: the log of what happened over a window, filtered by
 * kind and project, and the trace of whichever pull request or goal you pick in it, everything the ledger says about
 * it in order with what it cost. Read-only: the retro, at Lt. Brennan's station, is where anything gets decided.
 */
export function openLedgerPanel(ui: Ui): void {
  let days = 14;
  let projectId = '';
  let events: LedgerEvent[] = [];
  let subject: TraceSubject | null = null;
  const show = new Set<ReviewGroup>(SHOWN_AT_FIRST);

  const windows = h('div', { class: 'row' });
  const projects = h('select', { style: 'width:auto' }, h('option', { value: '' }, 'All projects'), ...state.shown.map((p) => h('option', { value: p.id }, p.name)));
  projects.onchange = () => {
    projectId = projects.value;
    render();
  };
  const retro = h('button', { class: 'btn small' }, 'Retro →');
  retro.onclick = () => ui.openEngineering();
  const filters = h('div', { class: 'row ledger-filters' });
  const log = h('div', { class: 'ledger-log' });
  const traced = h('div', { class: 'ledger-trace' });
  const body = h('div', { class: 'ledger' },
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Look back'), windows, projects, h('span', { class: 'grow' }), retro),
    filters,
    h('div', { class: 'ledger-cols' }, log, traced),
  );

  const load = () => {
    fill(log, h('p', { class: 'muted' }, 'Reading the ledger…'));
    api.ledger(days).then(
      (e) => {
        events = e;
        render();
      },
      (err: Error) => fill(log, h('p', { class: 'muted' }, `Couldn’t read the ledger: ${err.message}`)),
    );
  };

  const pick = (s: TraceSubject) => {
    subject = s;
    render();
  };

  const render = () => {
    fill(windows, ...WINDOWS.map((d) => {
      const b = h('button', { class: `chip${d === days ? '' : ' off'}` }, `${d} days`);
      b.onclick = () => {
        days = d;
        load();
      };
      return b;
    }));
    const counts = groupCounts(events, projectId || undefined);
    fill(filters, ...REVIEW_GROUPS.map((g) => {
      const b = h('button', { class: `chip${show.has(g) ? '' : ' off'}`, style: show.has(g) ? `--tone:${COLOR[g]}` : undefined }, `${GROUP_LABEL[g]} ${counts[g]}`);
      b.onclick = () => {
        if (show.has(g)) show.delete(g);
        else show.add(g);
        render();
      };
      return b;
    }), h('small', { class: 'muted' }, 'Pick a pull request or goal to trace it'));

    const rows = ledgerLog(events, show, projectId || undefined);
    fill(log, ...(rows.length
      ? byDay(rows.slice(0, MOST), dayOf).flatMap(({ day, rows }) => [h('h3', null, day), ...rows.map((r) => logRow(r))])
      : [h('p', { class: 'muted' }, `Nothing in the last ${days} days of the ledger${show.size < REVIEW_GROUPS.length ? ' of the kinds picked' : ''}.`)]),
      rows.length > MOST ? h('p', { class: 'muted' }, `The newest ${MOST} of ${rows.length}: pick fewer kinds or a shorter window to see further back.`) : null,
    );
    renderTrace();
  };

  const subjectOf = (r: LedgerRow): TraceSubject | null => (r.pr ? { kind: 'pr', repo: r.pr.repo, pr: r.pr.pr } : r.goal ? { kind: 'goal', title: r.goal } : null);
  const isPicked = (r: LedgerRow) => {
    const s = subjectOf(r);
    return !!s && !!subject && JSON.stringify(s) === JSON.stringify(subject);
  };

  const logRow = (r: LedgerRow, inTrace = false) => {
    const s = subjectOf(r);
    const row = h('div', { class: `ledger-row tone-${r.tone}${s && !inTrace ? ' traceable' : ''}${!inTrace && isPicked(r) ? ' picked' : ''}` },
      h('span', { class: 'muted' }, inTrace ? `${dayOf(r.at)} ${time(r.at)}` : time(r.at)),
      h('span', { class: 'chip', style: `--tone:${COLOR[r.group]}` }, r.tag),
      h('div', { class: 'grow' }, h('div', null, r.title), r.detail ? h('small', { class: 'muted' }, r.detail) : null, ...(r.quotes ?? []).map((q) => h('q', null, q))),
    );
    if (s && !inTrace) row.onclick = () => pick(s);
    return row;
  };

  const renderTrace = () => {
    if (!subject) {
      fill(traced, h('p', { class: 'muted' }, 'Pick a pull request in the log to follow it from its first session to its merge: QA rounds, conflicts, the sessions that worked on it, what they cost and what got in their way. From there, its goal traces every pull request the goal opened.'));
      return;
    }
    const t = trace(events, subject);
    const s = subject;
    // up on the wall too, beside the ship, where it stays until another is picked
    ui.showOnMsd(t);
    const clear = h('button', { class: 'btn small' }, 'Clear the MSD');
    clear.onclick = () => {
      subject = null;
      ui.showOnMsd(null);
      render();
    };
    const goal = t.goal;
    const goalLink = goal && s.kind === 'pr' ? h('button', { class: 'linkish' }, `Goal: ${goal} ›`) : null;
    if (goalLink && goal) goalLink.onclick = () => pick({ kind: 'goal', title: goal });
    const tot = t.totals;
    const sum = (value: string | number, label: string) => h('div', { class: 'ledger-sum' }, h('b', null, value), h('span', null, label));
    fill(traced,
      h('div', { class: 'row' }, h('span', { class: 'grow' }), clear),
      h('h3', null, s.kind === 'pr' ? `${s.repo.split('/').pop()} #${s.pr}` : `Goal: ${s.title}`),
      goalLink,
      s.kind === 'goal' ? h('small', { class: 'muted' }, `${tot.prs} pull requests in the last ${days} days`) : null,
      h('div', { class: 'ledger-sums' },
        sum(tot.verdicts ? `${tot.fails}/${tot.verdicts}` : '–', 'QA fails'),
        sum(tot.conflicts, 'conflicts'),
        sum(`$${tot.costUsd.toFixed(2)}`, `${tot.sessions} sessions · ${tot.minutes} min`),
        sum(tot.wastedCalls, `wasted calls · ${tot.frictions} frictions`),
      ),
      ...(t.steps.length ? t.steps.map((r) => logRow(r, true)) : [h('p', { class: 'muted' }, `Nothing about it in the last ${days} days.`)]),
    );
  };

  ui.panels.open({ title: 'Ledger · review', body, accent: LCARS.gold, wide: true });
  load();
}
