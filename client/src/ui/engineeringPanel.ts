import { chiefEngineer } from '../../../shared/crew';
import { FIX_SESSIONS, type FixEffect, type FixStatus, frictionName, reportLines } from '../../../shared/ledger';
import { formatValue, glance } from '../../../shared/scorecard';
import type { FixKind, Retro, RetroDraft, ScorecardSection } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';
import { climberView } from './climberView';
import { type NavItem, readout, shownView, SideNav } from './panels';
import { scorecardHead, scorecardOverview, scorecardSections } from './scorecardView';
import { markdownHtml } from './terminal';

const KIND: Record<FixKind, string> = { check: 'Check', 'qa-rule': 'QA rule', pointer: 'Pointer', delete: 'Delete' };

type View = 'overview' | 'code' | 'office' | 'retro';

/** Which view each section's numbers live in. */
const VIEW_OF: Record<ScorecardSection, View> = { gate: 'code', fence: 'code', effect: 'code', tests: 'code', office: 'office' };

/**
 * The engineering station, a view at a time: the scorecard at a glance (with the climber and the retro beside it), the
 * code's numbers and the office's in full, each explaining itself, and the chief engineer's retro. On the captain's
 * word they look over the session digests' frictions that keep coming back and draft an issue for each. They change
 * nothing: the captain accepts a draft (it's filed in the repository picked beside it) or rejects it.
 */
export function openEngineeringPanel(ui: Ui): void {
  const eng = chiefEngineer();
  const body = h('div', { class: 'engineering' });
  // the window outlives re-renders, so a retro finishing doesn't reset what you typed, nor close a number you opened
  const days = h('input', { type: 'number', min: '1', max: '60', value: String(state.retro?.days ?? 14), style: 'width:80px' });
  const open = new Set<string>();
  let picked: View | undefined;

  // the agents' sessions from before digests began: counted once when the panel opens
  const older = h('div', { class: 'row', style: 'margin:10px 0' });
  const showOlder = (count: number) => {
    if (!count) return fill(older);
    const go = h('button', { class: 'btn small' }, 'Digest them');
    go.onclick = () => {
      void busy(go, () => api.backfillDigests().then(() => fill(older, h('span', { class: 'muted' }, `Digesting ${count} older sessions: the report card fills in as they’re done`))), ui.error);
    };
    fill(older, h('span', { class: 'muted grow' }, `${count} older agent sessions haven’t been digested`), go);
  };
  void api.undigested().then((r) => showOlder(r.sessions)).catch(() => undefined);

  const nav = new SideNav<View>((view) => {
    picked = view;
    render();
  });
  /** To a section's numbers, with `key` opened. */
  const go = (section: ScorecardSection, key?: string) => {
    if (key) open.add(key);
    picked = VIEW_OF[section];
    render();
    body.querySelector(key ? `[data-key="${key}"]` : `#sc-${section}`)?.scrollIntoView({ block: 'start' });
  };

  const retroView = () => {
    const retro = state.retro;
    const running = retro?.status === 'gathering' || retro?.status === 'thinking';
    const start = h('button', { class: 'btn primary' }, retro?.status === 'done' ? 'Start a new retro' : 'Start a retro');
    start.disabled = running;
    start.onclick = () =>
      void busy(start, async () => {
        const window = Number(days.value);
        const { unread, costUsd } = await api.retroPreview(window);
        const reading = unread
          ? `${eng.name} first reads the ${unread} sessions of the last ${window} days no one has read yet, for their frictions: roughly $${costUsd.toFixed(2)} of Claude usage, a batch at a time with a pause between. Sessions read before aren’t read again.`
          : `Every session of the last ${window} days has been read already, so this only drafts.`;
        if (!confirm(`Start a retro?\n\n${reading}`)) return;
        await api.retroStart(window);
      }, ui.error).then(render);
    const stop = h('button', { class: 'btn' }, 'Stop');
    stop.onclick = () => void busy(stop, () => api.retroStop().then(() => undefined), ui.error);
    const bars = frictionBars(ui, 5);
    return h('div', null,
      h('div', { class: 'briefing-note' }, `${eng.name} looks over the frictions found in the agents’ sessions in the window, and drafts an issue for each that came up in three or more, with the moments quoted. Accept one and it’s filed; reject it and it isn’t raised again. Nothing changes unless you say so.`),
      bars ? h('section', { class: 'card sc-section', style: '--c:var(--lcars-orange);margin:14px 0 0' }, h('h4', null, 'Most widespread open frictions', h('span', null, 'Sessions they came up in, over 14 days, with no retro decision yet')), bars) : null,
      h('div', { class: 'row', style: 'margin:14px 0' },
        h('span', { class: 'muted' }, 'Look back over the last'), days, h('span', { class: 'muted' }, 'days'),
        running ? stop : start,
        h('span', { class: 'grow' }),
        retro?.costUsd ? h('small', { class: 'muted' }, `$${retro.costUsd.toFixed(2)}`) : null,
      ),
      retro && retro.status !== 'idle' ? status(retro) : null,
      retro?.status === 'done' ? findings(ui, retro) : null,
      state.report?.fixes.length ? fixes(state.report.fixes) : null,
      older,
    );
  };

  const render = () => {
    const retro = state.retro;
    const g = glance(state.scorecards?.history ?? []);
    const waiting = retro?.status === 'done' ? retro.drafts.filter((d) => !d.decision).length : 0;
    const running = retro?.status === 'gathering' || retro?.status === 'thinking';
    const office = g?.tiles.find((t) => t.section === 'office')?.hero.metric;
    const items: NavItem<View>[] = [
      { key: 'overview', label: 'Overview', readout: g?.compared ? `▲${g.better} ▼${g.worse}` : '' },
      { key: 'code', label: 'Code', readout: g?.gate ? (g.gate.pass ? 'PASS' : 'FAIL') : '', standby: !g },
      { key: 'office', label: 'Office', readout: office ? formatValue(office.value, office.format) : '' },
      { key: 'retro', label: 'Retro', readout: running ? 'LIVE' : waiting ? `${waiting} ${waiting === 1 ? 'DRAFT' : 'DRAFTS'}` : '' },
    ];
    const view = shownView(items, picked) ?? 'overview';
    nav.show(items, view);
    const ledger = h('button', { class: 'btn small' }, 'Review the ledger →');
    ledger.onclick = () => ui.openLedger();
    const views: Record<View, () => HTMLElement[]> = {
      overview: () => [scorecardOverview(ui, go, h('div', { class: 'sc-better' }, climberView(ui), retroSummary(ui, retro, () => {
        picked = 'retro';
        render();
      })))],
      code: () => [scorecardHead(ui), ...scorecardSections(['gate', 'fence', 'effect', 'tests'], open)],
      office: () => [scorecardHead(ui), ...scorecardSections(['office'], open), liveLedger(ui, ledger)],
      retro: () => [retroView()],
    };
    fill(body, ...views[view]());
  };

  ui.panels.open({ title: `${eng.name} · Chief engineer`, body, nav, accent: LCARS.gold, wide: true });
  ui.panels.own(state.on('retro', render));
  ui.panels.own(state.on('report', render));
  ui.panels.own(state.on('scorecards', render));
  ui.panels.own(state.on('climb', render));
  // the climber's activity, as they work
  ui.panels.own(state.on('agent', (a) => {
    if (a.id === state.climb?.agentId) render();
  }));
  render();
}

/** The office's open frictions, the most widespread first, as bars: what the retro will look at. Each opens its trace in the ledger review. */
function frictionBars(ui: Ui, limit: number): HTMLElement | null {
  const frictions = state.scorecards?.history.at(-1)?.frictions.slice(0, limit) ?? [];
  if (!frictions.length) return null;
  const most = frictions[0].sessions || 1;
  return h('div', { class: 'sc-frictions' }, ...frictions.map((f) => {
    const { kind, signature } = frictionName(f.key);
    return h('button', { class: 'sc-friction', title: `${f.key}: open every session it came up in`, onclick: () => ui.openLedger({ kind: 'friction', key: f.key }) },
      h('span', { class: 'grow' }, signature, kind ? h('small', { class: 'muted' }, ` ${kind}`) : null),
      h('span', { class: 'bar' }, h('i', { style: `width:${Math.max(4, (f.sessions / most) * 100)}%` })),
      h('small', { class: 'muted' }, `${f.sessions} sessions ›`));
  }));
}

/** The retro beside the overview: whether one's under way or waiting on you, and the frictions it would look at. */
function retroSummary(ui: Ui, retro: Retro | null | undefined, open: () => void): HTMLElement {
  const waiting = retro?.status === 'done' ? retro.drafts.filter((d) => !d.decision).length : 0;
  const line = retro?.status === 'gathering' || retro?.status === 'thinking'
    ? retro.activity
    : waiting ? `${waiting} ${waiting === 1 ? 'draft waits' : 'drafts wait'} for you to accept or reject`
      : retro?.status === 'failed' ? `The last retro failed: ${retro.error ?? retro.activity}` : 'Drafts an issue for each friction that keeps coming back';
  const bars = frictionBars(ui, 3);
  return h('div', { class: 'card sc-retro' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Retro'), h('button', { class: 'btn small', onclick: open }, waiting ? 'Review drafts →' : 'Open →')),
    h('small', { class: 'muted' }, line),
    bars ? h('small', { class: 'lbl' }, 'Most widespread open frictions') : null,
    bars,
  );
}

/** The ledger as it stands now (the scorecard's office numbers are as of its measurement), with what the scorecard doesn't count. */
function liveLedger(ui: Ui, ledger: HTMLElement): HTMLElement {
  const card = state.report;
  const shown = card ? reportLines(card) : undefined;
  const warnings = [...(card?.warnings ?? []).map((w) => `⚠ Ledger damaged: ${w}`), ...(card?.notes ?? []).map((n) => `Ledger: ${n}`)];
  const live = card && (card.merged || card.closed || card.verdicts)
    ? h('div', { class: 'readouts' },
      readout('Merged', String(card.merged)),
      readout('QA first time', card.merged ? `${Math.round((card.mergedFirstTime / card.merged) * 100)}%` : '–'),
      readout('Closed unmerged', String(card.closed)),
      readout('Conflicts', `${card.conflicts} (${card.conflictsForAgent} for an agent)`),
      readout('Triaged', String(card.triages)),
      readout('Goals closed', String(card.goalsClosed)),
      card.sessions ? readout('Per merge', `$${card.costPerMerge.toFixed(2)}`) : null,
      readout('Spent', `$${card.costUsd.toFixed(2)}`))
    : h('small', { class: 'muted' }, shown?.lines.join(' · ') ?? 'Nothing in the ledger yet');
  const bars = frictionBars(ui, 5);
  return h('section', { class: 'card sc-section', style: '--c:var(--lcars-orange)' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, `The ledger now${card ? `, last ${card.days} days` : ''}`, h('span', null, 'Live, where the scorecard is as of its measurement')), ledger),
    ...warnings.map((w) => h('small', null, w)),
    live,
    bars ? h('h4', null, 'Most widespread open frictions', h('span', null, 'Sessions they came up in, over 14 days: what the retro reads')) : null,
    bars,
  );
}

function status(retro: Retro): HTMLElement {
  const tone = retro.status === 'failed' ? 'bad' : retro.status === 'done' ? 'ok' : 'warn';
  return h('div', { class: 'qa-now' },
    h('span', { class: `chip ${tone}` }, retro.status),
    h('div', { class: 'grow' },
      h('strong', null, retro.status === 'failed' ? (retro.error ?? retro.activity) : retro.activity),
      h('small', null, [
        retro.sessions ? `${retro.sessions} sessions over ${retro.days} days` : `the last ${retro.days} days`,
        retro.startedAt ? `started ${timeAgo(retro.startedAt)}` : '',
      ].filter(Boolean).join(' · ')),
    ),
  );
}

function findings(ui: Ui, retro: Retro): HTMLElement {
  return h('div', { class: 'cards' },
    retro.summary ? h('p', null, retro.summary) : null,
    retro.drafts.length ? h('h3', null, `Drafts (${retro.drafts.length})`) : null,
    ...retro.drafts.map((d, i) => draft(ui, d, i)),
    retro.watch.length ? h('h3', null, 'To watch: seen in two sessions') : null,
    retro.watch.length ? h('ul', null, ...retro.watch.map((w) => h('li', null, w))) : null,
  );
}

/** Where an accepted draft is filed: the last repository picked, kept between drafts and visits. */
const FILE_IN = 'focus.retro.fileIn';

function draft(ui: Ui, d: RetroDraft, i: number): HTMLElement {
  const head = h('div', { class: 'row' }, h('strong', { class: 'grow' }, `${i + 1}. ${d.title}`), h('span', { class: 'chip' }, KIND[d.kind]), h('span', { class: 'chip off' }, `${d.sessions} sessions`));
  const text = h('div', { class: 'markdown' });
  text.innerHTML = markdownHtml(d.body);
  const details = h('details', null, h('summary', null, 'The issue as it would be filed'), text);
  const tags = h('p', null, h('span', { class: 'label' }, 'Measure '), d.measure, h('br'), h('small', { class: 'muted' }, d.signatures.join(' · ')));
  if (d.decision) {
    const issue = d.decision.issue;
    const said = d.decision.accepted
      ? h('span', { class: 'chip ok' }, issue ? h('a', { href: issue.url, target: '_blank' }, `Filed ${issue.repo}#${issue.number}`) : 'Accepted')
      : h('span', { class: 'chip off' }, 'Rejected');
    return h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, said, h('small', { class: 'muted' }, timeAgo(d.decision.at))));
  }
  const repos = state.projects.flatMap((p) => p.repos.map((repo) => ({ projectId: p.id, repo, label: `${repo} (${p.name})` })));
  const pick = h('select', null, ...repos.map((r) => h('option', { value: `${r.projectId} ${r.repo}` }, r.label)));
  const last = localStorage.getItem(FILE_IN);
  if (last && repos.some((r) => `${r.projectId} ${r.repo}` === last)) pick.value = last;
  const accept = h('button', { class: 'btn primary small' }, 'Accept and file');
  const reject = h('button', { class: 'btn small' }, 'Reject');
  accept.disabled = !repos.length;
  accept.onclick = () => {
    const [projectId, repo] = pick.value.split(' ');
    localStorage.setItem(FILE_IN, pick.value);
    void busy(accept, () => api.decideDraft(d.id, true, projectId, repo).then(() => undefined), ui.error);
  };
  reject.onclick = () => void busy(reject, () => api.decideDraft(d.id, false).then(() => undefined), ui.error);
  return h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, h('small', { class: 'muted' }, 'File in'), pick, accept, reject));
}

const FIX: Record<FixStatus, { tone: string; label: string }> = {
  waiting: { tone: 'off', label: 'waiting for its fix' },
  'too-early': { tone: 'warn', label: 'too early to tell' },
  stopped: { tone: 'ok', label: 'stopped it' },
  fewer: { tone: 'ok', label: 'fewer' },
  recurring: { tone: 'bad', label: 'still recurring' },
};

const share = (c: { hits: number; sessions: number }) => `${c.hits} of ${c.sessions} sessions`;

/** Each retro fix the captain accepted: did its frictions stop coming up once it landed? */
function fixes(list: FixEffect[]): HTMLElement {
  return h('div', { class: 'cards', style: 'margin-top:12px' },
    h('h3', null, 'Retro fixes'),
    ...list.map((f) => {
      const { tone, label } = FIX[f.status];
      const issue = f.issue ? `${f.issue.repo}#${f.issue.number}` : 'not filed';
      const since = f.landed
        ? `since ${f.landed.repo}#${f.landed.pr} merged ${timeAgo(f.landed.at)}: ${share(f.after)}${f.status === 'too-early' ? ` (says once ${FIX_SESSIONS} are in)` : ''}`
        : 'its issue hasn’t been closed by a merge yet';
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, f.title), h('span', { class: `chip ${tone}` }, label)),
        h('small', { class: 'muted' }, `${issue} · before: ${share(f.before)} · ${since}`),
      );
    }),
  );
}
