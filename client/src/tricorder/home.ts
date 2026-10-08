import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { columns, goalState, resolvingAlready } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { assignWarning, waitsLabel } from '../../../shared/dependencies';
import { mergeAction } from '../../../shared/mergeGate';
import { prKey, qaBadge } from '../../../shared/qa';
import { type Attention, inFlight, needsYou } from '../../../shared/tricorder';
import type { Agent, Issue, Project, PullRequest, QaReview } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { h } from '../ui/dom';
import type { Actions } from './actions';

export interface HomeContext {
  actions: Actions;
  /** Whether a collapsible section is open, by key; sections the manager never touched use their default. */
  expanded: Map<string, boolean>;
  /** The PR card the Needs you strip just pointed at. */
  highlight: string | null;
  showPr(projectId: string, pr: PullRequest): void;
}

export const agentHref = (id: string) => `#agent/${encodeURIComponent(id)}`;
export const prCardId = (projectId: string, pr: Pick<PullRequest, 'repo' | 'number'>) => `pr:${projectId}:${prKey(pr.repo, pr.number)}`;
export const projectKey = (projectId: string) => `project:${projectId}`;

/** What the agent is on: a goal, an issue, or a pull request for conflicts, fixes and QA. */
export const workLabel = (a: Agent) =>
  a.task === 'lead' ? `🎯 ${a.lead?.title ?? a.issue.title}` : `${a.task === 'issue' ? '#' : 'PR #'}${a.issue.number} ${a.issue.title}`;

const FINISHED = ['done', 'error', 'stopped'];

/** The home screen: what needs you, then each shown project's agents in flight, PRs and issues. */
export function home(ctx: HomeContext): HTMLElement {
  const login = state.info?.github.login;
  const boards = state.shown.map((project) => ({ project, cols: columns(project, state.boards.get(project.id), state.agentsIn(project.id), login) }));
  const attention = needsYou(
    state.shownAgents(),
    boards.flatMap(({ project, cols }) => cols.prs.map((pr) => ({ projectId: project.id, pr }))),
    state.reviews,
  );
  return h('main', { class: 'home' },
    needsYouStrip(ctx, attention),
    state.info && !state.projects.length ? h('p', { class: 'empty' }, 'No projects yet. Create one in the 3D office’s ready room.') : null,
    ...boards.map(({ project, cols }) => projectSection(ctx, project, cols)),
  );
}

function needsYouStrip(ctx: HomeContext, attention: Attention[]): HTMLElement {
  const items = attention.map((a) => {
    switch (a.kind) {
      case 'hand':
        return agentEntry(a.agent, '✋', `${a.agent.name} wants to run`, a.agent.permission?.summary ?? '');
      case 'error':
        return agentEntry(a.agent, '❗', `${a.agent.name} hit a problem`, a.agent.error ?? workLabel(a.agent));
      case 'qa': {
        const reason = state.reviews.get(prKey(a.pr.repo, a.pr.number))?.followUp;
        return prEntry(ctx, a.projectId, a.pr, '🙋', 'QA needs you', reason?.kind === 'needs-you' ? reason.reason : a.pr.title);
      }
      case 'conflicts':
        return prEntry(ctx, a.projectId, a.pr, '⚠', 'Conflicts', a.pr.title);
    }
  });
  return h('section', { class: `needs-you ${items.length ? 'alert' : 'clear'}` },
    h('h2', { class: 'bar' }, h('span', null, 'Needs you'), h('span', { class: 'count' }, items.length)),
    items.length
      ? h('ul', null, ...items)
      : h('p', { class: 'all-clear' }, state.info ? '✓ All clear. Nothing is waiting on you.' : 'Connecting to the office…'),
  );
}

function agentEntry(agent: Agent, icon: string, what: string, detail: string): HTMLElement {
  const project = state.project(agent.projectId);
  return h('li', null, h('a', { class: 'entry', href: agentHref(agent.id), style: `--accent:${project?.color ?? 'var(--lcars-gold)'}` },
    h('span', { class: 'icon' }, icon),
    h('span', { class: 'text' }, h('strong', null, what), h('span', { class: 'detail' }, detail), h('small', null, `${project?.name ?? ''} · ${workLabel(agent)}`)),
  ));
}

function prEntry(ctx: HomeContext, projectId: string, pr: PullRequest, icon: string, what: string, detail: string): HTMLElement {
  const project = state.project(projectId);
  return h('li', null, h('button', { class: 'entry', type: 'button', style: `--accent:${project?.color ?? 'var(--lcars-gold)'}`, attrs: { 'data-key': prCardId(projectId, pr) }, onclick: () => ctx.showPr(projectId, pr) },
    h('span', { class: 'icon' }, icon),
    h('span', { class: 'text' }, h('strong', null, `${what} · PR #${pr.number}`), h('span', { class: 'detail' }, detail), h('small', null, `${project?.name ?? ''} · ${pr.repo}`)),
  ));
}

function collapsible(ctx: HomeContext, key: string, fallback: boolean, cls: string, summary: Node[], ...body: (Node | null)[]): HTMLDetailsElement {
  const details = h('details', { class: cls, open: ctx.expanded.get(key) ?? fallback, attrs: { 'data-key': key } }, h('summary', null, ...summary), ...body);
  details.ontoggle = () => ctx.expanded.set(key, details.open);
  return details;
}

function projectSection(ctx: HomeContext, project: Project, cols: ReturnType<typeof columns>): HTMLElement {
  // the goals have their own list: in progress for as long as they're open
  const flying = inFlight(project.id, state.agentsIn(project.id)).filter((a) => a.task !== 'lead');
  const multi = project.repos.length > 1;
  const board = state.boards.get(project.id);
  const section = collapsible(ctx, projectKey(project.id), true, 'project',
    [
      h('span', { class: 'name' }, project.name),
      h('span', { class: 'counts' }, `${cols.goals.length ? `${cols.goals.length} goal${cols.goals.length === 1 ? '' : 's'} · ` : ''}${flying.length} flying · ${cols.prs.length} PR${cols.prs.length === 1 ? '' : 's'}`),
    ],
    board?.error ? h('p', { class: 'error-text' }, `⚠ ${board.error}`) : null,
    cols.goals.length ? h('h3', null, 'Goals') : null,
    cols.goals.length ? h('div', { class: 'list' }, ...cols.goals.map(goalCard)) : null,
    h('h3', null, 'In flight'),
    flying.length ? h('div', { class: 'list' }, ...flying.map((a) => agentCard(a, multi))) : h('p', { class: 'empty' }, 'Nobody is working right now.'),
    h('h3', null, 'Ready to merge'),
    cols.prs.length
      ? h('div', { class: 'list' }, ...cols.prs.map((pr) => prCard(ctx, project, pr, multi)))
      : h('p', { class: 'empty' }, cols.hiddenPrs ? 'None of the open pull requests are yours.' : 'No open pull requests.'),
    collapsible(ctx, `todo:${project.id}`, false, 'todo', [h('span', null, 'To do'), h('span', { class: 'count' }, cols.todo.length)],
      cols.todo.length
        ? h('div', { class: 'list' }, ...cols.todo.map((issue) => issueCard(ctx, project, issue, multi, cols.doing)))
        : h('p', { class: 'empty' }, project.repos.length ? 'No open issues.' : 'Connect a repository in the ready room first.'),
    ),
  );
  section.style.setProperty('--accent', project.color);
  return section;
}

function goalCard(lead: Agent): HTMLElement {
  return h('a', { class: 'card agent', href: agentHref(lead.id), attrs: { 'data-key': `agent:${lead.id}` } },
    h('div', { class: 'row' },
      h('span', { class: 'dot', style: `background:${UNIFORM[lead.avatar.division]}` }),
      h('strong', { class: 'grow' }, `${lead.name} · team station ${(lead.lead?.station ?? 0) + 1}`),
      // between turns, a lead isn't "done": the goal's line below says what it waits for
      lead.status === 'done' || lead.status === 'stopped' ? null : h('span', { class: `pill status ${lead.status}` }, `${statusIcon(lead)} ${lead.status}`),
    ),
    h('div', { class: 'title' }, workLabel(lead)),
    h('div', { class: 'activity' }, goalState(lead)),
  );
}

function agentCard(a: Agent, multi: boolean): HTMLElement {
  return h('a', { class: 'card agent', href: agentHref(a.id), attrs: { 'data-key': `agent:${a.id}` } },
    h('div', { class: 'row' },
      h('span', { class: 'dot', style: `background:${UNIFORM[a.avatar.division]}` }),
      h('strong', { class: 'grow' }, a.task === 'review' ? `${a.name} · QA` : a.name),
      h('span', { class: `pill status ${a.status}` }, `${statusIcon(a)} ${a.status}`),
    ),
    h('div', { class: 'title' }, multi ? h('span', { class: 'repo' }, `${a.repo.split('/')[1]} `) : null, workLabel(a)),
    h('div', { class: 'activity' }, statusLine(a)),
  );
}

/**
 * The PR card's merge button. morph() keeps an element whose attributes haven't changed, and its click handler with
 * it, so each thing the button can do (and each confirm it asks) has an action key of its own.
 */
export function mergeButton(actions: Actions, key: string, projectId: string, pr: PullRequest, review: QaReview | undefined): HTMLButtonElement {
  const action = mergeAction(review, pr);
  const blocked = pr.mergeable === 'CONFLICTING' || pr.isDraft;
  switch (action.kind) {
    case 'merge':
      return actions.button(`${key}:${action.confirm ? 'merge-anyway' : 'merge'}`, `⤵ ${state.info?.settings.mergeMethod ?? 'squash'} & merge`, () => api.mergePr(projectId, pr.repo, pr.number), {
        class: 'go',
        disabled: blocked,
        confirm: action.confirm ? `${action.confirm}.\n\nMerge ${pr.repo}#${pr.number} "${pr.title}" anyway?` : `Merge ${pr.repo}#${pr.number} "${pr.title}"?`,
      });
    case 'when-passed':
      return actions.button(`${key}:merge-when-passed`, '⤵ Merge when QA passes', () => api.mergeWhenPassed(projectId, pr.repo, pr.number, true), { class: 'go', disabled: blocked });
    case 'requested':
      return actions.button(`${key}:merge-cancel`, '✕ Merging when QA passes', () => api.mergeWhenPassed(projectId, pr.repo, pr.number, false), { class: 'primary' });
  }
}

function prCard(ctx: HomeContext, project: Project, pr: PullRequest & { agent?: Agent; resolver?: Agent }, multi: boolean): HTMLElement {
  const key = prCardId(project.id, pr);
  const review = state.reviews.get(prKey(pr.repo, pr.number));
  const qa = qaBadge(review, pr);
  const conflicting = pr.mergeable === 'CONFLICTING';
  const { actions } = ctx;
  const merge = mergeButton(actions, key, project.id, pr, review);
  // the PR's developer is already at it (or queued for it); a second tap would only repeat the request
  const resolve = pr.resolver
    ? h('a', { class: 'btn primary', href: agentHref(pr.resolver.id) }, '👀 Watch')
    : conflicting
    ? actions.button(`${key}:resolve`, '🔧 Resolve conflicts', () => api.resolveConflicts(project.id, pr.repo, pr.number), {
        class: 'primary',
        disabled: resolvingAlready(pr.agent),
      })
    : null;
  const sendToQa = actions.button(`${key}:qa`, qa.state === 'none' ? '🔍 Send to QA' : '↻ Re-test', () => api.sendToQa(project.id, pr.repo, pr.number), {
    disabled: qa.state === 'queued' || qa.state === 'testing',
  });
  const checks = { passing: '✓ checks pass', failing: '✗ checks failing', pending: '⏳ checks running', none: 'no checks' }[pr.checks];
  return h('article', { class: `card pr${ctx.highlight === key ? ' flash' : ''}`, attrs: { 'data-key': key } },
    h('div', { class: 'title' }, h('a', { href: pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${pr.number}`), ` ${pr.title}`),
    h('div', { class: 'pills' },
      pr.agent
        ? h('a', { class: 'pill', href: agentHref(pr.agent.id) }, h('span', { class: 'dot', style: `background:${UNIFORM[pr.agent.avatar.division]}` }), pr.agent.name)
        : pr.author ? h('span', { class: 'pill' }, `@${pr.author}`) : null,
      multi ? h('span', { class: 'pill' }, pr.repo.split('/')[1]) : null,
      qa.state === 'none' ? null : h('span', { class: `pill qa ${qa.state}` }, qa.label),
      h('span', { class: `pill checks ${pr.checks}` }, checks),
      pr.resolver
        ? h('span', { class: 'pill warn', title: pr.resolver.activity }, `🔧 Resolving – ${pr.resolver.name}`)
        : conflicting ? h('span', { class: 'pill bad' }, '⚠ conflicts') : null,
      pr.isDraft ? h('span', { class: 'pill' }, 'draft') : null,
    ),
    h('div', { class: 'actions' }, resolve ?? merge, sendToQa),
    actions.errors(key),
  );
}

function issueCard(ctx: HomeContext, project: Project, issue: Issue & { waitsFor: number[] }, multi: boolean, doing: Agent[]): HTMLElement {
  const key = `issue:${prKey(issue.repo, issue.number)}`;
  const full = doing.filter((a) => !FINISHED.includes(a.status)).length >= project.maxAgents;
  const waits = waitsLabel(issue.waitsFor);
  return h('article', { class: 'card issue', attrs: { 'data-key': key } },
    h('div', { class: 'title' }, h('a', { href: issue.url, target: '_blank', rel: 'noreferrer' }, `#${issue.number}`), ` ${issue.title}`),
    issue.labels.length || multi || waits
      ? h('div', { class: 'pills' },
          waits ? h('span', { class: 'pill' }, `⏸ ${waits}`) : null,
          multi ? h('span', { class: 'pill' }, issue.repo.split('/')[1]) : null,
          ...issue.labels.slice(0, 4).map((l) => h('span', { class: 'pill' }, l)))
      : null,
    h('div', { class: 'actions' }, ctx.actions.button(`${key}:hire`, full ? '⏳ Queue agent' : '🤖 Assign agent', () => api.hire(project.id, issue), {
      class: 'primary',
      confirm: assignWarning(issue),
    })),
    ctx.actions.errors(key),
  );
}
