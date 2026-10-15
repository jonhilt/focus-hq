import { statusLine } from '../../../shared/agentStatus';
import { qaOfficerFor, UNIFORM } from '../../../shared/crew';
import { autoMergeFor } from '../../../shared/mergeGate';
import { autoQaFor, autoSendBackFor, filesCovered, pullUrl, qaBadge, spotCheckUrl } from '../../../shared/qa';
import { triageLabel } from '../../../shared/triage';
import type { Effort, QaReview, QaScreenshot } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { effortPicker, pickedEffort } from './agentPanel';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h, timeAgo } from './dom';
import { type NavItem, shownView, SideNav, Switch } from './panels';

/** The QA station's views: the reports, and what QA does and checks on this project. */
type QaView = 'reports' | 'settings';

/** A switch with what it does beside it. */
const toggle = (s: Switch, what: string) => h('div', { class: 'qa-toggle' }, s.el, h('span', { class: 'muted' }, what));

/**
 * The room's QA station: what the QA officer is doing and the reports they've written on the open pull requests, and on
 * the sidebar's other view, what they check on this project (the QA brief) and what they do on their own.
 */
export function openQaPanel(ui: Ui, projectId: string): void {
  const project = state.project(projectId);
  if (!project) return;
  const officer = qaOfficerFor(projectId);
  const body = h('div');

  // settings live outside the re-rendered part, so typing in the brief survives reports arriving
  const brief = h('textarea', {
    class: 'qa-brief',
    value: project.qaBrief ?? '',
    placeholder: 'e.g.\n- Every page works at phone width (375px)\n- No errors in the browser console\n- API changes come with a test against the endpoint',
  });
  const saved = h('small', { class: 'muted' });
  brief.addEventListener('change', () => {
    void api.updateProject(projectId, { qaBrief: brief.value }).then(
      () => (saved.textContent = 'Saved. Applies from the next review.'),
      (e: Error) => ui.error(e.message),
    );
  });
  const save = (patch: Parameters<typeof api.updateProject>[1]) => void api.updateProject(projectId, patch).catch((e: Error) => ui.error(e.message));
  const auto = new Switch('Test every PR', autoQaFor(project), { changed: (on) => save({ autoQa: on }) });
  const sendBack = new Switch('Send failed PRs back', autoSendBackFor(project), { changed: (on) => save({ autoSendBack: on }) });
  const merge = new Switch('Auto-merge', autoMergeFor(project), { changed: (on) => save({ autoMerge: on }) });
  const effort = effortPicker(project.qaEffort);
  effort.title = 'How hard QA thinks: the QA officer, and each goal’s reviewer';
  effort.onchange = () => save({ qaEffort: (pickedEffort(effort) ?? '') as Effort });
  const settings = h('div', { class: 'qa-settings' },
    toggle(auto, 'Tests every pull request the crew opens or updates.'),
    toggle(sendBack, 'Sends a failed pull request the crew opened back to be fixed, up to 3 rounds.'),
    toggle(merge, 'Merges a pull request the crew opened once QA passed its latest commit and its checks are green.'),
    h('div', { class: 'qa-toggle' }, effort, h('span', { class: 'muted' }, 'How hard QA thinks from the next review: the QA officer, and each goal’s reviewer.')),
    h('div', { class: 'field', style: 'margin:16px 0 0' },
      h('label', null, `What should ${officer.name} check on every ${project.name} PR?`),
      withMic(ui, brief),
      saved,
    ),
  );

  const live = h('div');
  const views: Record<QaView, HTMLElement> = { reports: live, settings };
  let picked: QaView | undefined;
  const nav = new SideNav<QaView>((view) => {
    picked = view;
    render();
  });
  const render = () => {
    const qa = state.qaAgent(projectId);
    const reviews = state.reviewsIn(projectId);
    const queued = reviews.filter((r) => r.status === 'queued').length;
    const items: NavItem<QaView>[] = [
      { key: 'reports', label: 'Reports', readout: reviews.length ? String(reviews.length) : '' },
      { key: 'settings', label: 'Settings' },
    ];
    const view = shownView(items, picked) ?? 'reports';
    nav.show(items, view);
    for (const [key, el] of Object.entries(views)) el.hidden = key !== view;
    fill(live,
      h('div', { class: 'qa-now' },
        h('span', { class: 'planner-badge', style: `background:${UNIFORM[officer.avatar.division]}` }),
        h('div', { class: 'grow' },
          h('strong', null, officer.name),
          h('small', null, qa && !['done', 'error', 'stopped'].includes(qa.status) ? `${statusLine(qa)} · PR #${qa.issue.number}` : 'Standing by for pull requests'),
        ),
        queued ? h('span', { class: 'chip' }, `${queued} queued`) : null,
        qa ? h('button', { class: 'btn small', onclick: () => ui.openAgent(qa.id) }, 'Their terminal') : null,
      ),
      // each goal's own reviewer, at its lead's table
      ...state.reviewersIn(projectId).map((r) => {
        const goal = r.reviewFor ? state.agents.get(r.reviewFor) : undefined;
        const working = !['done', 'error', 'stopped'].includes(r.status);
        return h('div', { class: 'qa-now' },
          h('span', { class: 'planner-badge', style: `background:${UNIFORM[r.avatar.division]}` }),
          h('div', { class: 'grow' },
            h('strong', null, `${r.name}, for “${goal?.lead?.title ?? 'a goal'}”`),
            h('small', null, working ? `${statusLine(r)} · PR #${r.issue.number}` : `Last reviewed PR #${r.issue.number}`),
          ),
          h('button', { class: 'btn small', onclick: () => ui.openAgent(r.id) }, 'Their terminal'),
        );
      }),
      reviews.length
        ? h('div', { class: 'cards' }, ...reviews.map((r) => reviewCard(ui, r)))
        : h('div', { class: 'empty' }, `No reports yet. ${officer.name} tests each PR the crew opens, or press Send to QA on any PR on the board.`),
    );
  };

  fill(body, live, settings);
  ui.panels.open({ title: `${project.name} · QA station`, body, nav, accent: LCARS.sky, wide: true });
  ui.panels.own(state.on('review', (id) => id === projectId && render()));
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && a.task === 'review' && render()));
  ui.panels.own(state.on('board', (id) => id === projectId && render()));
  render();
}

function reviewCard(ui: Ui, review: QaReview): HTMLElement {
  const pr = state.boards.get(review.projectId)?.prs.find((p) => p.repo === review.repo && p.number === review.number);
  const badge = qaBadge(review, { headSha: pr?.headSha });
  const report = review.report;
  const retest = h('button', { class: 'btn small' }, 'Re-test');
  retest.disabled = badge.state === 'queued' || badge.state === 'testing' || !pr;
  retest.onclick = () => void busy(retest, () => api.sendToQa(review.projectId, review.repo, review.number), ui.error);
  return h('div', { class: `card qa-report ${badge.state}` },
    h('div', { class: 'row' },
      h('strong', { class: 'grow' }, `PR #${review.number} ${review.title}`),
      h('span', { class: `chip qa ${badge.state}` }, badge.label),
    ),
    h('div', { class: 'm muted' },
      review.sha ? `commit ${review.sha.slice(0, 7)} · ` : '',
      review.finishedAt ? `tested ${timeAgo(review.finishedAt)}` : `asked ${timeAgo(review.requestedAt)}`,
    ),
    review.followUp?.kind === 'triaging' ? h('p', null, `${review.followUp.officer} is looking into why it's stuck: ${review.followUp.activity}`) : null,
    review.triage && review.followUp?.kind !== 'triaging' ? h('p', null, `${triageLabel(review.triage)}: ${review.triage.note}`) : null,
    review.followUp?.kind === 'needs-you' ? h('p', { class: 'planner-error' }, `Needs you: ${review.followUp.reason}. The crew stopped sending it back.`) : null,
    report?.summary ? h('p', null, report.summary) : null,
    review.error ? h('p', { class: 'planner-error' }, review.error) : null,
    report?.checks.length
      ? h('table', { class: 'qa-checks' }, ...report.checks.map((c) => h('tr', null, h('td', null, h('span', { class: `chip check ${c.result}` }, c.result)), h('td', null, h('strong', null, c.name)), h('td', null, c.details))))
      : null,
    review.screenshots?.length ? h('div', { class: 'qa-shots' }, ...review.screenshots.map((s, i) => screenshot(s, i))) : null,
    report?.fixInstructions ? h('div', { class: 'qa-fix' }, h('strong', null, 'What needs fixing'), h('p', null, report.fixInstructions)) : null,
    report?.spotChecks?.length
      ? h('div', { class: 'qa-spots' }, h('strong', null, 'Worth a human look'), h('ul', null, ...report.spotChecks.map((c) =>
        h('li', null, h('a', { href: spotCheckUrl(pullUrl(review.repo, review.number), c), target: '_blank', rel: 'noreferrer' }, h('code', null, `${c.file}${c.line ? `:${c.line}` : ''}`)), ` ${c.why}`))))
      : null,
    report ? filesReviewed(review) : null,
    report?.commands.length
      ? h('details', null, h('summary', null, `${report.commands.length} command${report.commands.length === 1 ? '' : 's'} run`),
          h('ul', null, ...report.commands.map((c) => h('li', null, h('code', null, c.command), ` → ${c.result}`))))
      : null,
    h('div', { class: 'actions' },
      retest,
      review.commentUrl ? h('a', { class: 'btn small', href: review.commentUrl, target: '_blank', rel: 'noreferrer' }, 'Report on GitHub ↗') : null,
      h('a', { class: 'btn small', href: pullUrl(review.repo, review.number), target: '_blank', rel: 'noreferrer' }, 'PR ↗'),
    ),
  );
}

/** Above this many files the table starts folded away, behind its headline. */
const OPEN_ROWS = 12;
const OPENED = { yes: '✓', no: '✗ never', na: '–', unknown: '' } as const;

/**
 * How QA covered each changed file, as on its PR comment (`filesCovered`): a headline that turns red when code went
 * unopened or was left out of the report, then a row per file, gaps first.
 */
function filesReviewed(review: QaReview): HTMLElement | null {
  const c = review.report && filesCovered(review.report, review.files);
  if (!c) return null;
  const gap = (c.evidence && c.opened < c.code) || c.missing > 0;
  const head = h('summary', { class: gap ? 'gap' : '' },
    h('strong', null, 'Files reviewed: '),
    c.evidence ? `${c.opened} of ${c.code} code files opened` : `${c.rows.length} files`,
    c.untested ? h('span', { class: 'warn' }, ` · ${c.untested} with no test`) : null,
    c.missing ? h('span', { class: 'bad' }, ` · ${c.missing} left out`) : null,
    c.sentBack ? ` · sent back once for ${c.sentBack}` : '',
  );
  const row = (r: (typeof c.rows)[number]) => h('tr', null,
    h('td', null, h('code', null, r.file)),
    c.evidence ? h('td', { class: r.opened === 'no' ? 'bad' : r.opened === 'yes' ? 'ok' : 'muted' }, OPENED[r.opened]) : null,
    h('td', { class: r.untested ? 'warn' : '' }, r.said ? r.said.tests : 'not in the report'),
    h('td', null, r.said?.checked ?? ''),
  );
  const table = h('table', { class: 'qa-checks qa-files' },
    h('tr', null, h('th', null, 'File'), c.evidence ? h('th', null, 'Opened') : null, h('th', null, 'Tests'), h('th', null, 'What QA checked')),
    ...c.rows.map(row));
  const details = h('details', { class: 'qa-files-account' }, head, table);
  details.open = c.rows.length <= OPEN_ROWS;
  return details;
}

function screenshot(shot: QaScreenshot, index: number): HTMLElement {
  const src = `/api/qa-shots/${shot.file}`;
  return h('figure', null,
    h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: shot.caption, loading: 'lazy' })),
    h('figcaption', null, `${index + 1}. ${shot.caption}`, shot.url ? null : h('small', { class: 'planner-error' }, ' · not on GitHub (upload failed)')),
  );
}
