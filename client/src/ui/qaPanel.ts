import { statusLine } from '../../../shared/agentStatus';
import { qaOfficerFor, UNIFORM } from '../../../shared/crew';
import { DEFAULT_MERGE_CHECKS } from '../../../shared/mergeCheck';
import { autoMergeFor } from '../../../shared/mergeGate';
import { autoQaFor, autoSendBackFor, filesCovered, pullUrl, qaBadge, qaProofFor, spotCheckUrl } from '../../../shared/qa';
import { type QaSwitch, qaSwitchSays, qaWhoLine } from '../../../shared/qaPlaybook';
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
import { checksList, fullPrompt, stepsList } from './qaPlaybook';

/** The QA station's views: the reports, and the playbook: what QA does on this project, with the switches that change it. */
type QaView = 'reports' | 'playbook';

/** A switch with what it means for the project, as it's set, beside it. */
function toggle(label: string, which: QaSwitch, on: boolean, save: (on: boolean) => void): HTMLElement {
  const says = h('span', { class: 'muted' }, qaSwitchSays(which, on));
  const s = new Switch(label, on, {
    changed: (now) => {
      says.textContent = qaSwitchSays(which, now);
      save(now);
    },
  });
  return h('div', { class: 'qa-toggle' }, s.el, says);
}

/**
 * The room's QA station: what the QA officer is doing and the reports they've written on the open pull requests, and on
 * the sidebar's other view, the Playbook: what QA does on this project, built from its instructions and settings as they
 * are now (when it runs, who it is, its steps, the checks it runs, the brief and its instructions in full).
 */
export function openQaPanel(ui: Ui, projectId: string): void {
  const project = state.project(projectId);
  if (!project) return;
  const officer = qaOfficerFor(projectId);
  const body = h('div');

  // the playbook lives outside the re-rendered part, so typing in the brief survives reports arriving
  const steps = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const checks = h('div');
  const prompt = h('div');
  const loadPlaybook = () => void api.qaPlaybook(projectId).then((playbook) => {
    const open = prompt.querySelector('details')?.open ?? false;
    fill(steps, stepsList(playbook));
    fill(checks, checksList(playbook));
    fill(prompt, fullPrompt(playbook, project.repos[0]));
    const details = prompt.querySelector('details');
    if (details) details.open = open;
  }, (e: Error) => fill(steps, h('p', { class: 'planner-error' }, `Couldn’t load QA’s steps: ${e.message}`)));
  const save = (patch: Parameters<typeof api.updateProject>[1]) => api.updateProject(projectId, patch).then(loadPlaybook, (e: Error) => ui.error(e.message));

  const brief = h('textarea', {
    class: 'qa-brief',
    value: project.qaBrief ?? '',
    placeholder: 'e.g.\n- Every page works at phone width (375px)\n- No errors in the browser console\n- API changes come with a test against the endpoint',
  });
  const saved = h('small', { class: 'muted' });
  brief.addEventListener('change', () => void save({ qaBrief: brief.value }).then(() => (saved.textContent = 'Saved. Applies from the next review.')));
  const effort = effortPicker(project.qaEffort);
  effort.title = 'How hard QA thinks: the QA officer, and each goal’s reviewer';
  const who = h('span', { class: 'muted' });
  const showWho = () => (who.textContent = state.info ? qaWhoLine(state.info.settings, pickedEffort(effort)) : '');
  effort.onchange = () => {
    showWho();
    void save({ qaEffort: (pickedEffort(effort) ?? '') as Effort });
  };
  showWho();
  const mergeChecks = h('input', { type: 'text', class: 'qa-merge-checks', value: (project.mergeChecks ?? DEFAULT_MERGE_CHECKS).join(', '), placeholder: 'none: only conflicts stop a merge' });
  mergeChecks.addEventListener('change', () => void save({ mergeChecks: mergeChecks.value.split(/[\s,]+/).filter(Boolean) }));
  const section = (title: string, ...children: (HTMLElement | string | null)[]) => h('section', { class: 'qa-playbook-section' }, h('h3', null, title), ...children);
  const playbook = h('div', { class: 'qa-settings qa-playbook' },
    h('p', { class: 'muted' }, `What ${officer.name} does on ${project.name}, read from QA's instructions and these settings as they are now.`),
    section('When QA runs',
      toggle('Test every PR', 'autoQa', autoQaFor(project), (on) => void save({ autoQa: on })),
      toggle('Send failed PRs back', 'autoSendBack', autoSendBackFor(project), (on) => void save({ autoSendBack: on })),
      toggle('Block only with proof', 'qaProof', qaProofFor(project), (on) => void save({ qaProof: on })),
      toggle('Auto-merge', 'autoMerge', autoMergeFor(project), (on) => void save({ autoMerge: on })),
    ),
    section('Who, and how hard', h('div', { class: 'qa-toggle' }, effort, who)),
    section('Its steps', steps),
    section('The checks it runs',
      checks,
      h('div', { class: 'field' },
        h('label', null, 'Scripts to run (the merge check runs the same)'),
        mergeChecks,
        h('small', null, 'package.json scripts, by name. A repo with a merge-check script runs that alone; empty runs none.'),
      ),
    ),
    section('Your brief',
      h('div', { class: 'field' },
        h('label', null, `What should ${officer.name} check on every ${project.name} PR?`),
        withMic(ui, brief),
        saved,
      ),
    ),
    section('Its instructions in full', prompt),
  );
  ui.panels.own(state.on('info', showWho));
  loadPlaybook();

  const live = h('div');
  const views: Record<QaView, HTMLElement> = { reports: live, playbook };
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
      { key: 'playbook', label: 'Playbook' },
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

  fill(body, live, playbook);
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
    report?.proofs?.length
      ? h('div', { class: 'qa-proofs' }, h('strong', null, 'Proof, as the office checked it'), h('ul', null, ...report.proofs.map((p) =>
        h('li', null, h('span', { class: `chip check ${p.outcome === 'failed' ? 'fail' : p.outcome === 'passed' ? 'pass' : 'skip'}` }, p.outcome === 'failed' ? 'holds' : p.outcome === 'passed' ? 'passed' : 'not proof'),
          ` ${p.finding} `, h('code', null, p.kind === 'test' ? p.file ?? '' : p.kind === 'check' ? p.command ?? '' : `screenshot ${p.screenshot ?? '?'}`), p.note ? ` · ${p.note}` : ''))))
      : null,
    report?.fixInstructions ? h('div', { class: 'qa-fix' }, h('strong', null, report.advisory ? 'Advice (not proved, so it didn’t block)' : 'What needs fixing'), h('p', null, report.fixInstructions)) : null,
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
