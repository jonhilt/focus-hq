import { chiefEngineer, plannerFor, qaAtBriefing, qaOfficerFor } from '../../shared/crew';
import { optionLabel, optionText, recommendation, reportText } from '../../shared/engineering';
import { goalEpicBody, issueRef, stepBody, stepLine, stepPrGone, trackStep } from '../../shared/goals';
import { prKey } from '../../shared/qa';
import {
  type Brief,
  type BriefDiagram,
  type Breakdown,
  type BreakdownEdits,
  type Briefing,
  type BriefingMessage,
  type BriefingStatus,
  type Board,
  EMPTY_BRIEF,
  type EngineeringReport,
  type Goal,
  type GoalIssue,
  type GoalStep,
  type Issue,
  type Planner,
  type Settings,
  type StepProposal,
  type WrapUpShape,
} from '../../shared/types';
import { spokenLine } from '../../shared/voice';
import type { Hub } from '../hub';
import type { Store, StoredBriefing } from '../store';
import { errorMessage, newId, truncate } from '../util';
import { applyEdits, filedBody, SUB_ISSUES } from './breakdown';
import type { BriefingEngineer } from './engineering';
import { type DraftResult, draftSchema, type IssuePlanner, ISSUE_FORMAT, repoList } from './planner';

/** step - write a goal's next step; reconvene - hear how a goal's latest step went. */
export type TurnKind = 'open' | 'reply' | 'wrap-up' | 'break-down' | 'step' | 'reconvene';

export interface OfficerTurn {
  kind: TurnKind;
  projectId: string;
  projectName: string;
  planner: Planner;
  repos: string[];
  idea: string;
  brief: Brief;
  /** The engineer's latest options, if the manager has asked engineering. */
  engineering?: EngineeringReport;
  /** Everything said so far, the manager's latest message included. */
  messages: BriefingMessage[];
  /** The officer's session so far; missing on the first turn, or if it was lost. */
  resumeSessionId?: string;
  /** Set when the briefing is about a goal, worked toward one step at a time. */
  goal?: Goal;
  /** On reconvening: how the latest step went, its PR's description included. */
  report?: string;
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
  /** The same reply as a line to say aloud, from the same turn. */
  spoken?: string;
  sessionId?: string;
  costUsd?: number;
  /** A wrap-up's issue. */
  draft?: DraftResult;
  /** A break-down's epic and sub-issues. */
  breakdown?: Breakdown;
  /** A goal's next step. */
  step?: StepProposal;
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

/** Where briefings meet GitHub: filing a breakdown or a goal's steps (onto the project's board too), and reading back how a step went. */
export interface IssueFiler {
  file(projectId: string, repo: string, title: string, body: string): Promise<Issue>;
  addSubIssue(repo: string, parent: number, child: number): Promise<void>;
  pullRequestBody(repo: string, number: number): Promise<string>;
  pullRequestState(repo: string, number: number): Promise<'OPEN' | 'CLOSED' | 'MERGED'>;
}

const goalIssue = ({ repo, number, title, url }: Issue): GoalIssue => ({ repo, number, title, url });

const publicView = ({ sessionId: _, qaSessionId: __, engineerSessionId: ___, ...briefing }: StoredBriefing): Briefing => briefing;

/**
 * Briefings in the observation lounge: the manager and a project's operations officer talk a bigger or fuzzier idea
 * through, the officer keeping a brief on the wall screen, until the manager wraps up and the officer writes one issue
 * to the project's stand, or breaks it down into an epic and sub-issues that the manager reviews and files. The
 * project's QA officer sits in and adds a note when the acceptance criteria change, and the manager can send for the
 * ship's engineer to lay out options for how to build it, picking one as the Approach. One at a time. Each turn resumes
 * the speaker's session, so nothing runs while it's your turn and a briefing survives a restart.
 *
 * A briefing about a goal doesn't wrap up: once the manager files a step, it's parked out of the lounge (freeing it for
 * other briefings) while the crew builds the step, and the office keeps track of the step's PR. The manager reconvenes
 * it to hear how the step went and take the next one.
 */
export class Briefings {
  private running: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly planner: IssuePlanner,
    private readonly officer: BriefingOfficer,
    private readonly qa: BriefingQa,
    private readonly filer: IssueFiler,
    private readonly engineer: BriefingEngineer,
  ) {}

  current(): Briefing | null {
    return this.store.briefing ? publicView(this.store.briefing) : null;
  }

  /** Goals parked out of the lounge. */
  goals(): Briefing[] {
    return this.store.goals.map(publicView);
  }

  /**
   * Calls a briefing about `idea`: by default about a goal, worked toward one step at a time; with `goal` false, the
   * plan-it-up-front kind that ends in one issue or a breakdown.
   */
  call(projectId: string, idea: string, goal = true): Briefing {
    const project = this.store.project(projectId);
    const officer = plannerFor(projectId);
    if (!project.repos.length) throw new Error(`${project.name} has no repositories yet`);
    if (!idea.trim()) throw new Error(`Tell ${officer.name} what the ${goal ? 'goal' : 'briefing'} is about`);
    this.expectLoungeFree();
    const now = Date.now();
    const briefing: StoredBriefing = {
      id: newId('brief'),
      projectId,
      idea: idea.trim(),
      status: 'thinking',
      activity: 'Reading up on the project',
      messages: [{ from: 'manager', text: idea.trim(), at: now }],
      brief: { ...EMPTY_BRIEF },
      ...(goal && { goal: { steps: [] } }),
      startedAt: now,
      updatedAt: now,
      costUsd: 0,
    };
    this.store.setBriefing(briefing);
    this.broadcast();
    this.run(briefing, (signal, current) => this.converse(briefing, 'open', signal, current));
    return publicView(briefing);
  }

  say(text: string): Briefing {
    const briefing = this.expect('waiting', 'failed');
    if (!text.trim()) throw new Error('Say something first');
    briefing.messages.push({ from: 'manager', text: text.trim(), at: Date.now() });
    this.turn(briefing, 'thinking', 'Thinking it over');
    this.run(briefing, (signal, current) => this.converse(briefing, 'reply', signal, current));
    return publicView(briefing);
  }

  /**
   * The officer writes it up as one issue at the stand, or breaks it down for the manager to review (again, from a
   * breakdown). A goal never wraps up: the officer writes its next step instead, for the manager to edit and file.
   */
  wrapUp(shape: WrapUpShape): Briefing {
    const briefing = this.expect('waiting', 'failed', 'reviewing');
    if (!!briefing.goal !== (shape === 'step')) throw new Error(briefing.goal ? 'A goal goes one step at a time: take a step' : 'Only a goal goes one step at a time');
    if (briefing.goal) {
      const next = briefing.goal.steps.length ? 'the next step' : 'the first step';
      briefing.goal.proposal = undefined;
      briefing.messages.push({ from: 'system', text: `The captain asked for ${next}.`, at: Date.now() });
      this.turn(briefing, 'wrapping-up', `Writing up ${next}`);
      this.run(briefing, (signal, current) => this.converse(briefing, 'step', signal, current));
      return publicView(briefing);
    }
    if (briefing.breakdown && [briefing.breakdown.epic, ...briefing.breakdown.subIssues].some((i) => i.number !== undefined)) {
      throw new Error('Some of the breakdown is filed already: file the rest');
    }
    const one = shape === 'one';
    briefing.breakdown = undefined;
    briefing.messages.push({ from: 'system', text: one ? 'The captain wrapped up the briefing as one issue.' : 'The captain asked for an epic broken down into sub-issues.', at: Date.now() });
    this.turn(briefing, 'wrapping-up', one ? 'Writing up the issue' : 'Breaking it down');
    this.run(briefing, (signal, current) => this.converse(briefing, one ? 'wrap-up' : 'break-down', signal, current));
    return publicView(briefing);
  }

  /** Files the breakdown, with the manager's edits: the epic first, then each sub-issue, linked to it. */
  file(edits: BreakdownEdits): Briefing {
    const briefing = this.expect('reviewing');
    if (!briefing.breakdown) throw new Error('There’s no breakdown to file');
    briefing.breakdown = applyEdits(briefing.breakdown, edits);
    this.turn(briefing, 'filing', 'Filing the epic');
    void this.fileAll(briefing, briefing.breakdown);
    return publicView(briefing);
  }

  /**
   * Files the goal's proposed step, with the manager's edits: the goal's epic first if this is its first step, then the
   * step, linked to it. Then the goal is parked while the crew builds it.
   */
  fileStep(edit: { title: string; body: string }): Briefing {
    const briefing = this.expect('waiting', 'failed');
    const proposal = briefing.goal?.proposal;
    if (!briefing.goal || !proposal) throw new Error('There’s no step to file: take a step first');
    const step = { ...proposal, title: edit.title.trim(), body: edit.body.trim() };
    if (!step.title || !step.body) throw new Error('The step needs a title and a description');
    briefing.goal.proposal = step;
    this.turn(briefing, 'filing', briefing.goal.epic ? 'Filing the step' : 'Filing the goal');
    void this.fileGoalStep(briefing, briefing.goal, step);
    return publicView(briefing);
  }

  /** Parks the goal in session out of the lounge without taking a step, so the lounge is free for other briefings. */
  park(): void {
    const briefing = this.expect('waiting', 'failed');
    if (!briefing.goal) throw new Error('Only a goal can be parked: wrap the briefing up or end it');
    briefing.messages.push({ from: 'system', text: 'The captain parked the goal.', at: Date.now() });
    this.parkGoal(briefing);
  }

  /** Brings a parked goal back to the lounge: the officer catches up on its latest step and says what it taught you. */
  reconvene(id: string): Briefing {
    const goal = this.store.goals.find((g) => g.id === id);
    if (!goal?.goal) throw new Error('That goal isn’t parked any more');
    this.expectLoungeFree();
    const latest = goal.goal.steps.at(-1);
    this.store.goals = this.store.goals.filter((g) => g !== goal);
    goal.messages.push({ from: 'system', text: latest ? `The captain reconvened. ${stepLine(latest, goal.goal.steps.length - 1)}.` : 'The captain reconvened.', at: Date.now() });
    this.store.setBriefing(goal);
    this.turn(goal, 'thinking', latest ? 'Catching up on the step' : 'Picking up where we left off');
    this.run(goal, async (signal, current) => {
      const report = latest ? await this.stepReport(latest, goal.goal!.steps) : 'No step has been filed yet.';
      if (current()) await this.converse(goal, 'reconvene', signal, current, report);
    });
    return publicView(goal);
  }

  /** Forgets a parked goal. Its issues stay on GitHub. */
  dropGoal(id: string): void {
    this.store.goals = this.store.goals.filter((g) => g.id !== id);
    this.store.save();
    this.broadcast();
  }

  /**
   * Keeps track of the steps of the project's goals as its board refreshes: each step's PR once it's opened, QA's verdict
   * on it, and whether it was merged or closed once it leaves the board.
   */
  async track(projectId: string, board: Board): Promise<void> {
    const goals = [...this.store.goals, ...(this.store.briefing ? [this.store.briefing] : [])].filter((b) => b.projectId === projectId && b.goal);
    let changed = false;
    for (const briefing of goals) {
      const steps = briefing.goal!.steps;
      for (const [i, step] of steps.entries()) {
        if (step.outcome || board.error?.includes(step.repo)) continue;
        let next = trackStep(step, board.prs, (pr) => this.store.reviews.get(prKey(step.repo, pr)));
        if (stepPrGone(next, board.prs)) {
          const state = await this.filer.pullRequestState(next.repo, next.pr!.number).catch(() => 'OPEN' as const);
          if (state !== 'OPEN') next = { ...next, outcome: state === 'MERGED' ? 'merged' : 'closed' };
        }
        if (next === step) continue;
        steps[i] = next;
        changed = true;
        if (next.outcome && i === steps.length - 1 && briefing.status === 'parked') {
          const goal = truncate(briefing.brief.summary || briefing.idea, 60);
          const officer = plannerFor(projectId).name;
          this.hub.toast(next.outcome === 'merged' ? 'success' : 'info', `🧭 Step ${i + 1} toward “${goal}” ${next.outcome === 'merged' ? 'merged' : 'was closed unmerged'}: reconvene with ${officer} in the observation lounge`);
        }
      }
    }
    if (!changed) return;
    this.store.save();
    this.broadcast();
  }

  /** Sends for the ship's engineer, who reads the code and comes back with options; `request` sends their last ones back for changes. */
  askEngineering(request: string): Briefing {
    const briefing = this.expect('waiting', 'failed');
    const ask = request.trim();
    const what = briefing.engineering ? 'another look at the options' : 'options on how to build it';
    briefing.messages.push({ from: 'system', text: `The captain asked ${chiefEngineer().name} for ${what}${ask ? `: “${ask}”` : '.'}`, at: Date.now() });
    this.turn(briefing, 'engineering', 'On the way to the lounge');
    this.run(briefing, (signal, current) => this.engineering(briefing, ask, signal, current));
    return publicView(briefing);
  }

  /** The manager picks one of the engineer's options: it goes into the brief as the Approach, and from there into the issue. */
  pickApproach(index: number): Briefing {
    const briefing = this.expect('waiting', 'failed');
    const option = briefing.engineering?.options[index];
    if (!option) throw new Error(briefing.engineering ? 'There’s no such option' : 'Ask engineering for options first');
    briefing.brief = { ...briefing.brief, approach: option };
    briefing.messages.push({ from: 'system', text: `The captain picked ${optionLabel(index)}, ${option.title}, as the approach.`, at: Date.now() });
    briefing.updatedAt = Date.now();
    this.store.save();
    this.broadcast();
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
    if (!this.store.goals.some((g) => g.projectId === projectId)) return;
    this.store.goals = this.store.goals.filter((g) => g.projectId !== projectId);
    this.store.save();
    this.broadcast();
  }

  /** Throws unless the lounge is free for another briefing: nobody's in it, or the briefing in it is over. */
  private expectLoungeFree(): void {
    const existing = this.store.briefing;
    if (!existing || existing.status === 'done') return;
    const name = this.store.projects.find((p) => p.id === existing.projectId)?.name ?? 'another project';
    const what = existing.goal ? 'a goal' : 'a briefing';
    throw new Error(`${plannerFor(existing.projectId).name} is still in the lounge with ${what} about ${name}. ${existing.goal ? 'Park it' : 'Wrap it up'} or end it first.`);
  }

  /** The briefing, if it's in one of `statuses`; otherwise why the manager has to wait (or can't). */
  private expect(...statuses: BriefingStatus[]): StoredBriefing {
    const briefing = this.store.briefing;
    if (!briefing) throw new Error('There’s no briefing in session');
    if (statuses.includes(briefing.status)) return briefing;
    switch (briefing.status) {
      case 'thinking':
      case 'wrapping-up':
        throw new Error(`${plannerFor(briefing.projectId).name} is still thinking`);
      case 'qa-checking':
        throw new Error(`${qaOfficerFor(briefing.projectId).name} is still reading the acceptance criteria`);
      case 'engineering':
        throw new Error(`${chiefEngineer().name} is still working on the options`);
      case 'reviewing':
        throw new Error('The breakdown is waiting for you: file it, or wrap up as one issue instead');
      case 'filing':
        throw new Error(briefing.goal ? 'Still filing the step' : 'Still filing the breakdown');
      case 'done':
        throw new Error(`This briefing is over: ${briefing.breakdown ? 'its issues are filed' : 'its issue is at the stand'}. End it to start another.`);
      case 'parked':
        throw new Error('That goal is parked: reconvene it first');
      case 'waiting':
      case 'failed':
        throw new Error('It’s your turn: say something first');
    }
  }

  private turn(briefing: StoredBriefing, status: Briefing['status'], activity: string): void {
    Object.assign(briefing, { status, activity, error: undefined, updatedAt: Date.now() });
    this.store.save();
    this.broadcast();
  }

  /** Runs a turn of the briefing in the background; `current` turns false once it's been superseded or ended. */
  private run(briefing: StoredBriefing, work: (signal: AbortSignal, current: () => boolean) => Promise<void>): void {
    const abort = new AbortController();
    this.running?.abort();
    this.running = abort;
    const current = () => this.store.briefing === briefing && this.running === abort;
    void work(abort.signal, current)
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
  private async converse(briefing: StoredBriefing, kind: TurnKind, signal: AbortSignal, current: () => boolean, report?: string): Promise<void> {
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
        engineering: briefing.engineering,
        messages: [...briefing.messages],
        resumeSessionId: briefing.sessionId,
        goal: briefing.goal,
        report,
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
    if (kind === 'step') {
      if (!reply.step) throw new Error('The officer finished without writing the step');
      const goal = briefing.goal!;
      goal.proposal = reply.step;
      briefing.messages.push({
        from: 'officer',
        text: `Here’s the ${goal.steps.length ? 'next' : 'first'} step I’d take: “${reply.step.title}”, in ${reply.step.repo}. Edit it and file it, or tell me what to change.`,
        at: now,
      });
      Object.assign(briefing, { status: 'waiting', activity: 'Waiting for you to file the step', updatedAt: now });
      this.store.save();
      this.broadcast();
      return;
    }
    if (kind === 'break-down') {
      if (!reply.breakdown) throw new Error('The officer finished without breaking it down');
      briefing.breakdown = reply.breakdown;
      briefing.messages.push({
        from: 'officer',
        text: `I’ve broken it down into an epic and ${reply.breakdown.subIssues.length} sub-issues for ${reply.breakdown.repo}. Edit what you like, drop what we don’t need, then file them all. Nothing goes to GitHub until you do.`,
        at: now,
      });
      Object.assign(briefing, { status: 'reviewing', activity: 'Waiting for you to file the breakdown', updatedAt: now });
      this.store.save();
      this.broadcast();
      return;
    }
    const text = reply.text.trim() || '…';
    briefing.messages.push({ from: 'officer', text, spoken: spokenLine(reply.spoken, text), at: now });
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

  /** The engineer's options, which clear any earlier pick. An engineering hiccup is a note in the log; the briefing carries on. */
  private async engineering(briefing: StoredBriefing, request: string, signal: AbortSignal, current: () => boolean): Promise<void> {
    const project = this.store.project(briefing.projectId);
    const engineer = chiefEngineer();
    try {
      const reply = await this.engineer.propose(
        {
          projectId: project.id,
          projectName: project.name,
          engineer,
          planner: plannerFor(project.id),
          repos: [...project.repos],
          idea: briefing.idea,
          brief: briefing.brief,
          messages: [...briefing.messages],
          request,
          previous: briefing.engineering,
          resumeSessionId: briefing.engineerSessionId,
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
      briefing.engineerSessionId = reply.sessionId ?? briefing.engineerSessionId;
      briefing.costUsd += reply.costUsd ?? 0;
      briefing.engineering = reply.report;
      const { approach: _, ...brief } = briefing.brief;
      briefing.brief = brief;
      briefing.messages.push({ from: 'engineer', text: recommendation(reply.report), at: Date.now() });
    } catch (err) {
      if (!current()) return;
      briefing.messages.push({ from: 'system', text: `${engineer.name} couldn’t finish the options: ${errorMessage(err)}`, at: Date.now() });
    }
    Object.assign(briefing, { status: 'waiting', activity: 'Waiting for you', updatedAt: Date.now() });
    this.store.save();
    this.broadcast();
  }

  /**
   * Files what isn't filed yet, saving each number as it goes. On a failure the briefing goes back to reviewing, so
   * filing again carries on where this stopped. A sub-issue that won't link to the epic is filed all the same, with a
   * note in the log.
   */
  private async fileAll(briefing: StoredBriefing, breakdown: Breakdown): Promise<void> {
    const project = this.store.project(briefing.projectId);
    const { repo, epic } = breakdown;
    const progress = (activity: string) => {
      Object.assign(briefing, { activity, updatedAt: Date.now() });
      this.store.save();
      this.broadcast();
    };
    const unlinked: string[] = [];
    try {
      const epicNumber = (epic.number ??= (await this.filer.file(project.id, repo, epic.title, epic.body)).number);
      const numbers = new Map<string, number>();
      for (const sub of breakdown.subIssues) {
        if (sub.number === undefined) {
          progress(`Filing “${truncate(sub.title, 60)}”`);
          const issue = await this.filer.file(project.id, repo, sub.title, filedBody(sub, numbers));
          sub.number = issue.number;
          progress(`Linking #${issue.number} to the epic`);
          await this.filer.addSubIssue(repo, epicNumber, issue.number).catch((err) => unlinked.push(`#${issue.number} (${errorMessage(err)})`));
        }
        numbers.set(sub.key, sub.number);
      }
    } catch (err) {
      Object.assign(briefing, { status: 'reviewing', activity: 'Waiting for you to file the breakdown', error: `Couldn’t file everything: ${errorMessage(err)}. File all again to carry on.`, updatedAt: Date.now() });
      this.store.save();
      this.broadcast();
      return;
    }
    const now = Date.now();
    const subs = breakdown.subIssues.map((s) => `#${s.number}`).join(', ');
    if (unlinked.length) briefing.messages.push({ from: 'system', text: `Couldn’t link ${unlinked.join(', ')} to the epic as a sub-issue.`, at: now });
    briefing.messages.push({ from: 'officer', text: `Filed in ${repo}: the epic, #${epic.number} “${epic.title}”, with sub-issues ${subs}. They’re on ${project.name}’s board.`, at: now });
    Object.assign(briefing, { status: 'done', activity: 'Breakdown filed', updatedAt: now });
    this.hub.toast('success', `🧩 Filed ${repo}#${epic.number} with ${breakdown.subIssues.length} sub-issues`);
    this.store.save();
    this.broadcast();
  }

  /**
   * Files the goal's epic (once: its number is saved before the step is filed) and the step, then parks the goal. On a
   * failure the step waits to be filed again.
   */
  private async fileGoalStep(briefing: StoredBriefing, goal: Goal, proposal: StepProposal): Promise<void> {
    const project = this.store.project(briefing.projectId);
    let epic: GoalIssue;
    let step: GoalStep;
    let linked = '';
    try {
      epic = (goal.epic ??= goalIssue(await this.filer.file(project.id, proposal.repo, truncate(briefing.brief.summary || briefing.idea, 70), goalEpicBody(briefing.brief, briefing.idea))));
      this.store.save();
      Object.assign(briefing, { activity: `Filing “${truncate(proposal.title, 60)}”`, updatedAt: Date.now() });
      this.broadcast();
      const position = goal.steps.length + 1;
      step = { ...goalIssue(await this.filer.file(project.id, proposal.repo, proposal.title, stepBody(proposal.body, epic, proposal.repo, position))), filedAt: Date.now() };
      goal.steps.push(step);
      goal.proposal = undefined;
      this.store.save();
      // GitHub only links sub-issues within a repo; elsewhere the step's body links back to the goal
      if (epic.repo === step.repo) {
        await this.filer.addSubIssue(step.repo, epic.number, step.number).catch((err) => (linked = `Couldn’t link #${step.number} to the goal as a sub-issue: ${errorMessage(err)}`));
      }
    } catch (err) {
      if (this.store.briefing !== briefing) return;
      Object.assign(briefing, { status: 'failed', activity: 'Waiting for you to file the step', error: `Couldn’t file the step: ${errorMessage(err)}. File it again to carry on.`, updatedAt: Date.now() });
      this.store.save();
      this.broadcast();
      return;
    }
    // ended while filing: what's filed stays on GitHub, but the goal is gone
    if (this.store.briefing !== briefing) return;
    const now = Date.now();
    const n = goal.steps.length;
    if (linked) briefing.messages.push({ from: 'system', text: linked, at: now });
    briefing.messages.push({
      from: 'officer',
      text: `Filed ${issueRef(step)}, step ${n} toward ${issueRef(epic)}. It’s on ${project.name}’s board. I’ll park the goal while the crew builds it: reconvene me once its PR has landed, or sooner if you want to rethink.`,
      at: now,
    });
    this.hub.toast('success', `🧭 Filed step ${n} toward “${truncate(epic.title, 60)}”: ${issueRef(step)}`);
    this.parkGoal(briefing);
  }

  /** Moves the goal out of the lounge, into the parked goals. */
  private parkGoal(briefing: StoredBriefing): void {
    const n = briefing.goal?.steps.length ?? 0;
    const activity = n ? `Step ${n} underway` : 'Parked before the first step';
    Object.assign(briefing, { status: 'parked', activity, error: undefined, updatedAt: Date.now() });
    this.store.goals = [...this.store.goals.filter((g) => g.id !== briefing.id), briefing];
    this.store.setBriefing(null);
    this.broadcast();
  }

  /** How the latest step went, for the officer: every step's line, and the latest PR's description if there's one. */
  private async stepReport(latest: GoalStep, steps: GoalStep[]): Promise<string> {
    const body = latest.pr ? await this.filer.pullRequestBody(latest.repo, latest.pr.number).catch(() => '') : '';
    return [
      `Steps so far:\n${steps.map(stepLine).join('\n')}`,
      body.trim() ? `The latest step's pull request, as its developer described it:\n"""\n${truncate(body.trim(), 6000)}\n"""` : '',
    ].filter(Boolean).join('\n\n');
  }

  private broadcast(): void {
    this.hub.send({ type: 'briefing', briefing: this.current(), goals: this.goals() });
  }
}

// ---------------------------------------------------------------- prompts

/** How the officer finishes a reply in the briefing log, with a line for voice mode to say aloud. */
const REPLY_FORMAT =
  "Finish every reply with the structured result: `reply`, what you'd write (it goes in the briefing log, file names and all), and `spoken`, the same reply said aloud to the manager in one or two short conversational sentences: the point and the question, with no file paths, code or symbols.";

export function briefingSystemPrompt(req: Pick<OfficerTurn, 'planner' | 'projectId' | 'projectName' | 'repos' | 'goal'>): string {
  if (req.goal) return goalSystemPrompt(req);
  return `
# You are ${req.planner.name}, operations officer for ${req.projectName} aboard the Focus, in a briefing in the observation lounge

The manager has called a briefing about something bigger or fuzzier than a one-line issue. Your job: question them until you both agree on what to build and why. When they wrap up, you write it up as one GitHub issue, or, if they ask, as an epic broken down into sub-issues. Claude Code agents build each issue on their own, with nobody to ask, and a reviewer checks each pull request against it.

${repoList(req.repos)}

How to run the briefing:
- Ask one question per reply (two only when they're tightly linked). Keep replies short: a line on what you found or understood, then the question. No headings, no essays.
- Why first: the problem, who has it, and what success looks like. Then the what: the behaviour, the edge cases, what's out. The how where it constrains the work, or where the change is complex enough to need designing (below).
- Look before you ask. Never ask what the code can tell you: read it (Read, Glob, Grep; you can't change anything) and bring what you found ("Orders already carry a status in shop-api/src/orders.ts. Should 'saved for later' be a status, or its own list?").
- When the question goes beyond the code (library versions, migration guidance, external APIs, docs), search and read the web (WebSearch, WebFetch) and bring back what you found with its source. Anything the code can answer, keep reading the code for.
- Give your recommendation with each question, so the manager can just say yes.
- Push back on anything vague or contradictory. If it's too big for one agent in one sitting, say so: suggest what to leave for later, or breaking it down into sub-issues when it wraps up.
- Keep the brief current with mcp__brief__update_brief whenever something is agreed or a new question comes up. It's on the lounge's wall screen for both of you. One short line per entry, and drop open questions once they're answered.
- ${qaName(req)}, the project's QA officer, sits in: every pull request built from this issue comes to them to test. When you add or change acceptance criteria, they may add one short note (a criterion that can't be checked, a missing edge case, something the project's QA brief requires). You'll get it with the manager's next message: weigh it, recommend, and put what the manager agrees to into the acceptance criteria. The manager decides.
- ${chiefEngineer().name}, the ship's engineer, can be called in by the manager to read the code and lay out two or three options for how to build it. When the how is a real choice across several modules, suggest asking engineering. Once the manager picks an option it's the brief's Approach: build on it, don't reopen it.
- When nothing important is still open, say you have enough and suggest wrapping up. The manager decides when.
- ${REPLY_FORMAT}

Diagrams, for complex changes only (several modules, or a real choice of design; not every briefing):
- Think the architecture through from the code: where the responsibilities sit, which modules and classes talk to each other, and what the change would touch.
- Put diagrams on the wall screen with update_brief's diagrams list: one titled "Today" showing how the affected modules work now, then one per design option ("Option A: …", "Option B: …"). Four at most in all. Give each option's trade-off in the conversation, not in the diagram.
- Recommend an option and let the manager choose in the conversation. Once they have, replace the list with only the chosen design, titled "Chosen: …" (keeping "Today" is fine).
- Mermaid only, and only flowchart, classDiagram or sequenceDiagram. Keep them small and prefer top-down flowcharts (flowchart TD): the screen is narrow. Put every node and edge label in double quotes so they parse: A["Briefings"] -->|"calls"| B["Store"].
`.trim();
}

/** For a goal: agree where we're going, not the route, and find the way one small step at a time. */
function goalSystemPrompt(req: Pick<OfficerTurn, 'planner' | 'projectId' | 'projectName' | 'repos'>): string {
  return `
# You are ${req.planner.name}, operations officer for ${req.projectName} aboard the Focus, in a briefing about a goal in the observation lounge

The manager has a goal, not a spec. Nobody knows the whole route yet, and that's fine: you'll get there one small step at a time. Each step is a GitHub issue that a Claude Code agent builds on their own, with nobody to ask, and the QA officer tests. After a step lands, the manager reconvenes you to hear what it taught you, and you pick the next step together. Your job is to agree where you're going and find the way as you go, not to plan the route up front.

${repoList(req.repos)}

How to run it:
- Agree the destination: what the manager wants and why, who it's for, and what you'd see once it's done (observable outcomes, not features). That takes a handful of questions, not a requirements session. Stop once you have it.
- Name the unknowns: the assumptions that could sink the goal or change the route (does the data exist, will the API allow it, do people want it, will it be fast enough). The steps are there to find these out.
- Don't design the solution, list tasks or map the route. No scope lists, no architecture, no breakdown. Where the how matters, a step finds it out.
- Ask one question per reply. Keep replies short: a line on what you found, then the question with your recommendation, so the manager can just say yes.
- Look before you ask. Never ask what the code can tell you: read it (Read, Glob, Grep; you can't change anything). For what the code can't tell you, search and read the web (WebSearch, WebFetch) and say where you found it.
- Keep the brief on the wall screen current with mcp__brief__update_brief: summary (the goal, in a line), why, who, acceptance (what you'd see once it's done) and open_questions (the unknowns, riskiest first). Leave scope, out_of_scope and diagrams empty.
- ${qaName(req)}, the project's QA officer, sits in: they test every step, and they'll check the goal is met at the end. When you change the done-when outcomes, they may add a note on making them checkable. Weigh it, and put what the manager agrees to into them.
- Once you know the destination and the riskiest unknown, suggest taking the first step. The manager decides when.
- ${REPLY_FORMAT}

Choosing a step, now and every time you reconvene:
- The smallest change an agent can build in one sitting and a reviewer can merge on its own, that either tests the riskiest unknown or gets a thin slice of the goal working end to end.
- Never plan past the next step: you'll know more once it lands.
- On reconvening, read what landed (your checkout is up to date) and how it went. Say what the step taught you, update the unknowns on the wall screen (and the done-when outcomes, if the goal itself has moved), then suggest the next step in a sentence or two, or say you think the goal is met and why.
`.trim();
}

/** How the officer writes a goal's step. The office puts a line linking it to the goal on top. */
export const STEP_FORMAT = `The step, as a GitHub issue:
- title: imperative and specific, under 70 characters.
- body, in Markdown, with these sections:
  - \`## Testing\`: the unknown this step tests, or the slice of the goal it gets working, in a sentence or two.
  - \`## Why now\`: why this comes next, from what you know so far (and what earlier steps taught you).
  - \`## What to build\`: the change, concretely, naming the files involved. Small: one agent, one sitting, one pull request.
  - \`## Done when\`: a checklist (\`- [ ]\`) of observable, testable outcomes for this step only.
  - \`## Not in this step\`: what an agent might be tempted to do that belongs to a later step (skip it if nothing needs saying).`;

/** JSON schema for a goal's step: an issue like any other, in the step's format. */
export function stepSchema(repos: string[]): Record<string, unknown> {
  const schema = draftSchema(repos);
  return {
    ...schema,
    properties: {
      ...(schema.properties as Record<string, unknown>),
      body: { type: 'string', description: 'The step in Markdown: Testing, Why now, What to build, Done when, Not in this step.' },
    },
  };
}

const qaName = (req: Pick<OfficerTurn, 'projectId'>) => qaOfficerFor(req.projectId).name;

const SPEAKERS: Record<BriefingMessage['from'], string> = { manager: 'Manager', officer: 'Operations officer', qa: 'QA officer', engineer: 'Engineer', system: 'Note' };

type Speaker = 'officer' | 'qa' | 'engineer';

/** The conversation as one speaker reads it: their own lines are "You". */
export const transcript = (messages: BriefingMessage[], you: Speaker) =>
  messages.map((m) => `${m.from === you ? 'You' : SPEAKERS[m.from]}: ${m.text}`).join('\n\n');

/** What's been said since the speaker's last line (everything, if they haven't spoken yet). */
export const since = (messages: BriefingMessage[], from: Speaker) => messages.slice(messages.map((m) => m.from).lastIndexOf(from) + 1);

/** Where engineering stands, for the officer: the approach the manager picked, else the options waiting for a pick. */
function engineeringNote(req: Pick<OfficerTurn, 'brief' | 'engineering'>): string {
  if (req.brief.approach) return `The approach the manager picked from engineering's options (settled: build on it, don't reopen it):\n"""\n${optionText(req.brief.approach)}\n"""`;
  if (req.engineering) return `Engineering's options, waiting for the manager to pick one:\n"""\n${reportText(req.engineering)}\n"""`;
  return '';
}

export function briefingPrompt(req: Pick<OfficerTurn, 'kind' | 'idea' | 'brief' | 'engineering' | 'messages' | 'resumeSessionId' | 'goal' | 'report'>): string {
  const { approach: _, ...brief } = req.brief;
  const engineering = engineeringNote(req);
  // a lost session (or one that never started) gets the conversation back from the transcript
  const recap = req.resumeSessionId
    ? ''
    : `Here's the briefing so far:\n"""\n${transcript(req.messages, 'officer')}\n"""\n\nThe brief on the screen:\n${JSON.stringify(brief, null, 2)}\n\n${engineering ? `${engineering}\n\n` : ''}`;
  if (req.kind === 'open' && req.goal) {
    return `The manager has a goal:\n"""\n${req.idea}\n"""\n\nGet your bearings in the code, put a first draft of the brief on the screen with update_brief (the goal, and any unknowns you can already see), then ask your first question.`;
  }
  if (req.kind === 'step') {
    const steps = req.goal?.steps ?? [];
    const sofar = steps.length ? `Steps so far:\n${steps.map(stepLine).join('\n')}\n\n` : '';
    return `${recap}${sofar}The manager wants to take the ${steps.length ? 'next' : 'first'} step toward the goal. Write it now, from the brief and what you've discussed${steps.length ? ' since the last step' : ''}: one step, not a plan.

${STEP_FORMAT}

Pick the repository the step's work belongs in. Finish with the structured result: repo, title and body.`;
  }
  if (req.kind === 'reconvene') {
    return `${recap}The manager has reconvened the briefing to hear how the latest step went.

${req.report ?? ''}

Your checkout is up to date with what has landed: read it where it helps. If the step hasn't landed yet, say where it stands and ask what's on the manager's mind. Otherwise say what it taught you, update the unknowns on the wall screen (and the done-when outcomes, if the goal has moved), then suggest the next step in a sentence or two, or say you think the goal is met and why. Keep it short.`;
  }
  if (req.kind === 'open') {
    return `The manager has called a briefing about:\n"""\n${req.idea}\n"""\n\nGet your bearings in the code, put a first draft of the brief on the screen with update_brief (including your open questions), then ask your first question.`;
  }
  // the officer's session doesn't hear the pick (it's made while it's the manager's turn), so it comes with the wrap-up
  const picked = !recap && req.brief.approach ? `${engineering}\n\n` : '';
  if (req.kind === 'wrap-up') {
    return `${recap}${picked}The manager is wrapping up the briefing. Write the issue now, from the brief and everything you discussed.

${ISSUE_FORMAT}

If the manager picked an approach (from engineering's options, or a design option chosen in the conversation), end Context with an "### Approach" subsection: the approach, the files and modules it touches, why it beat the others, its trade-offs and risks, and its diagram, if there is one, in a fenced \`\`\`mermaid block (GitHub renders it). If its size is several issues, say this issue is the first slice and put the rest under Out of scope. If no option was chosen, leave that section out.

Acceptance criteria include the QA officer's suggestions the manager agreed to, and only those. It's one issue, for one agent in one sitting: anything you agreed to leave for later goes under Out of scope. Context carries the why from the briefing. Finish with the structured result: repo, title and body.`;
  }
  if (req.kind === 'break-down') {
    return `${recap}${picked}The manager is wrapping up the briefing and wants it broken down: an epic, and ${SUB_ISSUES.min} to ${SUB_ISSUES.max} sub-issues that agents build one each, each in one sitting. Write them now, from the brief and everything you discussed.

The epic is the brief. Title it after the feature. Its body has \`## Why\` (the problem, who has it, what success looks like), \`## Scope\`, \`## Acceptance criteria\` for the feature as a whole (a \`- [ ]\` checklist) and \`## Out of scope\`. If the manager picked an approach (from engineering's options, or a design option chosen in the conversation), add an \`## Approach\` section: the approach, the files and modules it touches, why it beat the others, its trade-offs and risks, and its diagram, if there is one, in a fenced \`\`\`mermaid block. Each sub-issue's Context says which part of that approach it builds.

How to split it, the same as at the stand: one sub-issue per whole piece of the feature, one that an agent builds and a reviewer checks on its own. Split only where the parts are independent and touch different files, or where a risky foundation should land first. Fewer, whole sub-issues beat many thin ones.

Each sub-issue is written like any other issue.

${ISSUE_FORMAT}

Dependencies: a sub-issue's depends_on lists the positions (1-based) of earlier sub-issues that have to merge before it can start. Fill it only where the work truly can't start before the other merges, and leave it empty otherwise, so agents can work side by side. Never more than two steps deep (3 waits for 2, which waits for 1). Don't write "Depends on" lines into the bodies: the office adds them with the real issue numbers when it files them.

Acceptance criteria include the QA officer's suggestions the manager agreed to, and only those. The epic and its sub-issues all go in one repository: the one with most of the work. Finish with the structured result: repo, epic and sub_issues.`;
  }
  const latest = [...req.messages].reverse().find((m) => m.from === 'manager')?.text ?? '';
  if (recap) return `${recap}The manager's latest message, for you to answer:\n"""\n${latest}\n"""`;
  const heard = since(req.messages, 'officer');
  const notes = heard.filter((m) => m.from === 'qa');
  const room = heard.filter((m) => m.from === 'engineer' || m.from === 'system');
  const parts = [
    notes.length ? `The QA officer, on your last change to the acceptance criteria:\n"""\n${notes.map((m) => m.text).join('\n\n')}\n"""` : '',
    room.length ? `Since your last reply:\n"""\n${transcript(room, 'officer')}\n"""${engineering ? `\n\n${engineering}` : ''}` : '',
  ].filter(Boolean);
  if (!parts.length) return latest;
  return `${parts.join('\n\n')}\n\nThe manager, for you to answer:\n"""\n${latest}\n"""`;
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

export const officerReplySchema = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your reply for the briefing log: what you found or understood, then your question and recommendation' },
    spoken: { type: 'string', description: 'The same reply said aloud: one or two short conversational sentences, no file paths, code or symbols' },
  },
  required: ['reply', 'spoken'],
  additionalProperties: false,
} as const;

/** The officer's structured reply; the session's final text stands in if the structure is missing. */
export function asOfficerReply(out: unknown, fallback: string): Pick<OfficerReply, 'text' | 'spoken'> {
  const field = (key: 'reply' | 'spoken') => {
    const value = typeof out === 'object' && out ? (out as Record<string, unknown>)[key] : undefined;
    return typeof value === 'string' ? value.trim() : '';
  };
  return { text: field('reply') || fallback, spoken: field('spoken') || undefined };
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
    // only the manager's pick sets the approach
    ...(brief.approach && { approach: brief.approach }),
  };
}
