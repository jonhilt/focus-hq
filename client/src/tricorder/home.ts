import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { columns } from '../../../shared/board';
import { UNIFORM } from '../../../shared/crew';
import { assignWarning, waitsLabel } from '../../../shared/dependencies';
import { prKey, qaBadge } from '../../../shared/qa';
import { type Attention, inFlight, needsYou } from '../../../shared/tricorder';
import type { Agent, Issue, Project, PullRequest } from '../../../shared/types';
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

/** What the agent is on: an issue, or a pull request for conflicts, fixes and QA. */
export const workLabel = (a: Agent) => `${a.task === 'issue' ? '#' : 'PR #'}${a.issue.number} ${a.issue.title}`;

const FINISHED = ['done', 'error', 'stopped'];

/** The home screen: what needs you, then each project's agents in flight, PRs and issues. */
export function home(ctx: HomeContext): HTMLElement {
  const login = state.info?.github.login;
  const boards = state.projects.map((project) => ({ project, cols: columns(project, state.boards.get(project.id), state.agentsIn(project.id), login) }));
  const attention = needsYou(
    [...state.agents.values()],
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
  const flying = inFlight(project.id, state.agentsIn(project.id));
  const multi = project.repos.length > 1;
  const board = state.boards.get(project.id);
  const section = collapsible(ctx, projectKey(project.id), true, 'project',
    [
      h('span', { class: 'name' }, project.name),
      h('span', { class: 'counts' }, `${flying.length} flying · ${cols.prs.length} PR${cols.prs.length === 1 ? '' : 's'}`),
    ],
    board?.error ? h('p', { class: 'error-text' }, `⚠ ${board.error}`) : null,
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

function prCard(ctx: HomeContext, project: Project, pr: PullRequest & { agent?: Agent }, multi: boolean): HTMLElement {
  const key = prCardId(project.id, pr);
  const qa = qaBadge(state.reviews.get(prKey(pr.repo, pr.number)), pr);
  const conflicting = pr.mergeable === 'CONFLICTING';
  const { actions } = ctx;
  const merge = actions.button(`${key}:merge`, `⤵ ${state.info?.settings.mergeMethod ?? 'squash'} & merge`, () => api.mergePr(project.id, pr.repo, pr.number), {
    class: 'go',
    disabled: conflicting || pr.isDraft,
    confirm: `Merge ${pr.repo}#${pr.number} "${pr.title}"?`,
  });
  // the PR's agent is already at it (or queued for it); a second tap would only repeat the request
  const resolve = conflicting
    ? actions.button(`${key}:resolve`, '🔧 Resolve conflicts', () => api.resolveConflicts(project.id, pr.repo, pr.number), {
        class: 'primary',
        disabled: !!pr.agent && !FINISHED.includes(pr.agent.status),
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
      conflicting ? h('span', { class: 'pill bad' }, '⚠ conflicts') : null,
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
