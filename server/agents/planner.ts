import { plannerFor } from '../../shared/crew';
import type { IssueDraft, Planner, Settings } from '../../shared/types';
import { PUBLIC_WORDS_RULE } from '../../shared/wording';
import type { Hub } from '../hub';
import type { Store } from '../store';
import { errorMessage, truncate } from '../util';
import { crewPrompt } from './crewFiles';

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
  /** Set when the planner thinks the idea is too big or too vague for one issue: why, in a line. */
  tooBig?: string;
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
 * Each room's planner: the operations officer at its Ops station. Turns the manager's rough idea into an issue
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
    const refused = draftRefusal({ project: project.name, repos: project.repos.length, planner: planner.name, drafting: this.running.has(projectId), idea, revise });
    if (refused) throw new Error(refused);

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
        const ready = readyDraft(result, repos, Date.now());
        Object.assign(draft, ready);
        this.broadcast(draft);
        this.hub.toast('success', `📝 ${planner.name} has a draft ready at ${project.name}'s Ops station: ${truncate(ready.title, 60)}`, undefined, project.id);
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

// ---------------------------------------------------------------- decisions

/** Why the planner won't start this draft, or undefined when they will. */
export function draftRefusal(ask: {
  project: string;
  repos: number;
  planner: string;
  drafting: boolean;
  idea: string;
  revise?: DraftRequest['revise'];
}): string | undefined {
  if (!ask.repos) return `${ask.project} has no repositories yet`;
  if (ask.drafting) return `${ask.planner} is already drafting an issue for ${ask.project}`;
  if (ask.revise) return ask.revise.notes.trim() ? undefined : `Tell ${ask.planner} what to change`;
  return ask.idea.trim() ? undefined : `Tell ${ask.planner} what you have in mind`;
}

/**
 * What a finished draft becomes: in the planner's repo while it's still one of the project's (else its first), trimmed,
 * and only flagged too big for a reason that says something.
 */
export function readyDraft(result: DraftResult, repos: readonly string[], now: number): Partial<IssueDraft> & { title: string } {
  return {
    status: 'ready',
    activity: 'Draft ready',
    repo: repos.includes(result.repo) ? result.repo : repos[0],
    title: result.title.trim(),
    body: result.body.trim(),
    tooBig: result.tooBig?.trim() || undefined,
    costUsd: result.costUsd,
    finishedAt: now,
  };
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
  return repos.map((r) => `- \`${folders.get(r)}/\`: ${r}`).join('\n');
}

/** The planner's instructions (.focus/crew/planner.md), the issue's format among them. */
export function plannerSystemPrompt(req: Pick<DraftRequest, 'planner' | 'projectName' | 'repos'>): string {
  return crewPrompt('planner', { name: req.planner.name, project: req.projectName, repoList: repoList(req.repos), publicWordsRule: PUBLIC_WORDS_RULE }).trim();
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
      tooBig: { type: 'string', description: 'Only if the idea is too big or too vague for one issue: why, in one line, so the manager can start it as a goal with a lead instead.' },
    },
  };
}
