import { api } from '../net/api';
import { state } from '../net/state';
import { columns } from '../world/board';
import { statusLine } from '../world/character';
import { statusIcon } from './agentPanel';
import type { BoardTab, Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';

/** The project's Kanban board up close: assign agents, follow progress, merge PRs. */
export function openBoardPanel(ui: Ui, projectId: string, focus?: BoardTab): void {
  const project = state.project(projectId);
  if (!project) return;
  const body = h('div');
  const refresh = h('button', { class: 'btn small', title: 'Re-read issues and PRs from GitHub' }, '⟳ Refresh');
  const newIssue = h('button', { class: 'btn small primary' }, '＋ New issue');
  const mine = h('input', { type: 'checkbox', checked: !!project.onlyMyPrs });
  const mineToggle = h('label', { class: 'btn small', title: 'Hide pull requests opened by other people' }, mine, ' Only my PRs');
  mine.onchange = () => void api.updateProject(projectId, { onlyMyPrs: mine.checked }).catch((e: Error) => ui.error(e.message));
  refresh.onclick = () => void busy(refresh, () => api.refreshBoard(projectId), ui.error);
  newIssue.onclick = () => ui.openNewIssue(projectId);

  ui.panels.open({
    title: `${project.name} – board`,
    body,
    wide: true,
    accent: project.color + '66',
    headerExtra: [mineToggle, newIssue, refresh],
  });

  const render = () => {
    const p = state.project(projectId);
    if (!p) return ui.panels.close();
    const board = state.boards.get(projectId);
    const agents = state.agentsIn(projectId);
    const cols = columns(p, board, agents);
    const multi = p.repos.length > 1;
    const busyAgents = agents.filter((a) => !['done', 'error', 'stopped'].includes(a.status)).length;
    const full = busyAgents >= p.maxAgents;

    const todo = h('div', { class: 'col' }, h('h3', null, h('span', null, '📋 To do'), h('span', null, cols.todo.length)));
    if (!cols.todo.length) todo.append(h('div', { class: 'empty' }, p.repos.length ? 'No open issues. File one!' : 'Connect a repository in the Manager’s office first.'));
    for (const issue of cols.todo) {
      const assign = h('button', { class: 'btn small primary', title: full ? 'Agents beyond the limit wait in a queue' : '' }, full ? '⏳ Queue agent' : '🤖 Assign agent');
      assign.onclick = () =>
        void busy(assign, async () => {
          const agent = await api.hire(projectId, issue);
          ui.hud.toast('success', `${agent.name} is on #${issue.number}`, { label: 'Watch', run: () => ui.goToAgent(agent.id) });
        }, ui.error);
      todo.append(
        h('div', { class: 'note' },
          h('div', { class: 't' }, `#${issue.number} ${issue.title}`),
          h('div', { class: 'm' },
            multi ? h('span', { class: 'chip' }, issue.repo.split('/')[1]) : null,
            ...issue.labels.slice(0, 4).map((l) => h('span', { class: 'chip' }, l)),
            h('span', null, timeAgo(Date.parse(issue.createdAt))),
          ),
          h('div', { class: 'actions' }, assign, h('a', { class: 'btn small', href: issue.url, target: '_blank', rel: 'noreferrer' }, 'Open ↗')),
        ),
      );
    }

    const doing = h('div', { class: 'col' }, h('h3', null, h('span', null, '🔨 In progress'), h('span', null, `${busyAgents}/${p.maxAgents}`)));
    if (!cols.doing.length) doing.append(h('div', { class: 'empty' }, 'Nobody is working on anything.'));
    for (const a of cols.doing) {
      const note = h('div', { class: `note doing ${a.status}`, title: 'Open their laptop' },
        h('div', { class: 't' }, h('span', { class: 'dot', style: `background:${a.avatar.shirt};margin-right:6px;vertical-align:-2px` }), `${a.name} · #${a.issue.number} ${a.issue.title}`),
        h('div', { class: 'm' }, h('span', { class: 'chip' }, `${statusIcon(a)} ${a.status}`), multi ? h('span', { class: 'chip' }, a.repo.split('/')[1]) : null, h('span', null, statusLine(a))),
      );
      note.onclick = () => ui.openAgent(a.id);
      doing.append(note);
    }

    const prs = h('div', { class: 'col' }, h('h3', null, h('span', null, '👀 Ready to merge'), h('span', null, cols.prs.length)));
    mine.checked = !!p.onlyMyPrs;
    if (!cols.prs.length) prs.append(h('div', { class: 'empty' }, cols.hiddenPrs ? 'None of the open pull requests are yours.' : 'No open pull requests.'));
    for (const pr of cols.prs) {
      const merge = h('button', { class: 'btn small go' }, `⤵ ${state.info?.settings.mergeMethod ?? 'squash'} & merge`);
      merge.disabled = pr.mergeable === 'CONFLICTING' || pr.isDraft;
      merge.onclick = () => {
        if (!confirm(`Merge ${pr.repo}#${pr.number} "${pr.title}"?`)) return;
        void busy(merge, async () => {
          await api.mergePr(projectId, pr.repo, pr.number);
          ui.hud.toast('success', `Merged #${pr.number} 🎉`);
        }, ui.error);
      };
      const checks = { passing: '✓ checks pass', failing: '✗ checks failing', pending: '⏳ checks running', none: 'no checks' }[pr.checks];
      const agent = pr.agent;
      prs.append(
        h('div', { class: 'note pr' },
          h('div', { class: 't' }, `PR #${pr.number} ${pr.title}`),
          h('div', { class: 'm' },
            agent ? h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${agent.avatar.shirt}` }), agent.name) : pr.author ? h('span', { class: 'chip' }, `@${pr.author}`) : null,
            multi ? h('span', { class: 'chip' }, pr.repo.split('/')[1]) : null,
            h('span', { class: 'chip', style: pr.checks === 'failing' ? 'background:#ffc9c9' : '' }, checks),
            pr.mergeable === 'CONFLICTING' ? h('span', { class: 'chip', style: 'background:#ffc9c9' }, '⚠ conflicts') : null,
            pr.isDraft ? h('span', { class: 'chip' }, 'draft') : null,
            pr.reviewDecision ? h('span', { class: 'chip' }, pr.reviewDecision.toLowerCase().replace('_', ' ')) : null,
          ),
          h('div', { class: 'actions' },
            merge,
            h('a', { class: 'btn small', href: `${pr.url}/files`, target: '_blank', rel: 'noreferrer' }, 'Review ↗'),
            agent ? h('button', { class: 'btn small', onclick: () => ui.openAgent(agent.id) }, `💬 ${agent.name}`) : null,
          ),
        ),
      );
    }

    const highlight = { todo, doing, prs }[focus ?? 'todo'];
    highlight.style.borderColor = project.color;
    fill(
      body,
      board?.error ? h('div', { class: 'ask', style: 'background:#ffe3e3' }, `⚠ ${board.error}`) : null,
      h('div', { class: 'kanban' }, todo, doing, prs),
      cols.hiddenPrs ? h('div', { class: 'empty' }, `${cols.hiddenPrs} PR${cols.hiddenPrs === 1 ? '' : 's'} by other people hidden`) : null,
    );
  };

  render();
  // agents report progress several times a second; don't rebuild the board under the cursor that often
  let pending: ReturnType<typeof setTimeout> | null = null;
  const rerender = () => {
    pending ??= setTimeout(() => {
      pending = null;
      render();
    }, 500);
  };
  ui.panels.own(() => pending && clearTimeout(pending));
  ui.panels.own(state.on('board', (id) => id === projectId && rerender()));
  ui.panels.own(state.on('agent', (a) => a.projectId === projectId && rerender()));
  ui.panels.own(state.on('agent-removed', (a) => a.projectId === projectId && rerender()));
  ui.panels.own(state.on('projects', rerender));
}
