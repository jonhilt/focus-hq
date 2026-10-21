import { statusLine } from '../../../shared/agentStatus';
import { columns, goalState, resolvingAlready } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { assignWarning, waitsLabel } from '../../../shared/dependencies';
import { mergeAction, mergeMethodFor } from '../../../shared/mergeGate';
import { mergeCheckLine } from '../../../shared/mergeCheck';
import { reachableUrl } from '../../../shared/previewReach';
import { previewIncludes, previewSet } from '../../../shared/previewSet';
import { prKey, qaBadge, sameCommit } from '../../../shared/qa';
import { triageLabel } from '../../../shared/triage';
import type { Effort } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS_STATUS } from '../world/starship';
import { effortPicker, pickedCloud, pickedEffort, wherePicker } from './agentPanel';
import type { BoardTab, Ui } from './context';
import { confirmDialog } from './confirmDialog';
import { busy, fill, h, timeAgo } from './dom';
import { Switch } from './panels';
import { linkHealth } from './previewPanel';

/** The project's Kanban board up close: assign agents, follow progress, merge PRs. */
export function openBoardPanel(ui: Ui, projectId: string, focus?: BoardTab): void {
  const project = state.project(projectId);
  if (!project) return;
  const body = h('div');
  const refresh = h('button', { class: 'btn small', title: 'Re-read issues and PRs from GitHub' }, 'Refresh');
  const newIssue = h('button', { class: 'btn small primary' }, 'New issue');
  const lead = h('button', { class: 'btn small', title: 'Goals: each built a slice at a time by a lead of its own, your own Claude Code session for it (L)', onclick: () => ui.openGoals(projectId) }, 'Goals');
  const mine = new Switch('Only my PRs', !!project.onlyMyPrs, {
    title: 'Hide pull requests opened by other people',
    changed: (on) => void api.updateProject(projectId, { onlyMyPrs: on }).catch((e: Error) => ui.error(e.message)),
  });
  refresh.onclick = () => void busy(refresh, () => api.refreshBoard(projectId), ui.error);
  newIssue.onclick = () => ui.openNewIssue(projectId);

  ui.panels.open({
    title: `${project.name} · board`,
    body,
    wide: true,
    accent: project.color,
    headerExtra: [mine.el, lead, newIssue, refresh],
  });

  // the board re-renders as agents report progress, so remember each issue's pick across renders
  const efforts = new Map<string, Effort | undefined>();
  const clouds = new Map<string, boolean>();

  const render = () => {
    const p = state.project(projectId);
    if (!p) return ui.panels.close();
    const board = state.boards.get(projectId);
    const agents = state.agentsIn(projectId);
    const cols = columns(p, board, agents, state.info?.github.login);
    const multi = p.repos.length > 1;
    const busyAgents = agents.filter((a) => a.task !== 'review' && a.task !== 'lead' && !['done', 'error', 'stopped'].includes(a.status)).length;
    const full = busyAgents >= p.maxAgents;

    const todo = h('div', { class: 'col' }, h('h3', null, h('span', null, 'To do'), h('span', null, cols.todo.length)));
    if (!cols.todo.length) todo.append(h('div', { class: 'empty' }, p.repos.length ? 'No open issues. File one!' : 'Connect a repository in your ready room first.'));
    for (const issue of cols.todo) {
      const key = `${issue.repo}#${issue.number}`;
      const effort = effortPicker(efforts.get(key));
      effort.onchange = () => efforts.set(key, pickedEffort(effort));
      const where = wherePicker(clouds.get(key));
      where.onchange = () => clouds.set(key, pickedCloud(where));
      const assign = h('button', { class: 'btn small primary', title: full ? 'Agents beyond the limit wait in a queue' : '' }, full ? 'Queue agent' : 'Assign agent');
      const waits = waitsLabel(issue.waitsFor);
      assign.onclick = async () => {
        const warning = assignWarning(issue);
        if (warning && !await confirmDialog({ title: 'Assign agent', message: warning, confirmLabel: 'Assign anyway' })) return;
        void busy(assign, async () => {
          const agent = await api.hire(projectId, issue, pickedEffort(effort), pickedCloud(where));
          ui.hud.toast('success', `${agent.name} is on #${issue.number}`, { label: 'Watch', run: () => ui.goToAgent(agent.id) });
        }, ui.error);
      };
      todo.append(
        h('div', { class: 'note' },
          h('div', { class: 't' }, `#${issue.number} ${issue.title}`),
          h('div', { class: 'm' },
            issue.closedPr
              ? h('span', { class: 'chip warn', title: `${issue.closedPr.officer} closed it: ${issue.closedPr.note}` }, `PR #${issue.closedPr.pr} closed: wrong approach, open for another go`)
              : null,
            waits ? h('span', { class: 'chip', title: 'Auto-assign leaves it until those are closed' }, waits) : null,
            multi ? h('span', { class: 'chip' }, issue.repo.split('/')[1]) : null,
            ...issue.labels.slice(0, 4).map((l) => h('span', { class: 'chip' }, l)),
            h('span', null, timeAgo(Date.parse(issue.createdAt))),
          ),
          h('div', { class: 'actions' }, assign, effort, where, h('a', { class: 'btn small', href: issue.url, target: '_blank', rel: 'noreferrer' }, 'Open ↗')),
        ),
      );
    }

    const doing = h('div', { class: 'col' },
      h('h3', null, h('span', null, 'In progress'), h('span', { title: 'Goals under way · desk agents at work (of the room’s limit)' }, `${cols.goals.length ? `${cols.goals.length} goal${cols.goals.length === 1 ? '' : 's'} · ` : ''}${busyAgents}/${p.maxAgents}`)),
    );
    if (!cols.doing.length && !cols.goals.length) doing.append(h('div', { class: 'empty' }, 'Nobody is working on anything.'));
    // the goals first: each is in progress for as long as it's open, whether or not its lead is at it right now
    for (const lead of cols.goals) {
      const note = h('div', { class: `note doing goal ${lead.status}`, title: 'Open the goal' },
        h('div', { class: 't' }, h('span', { class: 'dot', style: `background:${UNIFORM[lead.avatar.division]};margin-right:6px;vertical-align:-2px` }), lead.lead?.title ?? lead.issue.title),
        h('div', { class: 'm' }, h('span', { class: 'chip' }, `team station ${(lead.lead?.station ?? 0) + 1}`), h('span', { class: 'chip' }, lead.name), h('span', null, goalState(lead))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small go', title: 'Teleport to the goal’s briefing room', onclick: (e: MouseEvent) => (e.stopPropagation(), ui.goToAgent(lead.id)) }, 'Beam there'),
        ),
      );
      note.onclick = () => ui.openAgent(lead.id);
      doing.append(note);
    }
    for (const a of cols.doing) {
      const note = h('div', { class: `note doing ${a.status}`, title: 'Open their laptop' },
        h('div', { class: 't' }, h('span', { class: 'dot', style: `background:${UNIFORM[a.avatar.division]};margin-right:6px;vertical-align:-2px` }), `${a.name} · #${a.issue.number} ${a.issue.title}`),
        h('div', { class: 'm' }, h('span', { class: 'chip', style: `--tone:${LCARS_STATUS[a.status]}` }, a.status), h('span', { class: 'chip' }, `${a.effort ?? 'default'} effort`), a.cloud ? h('span', { class: 'chip' }, 'cloud') : null, multi ? h('span', { class: 'chip' }, a.repo.split('/')[1]) : null, h('span', null, statusLine(a))),
      );
      note.onclick = () => ui.openAgent(a.id);
      doing.append(note);
    }

    const prs = h('div', { class: 'col' }, h('h3', null, h('span', null, 'Ready to merge'), h('span', null, cols.prs.length)));
    mine.on = !!p.onlyMyPrs;
    if (!cols.prs.length) prs.append(h('div', { class: 'empty' }, cols.hiddenPrs ? 'None of the open pull requests are yours.' : 'No open pull requests.'));
    for (const pr of cols.prs) {
      const review = state.reviews.get(prKey(pr.repo, pr.number));
      const action = mergeAction(review, pr);
      const method = mergeMethodFor(state.project(projectId), pr.repo, state.info?.settings.mergeMethod ?? 'squash');
      const merge = action.kind === 'merge'
        ? h('button', { class: 'btn small go', title: action.override ? 'Merge past its merge check, on purpose' : 'Ops checks the PR merged onto its base first' }, action.override ? 'Merge anyway' : `${method} & merge`)
        : action.kind === 'queued'
          ? h('button', { class: 'btn small primary', title: 'Another merge in this repo goes first: Ops checks this one once that’s done' }, action.behind ? `Queued behind #${action.behind}` : 'Queued to merge')
          : action.kind === 'checking'
            ? h('button', { class: 'btn small primary', title: 'Ops is running the checks on the PR merged onto its base' }, 'Checking the merge…')
            : action.kind === 'when-passed'
              ? h('button', { class: 'btn small go', title: 'Ops merges the commit QA passes, or tells you if QA fails it' }, 'Merge when QA passes')
              : h('button', { class: 'btn small primary', title: 'Merges once QA passes it. Click to cancel' }, 'Merging when QA passes ✕');
      merge.disabled = pr.mergeable === 'CONFLICTING' || pr.isDraft || action.kind === 'checking' || action.kind === 'queued';
      merge.onclick = async () => {
        if (action.kind === 'checking' || action.kind === 'queued') return;
        if (action.kind !== 'merge') {
          const on = action.kind === 'when-passed';
          void busy(merge, async () => {
            await api.mergeWhenPassed(projectId, pr.repo, pr.number, on);
            ui.hud.toast('info', on ? `PR #${pr.number} merges once QA passes it` : `PR #${pr.number} won’t merge by itself after QA`);
          }, ui.error);
          return;
        }
        const ask = action.confirm
          ? `${action.confirm}.\n\nMerge ${pr.repo}#${pr.number} "${pr.title}" anyway?`
          : `Merge ${pr.repo}#${pr.number} "${pr.title}"?`;
        if (!await confirmDialog({ title: 'Merge', message: ask, confirmLabel: action.override ? 'Merge anyway' : 'Merge' })) return;
        // Ops checks the merge first, the card saying so, and a toast says how it went
        void busy(merge, () => api.mergePr(projectId, pr.repo, pr.number, action.override === true), ui.error);
      };
      const resolver = pr.resolver;
      const resolve = resolver
        ? h('button', { class: 'btn small primary', title: `Go to ${resolver.name}'s desk`, onclick: () => ui.goToAgent(resolver.id) }, 'Watch')
        : pr.mergeable === 'CONFLICTING' ? h('button', { class: 'btn small primary', title: `Merge ${pr.baseBranch} in, or hand the conflicts to an agent when git can't` }, 'Resolve conflicts') : null;
      if (resolve && !resolver) {
        // the PR's developer is already at it (or queued for it); a second click would only repeat the request
        resolve.disabled = resolvingAlready(pr.agent);
        resolve.onclick = () =>
          void busy(resolve, async () => {
            const outcome = await api.resolveConflicts(projectId, pr.repo, pr.number);
            if (outcome.kind === 'merged') ui.hud.toast('success', `Merged ${pr.baseBranch} into PR #${pr.number}: git resolved it without help`);
            else if (outcome.kind === 'up-to-date') ui.hud.toast('info', `PR #${pr.number} already has everything from ${pr.baseBranch}: GitHub hasn't caught up yet`);
            else ui.hud.toast('success', `${outcome.agent.name} is resolving the conflicts on PR #${pr.number}`, { label: 'Watch', run: () => ui.goToAgent(outcome.agent.id) });
          }, ui.error);
      }
      const checks = { passing: 'checks pass', failing: 'checks failing', pending: 'checks running', none: 'no checks' }[pr.checks];
      const agent = pr.agent;
      const running = state.previews.get(projectId);
      const preview = running && previewIncludes(running, pr.repo, pr.number) ? running : undefined;
      const along = board ? Object.entries(previewSet(pr, board, p.repos)).filter(([repo, n]) => repo !== pr.repo && n !== null) : [];
      const openPreview = () => ui.openPreview(projectId);
      const previewActions = !preview
        ? [h('button', {
            class: 'btn small',
            title: `Check this PR out and run it on your machine${running ? ` (replaces the preview of ${running.repo.split('/')[1]}#${running.number})` : ''}`,
            onclick: () => ui.previewPr(projectId, pr.repo, pr.number),
          }, 'Preview')]
        : preview.status === 'running'
          ? [
              ...preview.links.slice(0, 3).map((link) => {
                const sick = link.health === 'down' || link.health === 'error';
                const tip = [link.url, linkHealth(link)].filter(Boolean).join('\n');
                return h('a', { class: `btn small ${sick ? 'warn' : 'primary'}`, href: reachableUrl(link.url, preview.mirrors, location), target: '_blank', rel: 'noreferrer', title: tip }, `Open ${link.name ?? 'site'} ↗`);
              }),
              preview.warning
                ? h('button', { class: 'btn small warn', title: preview.warning, onclick: openPreview }, 'Running')
                : h('button', { class: 'btn small', title: 'Output, logs, restart and stop', onclick: openPreview }, 'Running'),
            ]
          : preview.status === 'failed'
            ? [h('button', { class: 'btn small danger', title: preview.error ?? '', onclick: openPreview }, 'Preview failed')]
            : [h('button', { class: 'btn small', title: preview.activity, onclick: openPreview }, preview.status === 'stopping' ? 'Stopping…' : 'Starting…')];
      const sha = preview?.checkouts.find((c) => c.repo === pr.repo)?.sha;
      const behind = sha && pr.headSha && sha !== 'demo' && !sameCommit(sha, pr.headSha);
      const qa = qaBadge(review, pr);
      const qaBusy = qa.state === 'queued' || qa.state === 'testing';
      const qaChip = qa.state === 'none'
        ? null
        : h('button', { class: `chip qa ${qa.state}`, title: review?.report?.summary ?? review?.error ?? 'Open the QA report', onclick: () => ui.openQa(projectId) }, qa.label);
      const triage = review?.triage && qa.state !== 'triaging'
        ? h('span', { class: 'chip', title: review.triage.note }, triageLabel(review.triage))
        : null;
      const sendToQa = h('button', { class: 'btn small', title: qa.state === 'none' ? 'Have the holodeck’s QA officer review and test it' : 'Test the latest commit again' }, qa.state === 'none' ? 'Send to QA' : 'Re-test');
      sendToQa.disabled = qaBusy;
      sendToQa.onclick = () =>
        void busy(sendToQa, async () => {
          await api.sendToQa(projectId, pr.repo, pr.number);
          ui.hud.toast('info', `PR #${pr.number} is with QA`);
        }, ui.error);
      prs.append(
        h('div', { class: 'note pr' },
          h('div', { class: 't' }, `PR #${pr.number} ${pr.title}`),
          h('div', { class: 'm' },
            agent ? h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${UNIFORM[agent.avatar.division]}` }), agent.name) : pr.author ? h('span', { class: 'chip' }, `@${pr.author}`) : null,
            multi ? h('span', { class: 'chip' }, pr.repo.split('/')[1]) : null,
            qaChip,
            triage,
            h('span', { class: pr.checks === 'failing' ? 'chip bad' : pr.checks === 'passing' ? 'chip ok' : 'chip' }, checks),
            pr.mergeCheck ? h('span', { class: pr.mergeCheck.state === 'refused' ? 'chip bad' : pr.mergeCheck.state === 'passed' ? 'chip ok' : 'chip', title: pr.mergeCheck.reason ?? '' }, mergeCheckLine(pr.mergeCheck)) : null,
            resolver
              ? h('span', { class: 'chip warn', title: resolver.activity }, `Resolving – ${resolver.name}`)
              : pr.mergeable === 'CONFLICTING' ? h('span', { class: 'chip bad' }, 'conflicts') : null,
            pr.isDraft ? h('span', { class: 'chip' }, 'draft') : null,
            pr.reviewDecision ? h('span', { class: 'chip' }, pr.reviewDecision.toLowerCase().replace('_', ' ')) : null,
            behind ? h('span', { class: 'chip warn', title: 'Restart the preview to see the latest commits' }, 'preview is behind') : null,
            along.length
              ? h('span', { class: 'chip', title: 'Preview checks these out too: they close issues with the same feature: label' },
                  `+ ${along.map(([repo, n]) => `${repo.split('/')[1]} #${n}`).join(', ')}`)
              : null,
          ),
          h('div', { class: 'actions' },
            resolve ?? merge,
            sendToQa,
            ...previewActions,
            h('a', { class: 'btn small', href: `${pr.url}/files`, target: '_blank', rel: 'noreferrer' }, 'Review ↗'),
            agent ? h('button', { class: 'btn small', onclick: () => ui.openAgent(agent.id) }, `Talk to ${agent.name}`) : null,
          ),
        ),
      );
    }

    // the column you came for is lit
    ({ todo, doing, prs }[focus ?? 'todo']).classList.add('on');
    fill(
      body,
      board?.error ? h('div', { class: 'ask error' }, board.error) : null,
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
  ui.panels.own(state.on('preview', (e) => e.projectId === projectId && rerender()));
  ui.panels.own(state.on('review', (id) => id === projectId && rerender()));
}
