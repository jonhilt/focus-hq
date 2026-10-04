import { plannerFor } from '../../shared/crew';
import { type Brief, type Briefing, type BriefingMessage, EMPTY_BRIEF, type Planner, type Settings } from '../../shared/types';
import type { Hub } from '../hub';
import type { Store, StoredBriefing } from '../store';
import { errorMessage, newId, truncate } from '../util';
import { type DraftResult, type IssuePlanner, ISSUE_FORMAT, repoList } from './planner';

export type TurnKind = 'open' | 'reply' | 'wrap-up';

export interface OfficerTurn {
  kind: TurnKind;
  projectId: string;
  projectName: string;
  planner: Planner;
  repos: string[];
  idea: string;
  brief: Brief;
  /** Everything said so far, the manager's latest message included. */
  messages: BriefingMessage[];
  /** The officer's session so far; missing on the first turn, or if it was lost. */
  resumeSessionId?: string;
  settings: Settings;
  signal: AbortSignal;
}

export interface OfficerHooks {
  activity(text: string): void;
  /** The officer updated the brief on the wall screen. */
  brief(brief: Brief): void;
}

export interface OfficerReply {
  /** What the officer says (not used on a wrap-up). */
  text: string;
  sessionId?: string;
  costUsd?: number;
  /** A wrap-up's issue. */
  draft?: DraftResult;
}

/** Takes one turn of a briefing. The live one resumes a read-only Claude Code session; the demo one is scripted. */
export interface BriefingOfficer {
  turn(req: OfficerTurn, hooks: OfficerHooks): Promise<OfficerReply>;
}

const publicView = ({ sessionId: _, ...briefing }: StoredBriefing): Briefing => briefing;

/**
 * Briefings in the observation lounge: the manager and a project's operations officer talk a bigger or fuzzier idea
 * through, the officer keeping a brief on the wall screen, until the manager wraps up and the officer writes one issue
 * to the project's stand. One at a time. Each turn resumes the officer's session, so nothing runs while it's your turn
 * and a briefing survives a restart.
 */
export class Briefings {
  private running: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly planner: IssuePlanner,
    private readonly officer: BriefingOfficer,
  ) {}

  current(): Briefing | null {
    return this.store.briefing ? publicView(this.store.briefing) : null;
  }

  call(projectId: string, idea: string): Briefing {
    const project = this.store.project(projectId);
    const officer = plannerFor(projectId);
    if (!project.repos.length) throw new Error(`${project.name} has no repositories yet`);
    if (!idea.trim()) throw new Error(`Tell ${officer.name} what the briefing is about`);
    const existing = this.store.briefing;
    if (existing && existing.status !== 'done') {
      const name = this.store.projects.find((p) => p.id === existing.projectId)?.name ?? 'another project';
      throw new Error(`${plannerFor(existing.projectId).name} is still in the lounge with a briefing about ${name}. Wrap it up or end it first.`);
    }
    const now = Date.now();
    const briefing: StoredBriefing = {
      id: newId('brief'),
      projectId,
      idea: idea.trim(),
      status: 'thinking',
      activity: 'Reading up on the project',
      messages: [{ from: 'manager', text: idea.trim(), at: now }],
      brief: { ...EMPTY_BRIEF },
      startedAt: now,
      updatedAt: now,
      costUsd: 0,
    };
    this.store.setBriefing(briefing);
    this.broadcast();
    this.run(briefing, 'open');
    return publicView(briefing);
  }

  say(text: string): Briefing {
    const briefing = this.ready();
    if (!text.trim()) throw new Error('Say something first');
    briefing.messages.push({ from: 'manager', text: text.trim(), at: Date.now() });
    this.turn(briefing, 'thinking', 'Thinking it over');
    this.run(briefing, 'reply');
    return publicView(briefing);
  }

  wrapUp(): Briefing {
    const briefing = this.ready();
    briefing.messages.push({ from: 'system', text: 'The manager wrapped up the briefing.', at: Date.now() });
    this.turn(briefing, 'wrapping-up', 'Writing up the issue');
    this.run(briefing, 'wrap-up');
    return publicView(briefing);
  }

  /** Ends the briefing (stopping the officer mid-thought if need be); the officer leaves the lounge. */
  end(): void {
    this.running?.abort();
    this.running = null;
    if (!this.store.briefing) return;
    this.store.setBriefing(null);
    this.broadcast();
  }

  /** The project is gone: so is any briefing about it. */
  projectRemoved(projectId: string): void {
    if (this.store.briefing?.projectId === projectId) this.end();
  }

  /** The briefing, if it's the manager's turn. */
  private ready(): StoredBriefing {
    const briefing = this.store.briefing;
    if (!briefing) throw new Error('There’s no briefing in session');
    const name = plannerFor(briefing.projectId).name;
    if (briefing.status === 'thinking' || briefing.status === 'wrapping-up') throw new Error(`${name} is still thinking`);
    if (briefing.status === 'done') throw new Error('This briefing is over: its issue is at the stand. End it to start another.');
    return briefing;
  }

  private turn(briefing: StoredBriefing, status: Briefing['status'], activity: string): void {
    Object.assign(briefing, { status, activity, error: undefined, updatedAt: Date.now() });
    this.store.save();
    this.broadcast();
  }

  private run(briefing: StoredBriefing, kind: TurnKind): void {
    const abort = new AbortController();
    this.running?.abort();
    this.running = abort;
    const current = () => this.store.briefing === briefing && this.running === abort;
    const project = this.store.project(briefing.projectId);
    const officer = plannerFor(briefing.projectId);

    void this.officer
      .turn(
        {
          kind,
          projectId: project.id,
          projectName: project.name,
          planner: officer,
          repos: [...project.repos],
          idea: briefing.idea,
          brief: briefing.brief,
          messages: [...briefing.messages],
          resumeSessionId: briefing.sessionId,
          settings: this.store.settings,
          signal: abort.signal,
        },
        {
          activity: (text) => {
            if (!current() || !text) return;
            briefing.activity = truncate(text, 120);
            this.broadcast();
          },
          brief: (brief) => {
            if (!current()) return;
            briefing.brief = brief;
            briefing.updatedAt = Date.now();
            this.store.save();
            this.broadcast();
          },
        },
      )
      .then((reply) => {
        if (!current()) return;
        briefing.sessionId = reply.sessionId ?? briefing.sessionId;
        briefing.costUsd += reply.costUsd ?? 0;
        const now = Date.now();
        if (kind === 'wrap-up') {
          if (!reply.draft) throw new Error('The officer finished without writing the issue');
          const draft = this.planner.deliver(project.id, briefing.brief.summary || briefing.idea, { ...reply.draft, sessionId: briefing.sessionId });
          briefing.messages.push({
            from: 'officer',
            text: `It’s written up and waiting at ${project.name}’s stand: “${draft.title}”. Have a look, edit what you like and pin it to the board. You can still ask me for a redraft there.`,
            at: now,
          });
          Object.assign(briefing, { status: 'done', activity: 'Issue drafted', updatedAt: now });
          this.hub.toast('success', `📋 ${officer.name} wrote up the briefing: “${truncate(draft.title ?? '', 60)}” is at ${project.name}’s stand`);
        } else {
          briefing.messages.push({ from: 'officer', text: reply.text.trim() || '…', at: now });
          Object.assign(briefing, { status: 'waiting', activity: 'Waiting for you', updatedAt: now });
        }
        this.store.save();
        this.broadcast();
      })
      .catch((err) => {
        if (!current()) return;
        Object.assign(briefing, { status: 'failed', activity: 'Lost the thread', error: errorMessage(err), updatedAt: Date.now() });
        this.store.save();
        this.broadcast();
      })
      .finally(() => {
        if (this.running === abort) this.running = null;
      });
  }

  private broadcast(): void {
    this.hub.send({ type: 'briefing', briefing: this.current() });
  }
}

// ---------------------------------------------------------------- prompts

export function briefingSystemPrompt(req: Pick<OfficerTurn, 'planner' | 'projectName' | 'repos'>): string {
  return `
# You are ${req.planner.name}, operations officer for ${req.projectName} aboard the Focus, in a briefing in the observation lounge

The manager has called a briefing about something bigger or fuzzier than a one-line issue. Your job: question them until you both agree on what to build and why. When they wrap up, you write it up as one GitHub issue that a Claude Code agent will build on its own, with nobody to ask, and that a reviewer will check the pull request against.

${repoList(req.repos)}

How to run the briefing:
- Ask one question per reply (two only when they're tightly linked). Keep replies short: a line on what you found or understood, then the question. No headings, no essays.
- Why first: the problem, who has it, and what success looks like. Then the what: the behaviour, the edge cases, what's out. The how only where it constrains the work.
- Look before you ask. Never ask what the code can tell you: read it (Read, Glob, Grep; you can't change anything) and bring what you found ("Orders already carry a status in shop-api/src/orders.ts. Should 'saved for later' be a status, or its own list?").
- Give your recommendation with each question, so the manager can just say yes.
- Push back on anything vague, contradictory or too big for one agent in one sitting, and suggest what to leave for later.
- Keep the brief current with mcp__brief__update_brief whenever something is agreed or a new question comes up. It's on the lounge's wall screen for both of you. One short line per entry, and drop open questions once they're answered.
- When nothing important is still open, say you have enough and suggest wrapping up. The manager decides when.
`.trim();
}

const transcript = (messages: BriefingMessage[]) =>
  messages.map((m) => `${m.from === 'manager' ? 'Manager' : m.from === 'officer' ? 'You' : 'Note'}: ${m.text}`).join('\n\n');

export function briefingPrompt(req: Pick<OfficerTurn, 'kind' | 'idea' | 'brief' | 'messages' | 'resumeSessionId'>): string {
  // a lost session (or one that never started) gets the conversation back from the transcript
  const recap = req.resumeSessionId
    ? ''
    : `Here's the briefing so far:\n"""\n${transcript(req.messages)}\n"""\n\nThe brief on the screen:\n${JSON.stringify(req.brief, null, 2)}\n\n`;
  if (req.kind === 'open') {
    return `The manager has called a briefing about:\n"""\n${req.idea}\n"""\n\nGet your bearings in the code, put a first draft of the brief on the screen with update_brief (including your open questions), then ask your first question.`;
  }
  if (req.kind === 'wrap-up') {
    return `${recap}The manager is wrapping up the briefing. Write the issue now, from the brief and everything you discussed.

${ISSUE_FORMAT}

It's one issue, for one agent in one sitting: anything you agreed to leave for later goes under Out of scope. Context carries the why from the briefing. Finish with the structured result: repo, title and body.`;
  }
  const latest = [...req.messages].reverse().find((m) => m.from === 'manager')?.text ?? '';
  return recap ? `${recap}The manager's latest message, for you to answer:\n"""\n${latest}\n"""` : latest;
}

/** Applies an update_brief call: fields left out stay as they are; lists replace the whole list. */
export function mergeBrief(brief: Brief, patch: Partial<Record<'summary' | 'why' | 'who', string> & Record<'scope' | 'out_of_scope' | 'acceptance' | 'open_questions', string[]>>): Brief {
  const lines = (list: string[] | undefined, fallback: string[]) => (list ? list.map((l) => l.trim()).filter(Boolean).slice(0, 12) : fallback);
  return {
    summary: patch.summary?.trim() ?? brief.summary,
    why: patch.why?.trim() ?? brief.why,
    who: patch.who?.trim() ?? brief.who,
    scope: lines(patch.scope, brief.scope),
    outOfScope: lines(patch.out_of_scope, brief.outOfScope),
    acceptance: lines(patch.acceptance, brief.acceptance),
    openQuestions: lines(patch.open_questions, brief.openQuestions),
  };
}
