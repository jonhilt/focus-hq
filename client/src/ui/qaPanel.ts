import { qaOfficerFor, UNIFORM } from '../../../shared/crew';
import { autoQaFor, qaBadge } from '../../../shared/qa';
import type { QaReview } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { statusLine } from '../world/character';
import type { Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';

const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

/**
 * The room's QA station: what the QA officer is doing, what they check on this project (the QA brief) and the reports
 * they've written on the open pull requests.
 */
export function openQaPanel(ui: Ui, projectId: string): void {
  const project = state.project(projectId);
  if (!project) return;
  const officer = qaOfficerFor(projectId);
  const body = h('div', { class: 'qa-station' });

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
  const auto = h('input', { type: 'checkbox', checked: autoQaFor(project) });
  auto.onchange = () => void api.updateProject(projectId, { autoQa: auto.checked }).catch((e: Error) => ui.error(e.message));
  const settings = h('div', { class: 'card qa-settings' },
    h('label', { class: 'qa-toggle' }, auto, h('span', null, '🔍 Test every pull request the office opens or updates')),
    h('div', { class: 'field', style: 'margin:10px 0 0' },
      h('label', null, `What should ${officer.name} check on every ${project.name} PR?`),
      brief,
      saved,
    ),
  );

  const live = h('div');
  const render = () => {
    const qa = state.qaAgent(projectId);
    const reviews = state.reviewsIn(projectId);
    const queued = reviews.filter((r) => r.status === 'queued').length;
    fill(live,
      h('div', { class: 'qa-now' },
        h('span', { class: 'planner-badge', style: `background:${UNIFORM[officer.avatar.division]}` }, '🔍'),
        h('div', { class: 'grow' },
          h('strong', null, officer.name),
          h('small', null, qa && !['done', 'error', 'stopped'].includes(qa.status) ? `${statusLine(qa)} · PR #${qa.issue.number}` : 'Standing by for pull requests'),
        ),
        queued ? h('span', { class: 'chip' }, `${queued} queued`) : null,
        qa ? h('button', { class: 'btn small', onclick: () => ui.openAgent(qa.id) }, '💻 Their terminal') : null,
      ),
      reviews.length
        ? h('div', { class: 'cards' }, ...reviews.map((r) => reviewCard(ui, r)))
        : h('div', { class: 'empty' }, `No reports yet. ${officer.name} tests each PR the office opens, or press 🔍 Send to QA on any PR on the board.`),
    );
  };

  fill(body, live, settings);
  ui.panels.open({ title: `🔍 QA station: ${project.name}`, body, accent: '#d0ebff', wide: true });
  ui.panels.own(state.on('review', (id) => id === projectId && render()));
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && a.task === 'review' && render()));
  ui.panels.own(state.on('board', (id) => id === projectId && render()));
  render();
}

function reviewCard(ui: Ui, review: QaReview): HTMLElement {
  const pr = state.boards.get(review.projectId)?.prs.find((p) => p.repo === review.repo && p.number === review.number);
  const badge = qaBadge(review, { headSha: pr?.headSha });
  const report = review.report;
  const retest = h('button', { class: 'btn small' }, '↻ Re-test');
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
    report?.summary ? h('p', null, report.summary) : null,
    review.error ? h('p', { class: 'planner-error' }, review.error) : null,
    report?.checks.length
      ? h('table', { class: 'qa-checks' }, ...report.checks.map((c) => h('tr', null, h('td', null, ICON[c.result]), h('td', null, h('strong', null, c.name)), h('td', null, c.details))))
      : null,
    report?.fixInstructions ? h('div', { class: 'qa-fix' }, h('strong', null, '🔧 What needs fixing'), h('p', null, report.fixInstructions)) : null,
    report?.commands.length
      ? h('details', null, h('summary', null, `🧪 ${report.commands.length} command${report.commands.length === 1 ? '' : 's'} run`),
          h('ul', null, ...report.commands.map((c) => h('li', null, h('code', null, c.command), ` → ${c.result}`))))
      : null,
    h('div', { class: 'actions' },
      retest,
      review.commentUrl ? h('a', { class: 'btn small', href: review.commentUrl, target: '_blank', rel: 'noreferrer' }, 'Report on GitHub ↗') : null,
      h('a', { class: 'btn small', href: `https://github.com/${review.repo}/pull/${review.number}`, target: '_blank', rel: 'noreferrer' }, 'PR ↗'),
    ),
  );
}
