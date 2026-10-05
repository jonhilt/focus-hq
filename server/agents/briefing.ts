import { plannerFor, qaAtBriefing, qaOfficerFor } from '../../shared/crew';
import { type Brief, type BriefDiagram, type Briefing, type BriefingMessage, EMPTY_BRIEF, type Planner, type Settings } from '../../shared/types';
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
  activity: (text: string) => void;
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

export interface QaTurn {
  projectId: string;
  projectName: string;
  qa: Planner;
  planner: Planner;
  repos: string[];
  /** What QA checks on every PR of this project (the QA station's brief); empty if there's none. */
  qaBrief: string;
  /** The acceptance criteria before the officer's latest turn. */
  previous: string[];
  brief: Brief;
  messages: BriefingMessage[];
  /** QA's session in this briefing so far; missing the first time they speak up, or if it was lost. */
  resumeSessionId?: string;
  settings: Settings;
  signal: AbortSignal;
}

export interface QaReply {
  /** At most one short note; missing when the criteria are fine as they are. */
  note?: string;
  sessionId?: string;
  costUsd?: number;
}

/** The room's QA officer at the briefing, looking over acceptance criteria that just changed. Read-only, like the officer. */
export interface BriefingQa {
  check(req: QaTurn, activity: (text: string) => void): Promise<QaReply>;
}

/** QA speaks only when the officer added or changed acceptance criteria; on any other turn they cost nothing. */
export const acceptanceChanged = (before: string[], after: string[]): boolean =>
  before.length !== after.length || before.some((line, i) => line !== after[i]);

const publicView = ({ sessionId: _, qaSessionId: __, ...briefing }: StoredBriefing): Briefing => briefing;

/**
 * Briefings in the observation lounge: the manager and a project's operations officer talk a bigger or fuzzier idea
 * through, the officer keeping a brief on the wall screen, until the manager wraps up and the officer writes one issue
 * to the project's stand. The project's QA officer sits in and adds a note when the acceptance criteria change. One at
 * a time. Each turn resumes the officer's (and QA's) session, so nothing runs while it's your turn and a briefing
 * survives a restart.
 */
export class Briefings {
  private running: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly planner: IssuePlanner,
    private readonly officer: BriefingOfficer,
    private readonly qa: BriefingQa,
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
    briefing.messages.push({ from: 'system', text: 'The captain wrapped up the briefing.', at: Date.now() });
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
    if (briefing.status === 'qa-checking') throw new Error(`${qaOfficerFor(briefing.projectId).name} is still reading the acceptance criteria`);
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
    void this.converse(briefing, kind, abort.signal, current)
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

  /** The officer's turn, then QA's note if the officer changed the acceptance criteria. */
  private async converse(briefing: StoredBriefing, kind: TurnKind, signal: AbortSignal, current: () => boolean): Promise<void> {
    const project = this.store.project(briefing.projectId);
    const officer = plannerFor(briefing.projectId);
    const before = briefing.brief.acceptance;
    const reply = await this.officer.turn(
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
        signal,
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
    );
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
      this.store.save();
      this.broadcast();
      return;
    }
    briefing.messages.push({ from: 'officer', text: reply.text.trim() || '…', at: now });
    if (acceptanceChanged(before, briefing.brief.acceptance) && qaAtBriefing(project.id, briefing, this.store.agentsIn(project.id).find((a) => a.task === 'review'))) {
      await this.qaNote(briefing, before, signal, current);
      if (!current()) return;
    }
    Object.assign(briefing, { status: 'waiting', activity: 'Waiting for you', updatedAt: Date.now() });
    this.store.save();
    this.broadcast();
  }

  /** QA's note on the changed criteria, if they have one. A QA hiccup doesn't cost the officer's reply: it's a note in the log. */
  private async qaNote(briefing: StoredBriefing, previous: string[], signal: AbortSignal, current: () => boolean): Promise<void> {
    const project = this.store.project(briefing.projectId);
    const qa = qaOfficerFor(project.id);
    this.turn(briefing, 'qa-checking', 'Reading the acceptance criteria');
    try {
      const reply = await this.qa.check(
        {
          projectId: project.id,
          projectName: project.name,
          qa,
          planner: plannerFor(project.id),
          repos: [...project.repos],
          qaBrief: project.qaBrief?.trim() ?? '',
          previous,
          brief: briefing.brief,
          messages: [...briefing.messages],
          resumeSessionId: briefing.qaSessionId,
          settings: this.store.settings,
          signal,
        },
        (text) => {
          if (!current() || !text) return;
          briefing.activity = truncate(text, 120);
          this.broadcast();
        },
      );
      if (!current()) return;
      briefing.qaSessionId = reply.sessionId ?? briefing.qaSessionId;
      briefing.costUsd += reply.costUsd ?? 0;
      if (reply.note) briefing.messages.push({ from: 'qa', text: reply.note, at: Date.now() });
    } catch (err) {
      if (!current()) return;
      briefing.messages.push({ from: 'system', text: `${qa.name} couldn’t check the acceptance criteria: ${errorMessage(err)}`, at: Date.now() });
    }
  }

  private broadcast(): void {
    this.hub.send({ type: 'briefing', briefing: this.current() });
  }
}

// ---------------------------------------------------------------- prompts

export function briefingSystemPrompt(req: Pick<OfficerTurn, 'planner' | 'projectId' | 'projectName' | 'repos'>): string {
  return `
# You are ${req.planner.name}, operations officer for ${req.projectName} aboard the Focus, in a briefing in the observation lounge

The manager has called a briefing about something bigger or fuzzier than a one-line issue. Your job: question them until you both agree on what to build and why. When they wrap up, you write it up as one GitHub issue that a Claude Code agent will build on its own, with nobody to ask, and that a reviewer will check the pull request against.

${repoList(req.repos)}

How to run the briefing:
- Ask one question per reply (two only when they're tightly linked). Keep replies short: a line on what you found or understood, then the question. No headings, no essays.
- Why first: the problem, who has it, and what success looks like. Then the what: the behaviour, the edge cases, what's out. The how where it constrains the work, or where the change is complex enough to need designing (below).
- Look before you ask. Never ask what the code can tell you: read it (Read, Glob, Grep; you can't change anything) and bring what you found ("Orders already carry a status in shop-api/src/orders.ts. Should 'saved for later' be a status, or its own list?").
- When the question goes beyond the code (library versions, migration guidance, external APIs, docs), search and read the web (WebSearch, WebFetch) and bring back what you found with its source. Anything the code can answer, keep reading the code for.
- Give your recommendation with each question, so the manager can just say yes.
- Push back on anything vague, contradictory or too big for one agent in one sitting, and suggest what to leave for later.
- Keep the brief current with mcp__brief__update_brief whenever something is agreed or a new question comes up. It's on the lounge's wall screen for both of you. One short line per entry, and drop open questions once they're answered.
- ${qaName(req)}, the project's QA officer, sits in: every pull request built from this issue comes to them to test. When you add or change acceptance criteria, they may add one short note (a criterion that can't be checked, a missing edge case, something the project's QA brief requires). You'll get it with the manager's next message: weigh it, recommend, and put what the manager agrees to into the acceptance criteria. The manager decides.
- When nothing important is still open, say you have enough and suggest wrapping up. The manager decides when.

Diagrams, for complex changes only (several modules, or a real choice of design; not every briefing):
- Think the architecture through from the code: where the responsibilities sit, which modules and classes talk to each other, and what the change would touch.
- Put diagrams on the wall screen with update_brief's diagrams list: one titled "Today" showing how the affected modules work now, then one per design option ("Option A: …", "Option B: …"). Four at most in all. Give each option's trade-off in the conversation, not in the diagram.
- Recommend an option and let the manager choose in the conversation. Once they have, replace the list with only the chosen design, titled "Chosen: …" (keeping "Today" is fine).
- Mermaid only, and only flowchart, classDiagram or sequenceDiagram. Keep them small and prefer top-down flowcharts (flowchart TD): the screen is narrow. Put every node and edge label in double quotes so they parse: A["Briefings"] -->|"calls"| B["Store"].
`.trim();
}

const qaName = (req: Pick<OfficerTurn, 'projectId'>) => qaOfficerFor(req.projectId).name;

const SPEAKERS: Record<BriefingMessage['from'], string> = { manager: 'Manager', officer: 'Operations officer', qa: 'QA officer', system: 'Note' };

/** The conversation as one speaker reads it: their own lines are "You". */
const transcript = (messages: BriefingMessage[], you: 'officer' | 'qa') =>
  messages.map((m) => `${m.from === you ? 'You' : SPEAKERS[m.from]}: ${m.text}`).join('\n\n');

/** What's been said since the speaker's last line (everything, if they haven't spoken yet). */
const since = (messages: BriefingMessage[], from: 'officer' | 'qa') => messages.slice(messages.map((m) => m.from).lastIndexOf(from) + 1);

export function briefingPrompt(req: Pick<OfficerTurn, 'kind' | 'idea' | 'brief' | 'messages' | 'resumeSessionId'>): string {
  // a lost session (or one that never started) gets the conversation back from the transcript
  const recap = req.resumeSessionId
    ? ''
    : `Here's the briefing so far:\n"""\n${transcript(req.messages, 'officer')}\n"""\n\nThe brief on the screen:\n${JSON.stringify(req.brief, null, 2)}\n\n`;
  if (req.kind === 'open') {
    return `The manager has called a briefing about:\n"""\n${req.idea}\n"""\n\nGet your bearings in the code, put a first draft of the brief on the screen with update_brief (including your open questions), then ask your first question.`;
  }
  if (req.kind === 'wrap-up') {
    return `${recap}The manager is wrapping up the briefing. Write the issue now, from the brief and everything you discussed.

${ISSUE_FORMAT}

If the manager chose a design option, add an "## Approach" section after What to build: the chosen option, why it beat the others, and its diagram in a fenced \`\`\`mermaid block (GitHub renders it). If no option was chosen, leave that section out.

Acceptance criteria include the QA officer's suggestions the manager agreed to, and only those. It's one issue, for one agent in one sitting: anything you agreed to leave for later goes under Out of scope. Context carries the why from the briefing. Finish with the structured result: repo, title and body.`;
  }
  const latest = [...req.messages].reverse().find((m) => m.from === 'manager')?.text ?? '';
  if (recap) return `${recap}The manager's latest message, for you to answer:\n"""\n${latest}\n"""`;
  const notes = since(req.messages, 'officer').filter((m) => m.from === 'qa');
  if (!notes.length) return latest;
  return `The QA officer, on your last change to the acceptance criteria:\n"""\n${notes.map((m) => m.text).join('\n\n')}\n"""\n\nThe manager, for you to answer:\n"""\n${latest}\n"""`;
}

export function briefingQaSystemPrompt(req: Pick<QaTurn, 'qa' | 'planner' | 'projectName' | 'repos' | 'qaBrief'>): string {
  const qaBrief = req.qaBrief
    ? `The project's QA brief, which you check every pull request against:\n"""\n${req.qaBrief}\n"""`
    : 'This project has no QA brief: check the criteria against the usual review.';
  return `
# You are ${req.qa.name}, QA officer for ${req.projectName} aboard the Focus, sitting in on a briefing in the observation lounge

The manager and ${req.planner.name}, the operations officer, are agreeing what to build. It becomes one GitHub issue that an agent builds, and the pull request comes to you to test against its acceptance criteria. You're here so those criteria can be tested before anyone builds anything. ${req.planner.name} leads the briefing and the manager decides; you're asked only when the acceptance criteria change.

${repoList(req.repos)}

${qaBrief}

When you're asked, pick the single most useful thing to say about the criteria, if there is one:
- a criterion that can't be checked as written, with a testable rewrite ("Works well on mobile" → "At 375px wide nothing scrolls sideways and every button can be tapped");
- a missing edge case (empty, too many, offline, signed out, slow);
- something the project's QA brief requires that the criteria don't cover.

One note at most, one or two sentences, said to the room. Don't repeat a point already made, and leave the scope and design to the others. If the criteria are fine, leave the note empty: saying nothing is the usual answer. You can read the code (Read, Glob, Grep) when you need to know what's testable; you can't change anything.
`.trim();
}

export function briefingQaPrompt(req: Pick<QaTurn, 'previous' | 'brief' | 'messages' | 'resumeSessionId'>): string {
  const heard = req.resumeSessionId ? since(req.messages, 'qa') : req.messages;
  const list = (lines: string[]) => (lines.length ? lines.map((l) => `- ${l}`).join('\n') : '(none)');
  return `${req.resumeSessionId ? 'Said since your last note' : 'The briefing so far'}:\n"""\n${transcript(heard, 'qa')}\n"""

The acceptance criteria just changed.

Before:
${list(req.previous)}

Now:
${list(req.brief.acceptance)}

Finish with the structured result: your one note, or an empty note if the criteria are fine.`;
}

export const qaNoteSchema = {
  type: 'object',
  properties: { note: { type: 'string', description: 'One or two sentences for the room, or empty when the criteria are fine' } },
  required: ['note'],
  additionalProperties: false,
} as const;

/** QA's structured result as a note: trimmed, kept short, missing when empty. */
export function asQaNote(out: unknown): string | undefined {
  const note = typeof out === 'object' && out && 'note' in out && typeof out.note === 'string' ? out.note.trim() : '';
  return note ? truncate(note, 400) : undefined;
}

type BriefPatch = Partial<Record<'summary' | 'why' | 'who', string> & Record<'scope' | 'out_of_scope' | 'acceptance' | 'open_questions', string[]> & { diagrams: BriefDiagram[] }>;

/** Applies an update_brief call: fields left out stay as they are; lists replace the whole list. */
export function mergeBrief(brief: Brief, patch: BriefPatch): Brief {
  const lines = (list: string[] | undefined, fallback: string[]) => (list ? list.map((l) => l.trim()).filter(Boolean).slice(0, 12) : fallback);
  return {
    summary: patch.summary?.trim() ?? brief.summary,
    why: patch.why?.trim() ?? brief.why,
    who: patch.who?.trim() ?? brief.who,
    scope: lines(patch.scope, brief.scope),
    outOfScope: lines(patch.out_of_scope, brief.outOfScope),
    acceptance: lines(patch.acceptance, brief.acceptance),
    openQuestions: lines(patch.open_questions, brief.openQuestions),
    diagrams: patch.diagrams
      ? patch.diagrams.map((d) => ({ title: d.title.trim(), mermaid: d.mermaid.trim() })).filter((d) => d.mermaid).slice(0, 4)
      : brief.diagrams,
  };
}
