import { plannerFor } from '../../shared/crew';
import type { IssueDraft, Planner, Settings } from '../../shared/types';
import type { Hub } from '../hub';
import type { Store } from '../store';
import { errorMessage, truncate } from '../util';

export interface DraftRequest {
  projectId: string;
  projectName: string;
  planner: Planner;
  repos: string[];
  idea: string;
  /** Redrafting: the draft as the manager edited it, and what they want changed. */
  revise?: { repo: string; title: string; body: string; notes: string };
  /** The planner's last session for this draft, resumed on a redraft so it doesn't explore the code all over again. */
  resumeSessionId?: string;
  settings: Settings;
  signal: AbortSignal;
}

export interface DraftResult {
  repo: string;
  title: string;
  body: string;
  sessionId?: string;
  costUsd?: number;
}

/** Writes one issue draft. The live one is a read-only Claude Code session; the demo one is scripted. */
export interface Drafter {
  draft(req: DraftRequest, activity: (text: string) => void): Promise<DraftResult>;
  /** Clean up after a project that was deleted (its checkouts). */
  forget?(projectId: string): void;
}

/**
 * Each room's planner: the operations officer at the ＋ New issue stand. Turns the manager's rough idea into an issue
 * with context and acceptance criteria. Drafts live in memory until they're filed or discarded; filing stays with the
 * manager.
 */
export class IssuePlanner {
  private drafts = new Map<string, IssueDraft>();
  private running = new Map<string, AbortController>();
  private sessions = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly drafter: Drafter,
  ) {}

  list(): IssueDraft[] {
    return [...this.drafts.values()];
  }

  start(projectId: string, idea: string, revise?: DraftRequest['revise']): IssueDraft {
    const project = this.store.project(projectId);
    const planner = plannerFor(projectId);
    if (!project.repos.length) throw new Error(`${project.name} has no repositories yet`);
    if (this.running.has(projectId)) throw new Error(`${planner.name} is already drafting an issue for ${project.name}`);
    if (revise ? !revise.notes.trim() : !idea.trim()) throw new Error(revise ? `Tell ${planner.name} what to change` : `Tell ${planner.name} what you have in mind`);

    const draft: IssueDraft = { projectId, status: 'drafting', idea: idea.trim(), activity: 'Reading up on the project', startedAt: Date.now() };
    this.set(draft);
    const abort = new AbortController();
    this.running.set(projectId, abort);
    const current = () => this.drafts.get(projectId) === draft;

    void this.drafter
      .draft(
        {
          projectId,
          projectName: project.name,
          planner,
          repos: [...project.repos],
          idea: draft.idea,
          revise,
          resumeSessionId: revise ? this.sessions.get(projectId) : undefined,
          settings: this.store.settings,
          signal: abort.signal,
        },
        (activity) => {
          if (!current() || !activity) return;
          draft.activity = truncate(activity, 120);
          this.broadcast(draft);
        },
      )
      .then((result) => {
        if (!current()) return;
        if (result.sessionId) this.sessions.set(projectId, result.sessionId);
        const repos = this.store.projects.find((p) => p.id === projectId)?.repos ?? [];
        Object.assign(draft, {
          status: 'ready',
          activity: 'Draft ready',
          repo: repos.includes(result.repo) ? result.repo : repos[0],
          title: result.title.trim(),
          body: result.body.trim(),
          costUsd: result.costUsd,
          finishedAt: Date.now(),
        } satisfies Partial<IssueDraft>);
        this.broadcast(draft);
        this.hub.toast('success', `📝 ${planner.name} has a draft ready at ${project.name}'s stand: ${truncate(draft.title ?? '', 60)}`);
      })
      .catch((err) => {
        if (!current()) return; // discarded meanwhile
        Object.assign(draft, { status: 'failed', activity: 'Couldn’t finish the draft', error: errorMessage(err), finishedAt: Date.now() } satisfies Partial<IssueDraft>);
        this.broadcast(draft);
      })
      .finally(() => {
        if (this.running.get(projectId) === abort) this.running.delete(projectId);
      });
    return draft;
  }

  /**
   * Puts a finished draft at the project's stand, written somewhere else (at the end of a briefing). `sessionId` is the
   * session that wrote it, so a redraft at the stand carries on from the whole discussion.
   */
  deliver(projectId: string, idea: string, result: DraftResult): IssueDraft {
    this.running.get(projectId)?.abort();
    this.running.delete(projectId);
    if (result.sessionId) this.sessions.set(projectId, result.sessionId);
    const repos = this.store.project(projectId).repos;
    const now = Date.now();
    const draft: IssueDraft = {
      projectId,
      status: 'ready',
      idea,
      activity: 'Draft ready',
      repo: repos.includes(result.repo) ? result.repo : repos[0],
      title: result.title.trim(),
      body: result.body.trim(),
      costUsd: result.costUsd,
      startedAt: now,
      finishedAt: now,
    };
    this.set(draft);
    return draft;
  }

  /** Stops a draft in progress, or throws away a finished one. */
  discard(projectId: string): void {
    this.running.get(projectId)?.abort();
    this.running.delete(projectId);
    this.sessions.delete(projectId);
    if (this.drafts.delete(projectId)) this.hub.send({ type: 'draft', projectId, draft: null });
  }

  /** The project is gone: drop its draft and the planner's checkouts. */
  remove(projectId: string): void {
    this.discard(projectId);
    this.drafter.forget?.(projectId);
  }

  private set(draft: IssueDraft): void {
    this.drafts.set(draft.projectId, draft);
    this.broadcast(draft);
  }

  private broadcast(draft: IssueDraft): void {
    this.hub.send({ type: 'draft', projectId: draft.projectId, draft });
  }
}

// ---------------------------------------------------------------- prompts

/** Each repo's folder name in the planner's checkout: the bare name, unless two repos share it. */
export function repoFolders(repos: string[]): Map<string, string> {
  const names = repos.map((r) => r.split('/')[1]);
  return new Map(repos.map((r, i) => [r, names.filter((n) => n === names[i]).length > 1 ? r.replace('/', '__') : names[i]]));
}

/** Where the project's repos are, for a planner's system prompt. */
export function repoList(repos: string[]): string {
  const folders = repoFolders(repos);
  return `The project's repositories are checked out read-only, at their default branch, in your current directory:
${repos.map((r) => `- \`${folders.get(r)}/\`: ${r}`).join('\n')}`;
}

/** The issue a planner writes, from the stand or at the end of a briefing. */
export const ISSUE_FORMAT = `The issue:
- title: imperative and specific, under 70 characters ("Show stock levels on the product page").
- body, in Markdown, with these sections:
  - \`## Context\`: why this is wanted and how things work today, naming the files involved.
  - \`## What to build\`: the change, concretely.
  - \`## Acceptance criteria\`: a checklist (\`- [ ]\`) of observable, testable outcomes, including edge cases and anything that must keep working.
  - \`## Out of scope\`: what to leave alone (skip it if nothing needs saying).
  - \`## Assumptions\`: only if you made any.`;

export function plannerSystemPrompt(req: Pick<DraftRequest, 'planner' | 'projectName' | 'repos'>): string {
  return `
# You are ${req.planner.name}, operations officer for ${req.projectName} aboard the Focus

The manager hands you a rough idea. You write it up as a GitHub issue that a Claude Code agent will build on its own, with nobody to ask, and that a reviewer will later check the pull request against. The issue is all they get, so make it specific to this codebase.

${repoList(req.repos)}

How to work:
- You can only read (Read, Glob, Grep). Start with the relevant repo's CLAUDE.md or README, then look at the code the change touches, so the issue names real files, modules and conventions.
- Spend a few minutes, not an audit: you're scoping the work, not doing it. Describe the outcome and point at where it lives; don't write the implementation into the issue.
- Don't add requirements the manager didn't ask for. Where the idea is ambiguous, pick the sensible reading and note it under Assumptions so the manager can correct it.
- Size it for one agent in one sitting. If the idea is much bigger, write up the first useful slice and list the rest under Out of scope.
- Pick the repository the work belongs in. If it spans several, pick the one with most of the work and mention the others under Context.

${ISSUE_FORMAT}

Finish with the structured result: repo, title and body.
`.trim();
}

export function plannerPrompt(req: Pick<DraftRequest, 'idea' | 'revise'>): string {
  if (!req.revise) return `Idea from the manager:\n"""\n${req.idea}\n"""`;
  const r = req.revise;
  return [
    req.idea ? `The manager's original idea:\n"""\n${req.idea}\n"""\n` : '',
    `Your last draft, as the manager has edited it (for ${r.repo}):`,
    '"""',
    `# ${r.title}`,
    '',
    r.body,
    '"""',
    '',
    `What the manager wants changed:\n"""\n${r.notes}\n"""`,
    '',
    "Revise the draft. Keep the manager's own edits unless their notes say otherwise.",
  ].filter((l, i) => l !== '' || i > 0).join('\n');
}

/** JSON schema for the planner's structured result. */
export function draftSchema(repos: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['repo', 'title', 'body'],
    properties: {
      repo: { type: 'string', enum: repos, description: 'The repository the issue should be filed in.' },
      title: { type: 'string', description: 'Imperative and specific, under 70 characters.' },
      body: { type: 'string', description: 'The issue body in Markdown: Context, What to build, Acceptance criteria, Out of scope, Assumptions.' },
    },
  };
}
