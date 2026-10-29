// The chief of staff's direct line (README.md#the-direct-line): the user talks something over with it, tied to no
// goal, and when the conversation calls for work it tells an open goal's lead or starts a new goal itself, and says so.
// One conversation, a turn at a time, each resuming the same Claude Code session, so it carries on after a restart.
import { z } from 'zod';
import type { Agent, ChatProject, PluginGoals, PluginState, Project, SessionTool, Settings, ShipStatus } from '../../plugin-api/server';
import { errorMessage, truncate } from '../../plugin-api/server';
import { shownProjects } from '../../plugin-api/shared';
import { CREW } from './crew';
import { ackStep, closeStep, lineAfterRestart, sayStep, startStep, tellStep } from './lineRules';
import { type CosLine, type CosLive, type CosState, freshLine, type LineMessage, type LineStart, readOf, SENDER } from './shared';
import { doing } from './streamList';
import { headlineOf } from './askRules';

/** Where a goal it starts came from, for the goal's record and its lead. */
export const LINE_FROM = 'the chief of staff’s direct line';

/** One turn on the line: what it's told, and the tools it may use (`start_goal`, `tell_goal`). */
export interface LineTurn {
  system: string;
  prompt: string;
  /** Its session so far; missing on the first turn of a conversation. */
  resumeSessionId?: string;
  projects: ChatProject[];
  shipStatus: () => Promise<ShipStatus>;
  tools: SessionTool[];
  settings: Settings;
  signal: AbortSignal;
}

export interface LineReply {
  text: string;
  sessionId?: string;
  costUsd?: number;
}

/** Takes one turn on the line. The live one resumes a Claude Code session (claudeLine.ts); the demo's is scripted. */
export interface LineOfficer {
  turn(req: LineTurn, activity: (text: string) => void): Promise<LineReply>;
}

/** What the line needs of Focus: its projects and goals, starting, telling and closing goals, and its own state. */
export interface LineHost {
  projects(): Readonly<Project>[];
  /** Whether the chief of staff is switched on for the project: only those are on the line. */
  on(projectId: string): boolean;
  agents(): readonly Readonly<Agent>[];
  settings(): Readonly<Settings>;
  shipStatus(): Promise<ShipStatus>;
  goals: Pick<PluginGoals, 'start' | 'message' | 'closeGoal'>;
  /** The plugin's saved state: the line is its `line`. */
  saved: PluginState<CosState>;
  /** What it's doing on the line this moment, which isn't saved. */
  live: PluginState<CosLive>;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A goal's title as its lead has it, or its words until it's titled. */
const titleOf = (lead: Readonly<Agent> | undefined, words: string): string => lead?.lead?.title ?? truncate(words, 80);

/** The direct line: its conversation, the goals it starts and tells from it, and closing one it started. */
export class DirectLine {
  private running: AbortController | null = null;
  /** The turn running now, or the last one, ended. */
  private turnEnded: Promise<void> = Promise.resolve();
  /** Goals being closed from the line now: a second Close while one is out is refused, so it's closed once. */
  private readonly closing = new Set<string>();

  constructor(
    private readonly host: LineHost,
    private readonly officer: LineOfficer,
  ) {
    // a turn in flight when Focus shut down ends, and the line stays usable
    const kept = host.saved.get().line;
    if (kept && lineAfterRestart(kept) !== kept) this.save(lineAfterRestart(kept));
  }

  current(): CosLine {
    return this.host.saved.get().line ?? freshLine();
  }

  /** The user says something: kept, and the chief of staff's turn starts in the background. */
  say(words: string): CosLine {
    const line = this.current();
    const step = sayStep(line, words);
    if (step.kind === 'refuse') throw new Error(step.why);
    const next: CosLine = { ...line, messages: [...line.messages, { from: 'user', text: step.text, at: Date.now() }], status: 'thinking', error: undefined };
    this.save(next);
    this.run(next);
    return next;
  }

  /** Clears the conversation (stopping a turn mid-thought); the next message starts a fresh session. The goals it started stay kept, so none starts twice. */
  newConversation(): CosLine {
    this.running?.abort();
    this.running = null;
    const line = this.current();
    this.save({ ...freshLine(), started: line.started, told: line.told, since: Date.now() });
    return this.current();
  }

  /** Closes a goal it started from the line (its undo), as the user would: a goal with work to lose warns first, unless `force`. */
  async close(key: string, force = false): Promise<CosLine | { warn: string[] }> {
    const step = closeStep(key, this.current().started, this.aboard());
    if (step.kind === 'refuse') throw new Error(step.why);
    if (step.kind === 'close') {
      if (this.closing.has(key)) throw new Error('It’s closing that goal already');
      this.closing.add(key);
      try {
        const closed = await this.host.goals.closeGoal(step.start.leadId, force);
        if ('warn' in closed) return closed;
      } finally {
        this.closing.delete(key);
      }
    }
    this.markStarted(step.start, { closed: Date.now() });
    return this.current();
  }

  /** The user acknowledged a goal it started (Got it in the muster): its notice leaves the muster, the goal runs on. */
  acknowledge(key: string): CosLine {
    const step = ackStep(key, this.current().started, this.aboard());
    if (step.kind === 'refuse') throw new Error(step.why);
    this.markStarted(step.start, { acked: Date.now() });
    return this.current();
  }

  /** Marks a goal it started closed or acknowledged, as the line has it now. */
  private markStarted(it: LineStart, mark: Pick<LineStart, 'closed' | 'acked'>): void {
    const now = this.current();
    this.save({ ...now, started: now.started.map((s) => (s.key === it.key && s.leadId === it.leadId && s.at === it.at ? { ...s, ...mark } : s)) });
  }

  /** The projects on the line: shown, and the chief of staff switched on there. */
  private projects(): ChatProject[] {
    return shownProjects(this.host.projects()).filter((p) => this.host.on(p.id)).map(({ id, name, repos }) => ({ id, name, repos: [...repos] }));
  }

  /** The open goals on the line: each lead in a project on it. */
  private goals(projects: readonly ChatProject[]): Readonly<Agent>[] {
    const on = new Set(projects.map((p) => p.id));
    return this.host.agents().filter((a) => a.task === 'lead' && on.has(a.projectId));
  }

  private aboard(): Set<string> {
    return new Set(this.host.agents().filter((a) => a.task === 'lead').map((a) => a.id));
  }

  private save(line: CosLine): void {
    if (this.host.live.get().lineActivity) this.host.live.set({ lineActivity: '' });
    this.host.saved.set({ line });
  }

  /** `start_goal`: starts a goal in a project on the line, once (`startStep`), kept on the line with why. */
  private startGoal(input: Record<string, unknown>): string {
    const projects = this.projects();
    const call = { projectId: text(input.projectId), text: text(input.text), why: text(input.why) };
    const step = startStep(call, { projects, started: this.current().started, aboard: this.aboard() });
    if (step.kind === 'refuse') throw new Error(step.why);
    if (step.kind === 'already') {
      const lead = this.host.agents().find((a) => a.id === step.start.leadId);
      return `You started that goal already: “${titleOf(lead, step.start.text)}” in ${step.start.project} (lead ${step.start.leadId}). It wasn't started again.`;
    }
    const project = projects.find((p) => p.id === call.projectId)?.name ?? call.projectId;
    const { agent } = this.host.goals.start(call.projectId, call.text, { from: LINE_FROM });
    const start: LineStart = { key: step.key, leadId: agent.id, projectId: call.projectId, project, text: call.text, why: call.why, at: Date.now() };
    const now = this.current();
    this.save({ ...now, started: [...now.started, start] });
    return `Started “${titleOf(agent, call.text)}” in ${project}: ${agent.name} leads it (${agent.id}). The user sees it on the line with why, and can close it.`;
  }

  /** `tell_goal`: passes an open goal's lead words from the chief of staff, kept on the line. */
  private tellGoal(input: Record<string, unknown>): string {
    const call = { leadId: text(input.leadId), text: text(input.text) };
    const goals = this.goals(this.projects());
    const now = this.current();
    const step = tellStep(call, { goals, told: now.told });
    if (step.kind === 'refuse') throw new Error(step.why);
    if (step.kind === 'already') return 'You told them that already: it wasn’t sent again.';
    const reply = this.host.goals.message(step.leadId, call.text, { from: SENDER });
    if ('costly' in reply) throw new Error('Not sent: picking their conversation back up would cost on the API key, so the user should send it themselves');
    const lead = goals.find((g) => g.id === step.leadId);
    this.save({ ...this.current(), told: [...now.told, { leadId: step.leadId, goal: titleOf(lead, step.leadId), text: call.text, at: Date.now() }] });
    return `Told ${lead?.name ?? step.leadId}.`;
  }

  /** The line's own tools, beside the ship's. */
  tools(): SessionTool[] {
    return [
      {
        name: 'start_goal',
        description: 'Starts a new goal in a project on your line, with a lead of its own, when the conversation calls for work separate from every open goal. The user sees that you started it and why, and can close it. Starting the same goal again finds the one you started.',
        input: {
          projectId: z.string().describe('The project id, as listed with the user’s message'),
          text: z.string().describe('The goal as the user would put it to a lead: what to build and what done looks like, in a few sentences'),
          why: z.string().describe('Why you started it, in one sentence to the user'),
        },
        activity: 'Starting a goal',
        run: (input) => Promise.resolve().then(() => this.startGoal(input)),
      },
      {
        name: 'tell_goal',
        description: 'Tells an open goal’s lead something from you, when the work fits a goal that’s already open: they hear it as the Chief of Staff’s.',
        input: {
          leadId: z.string().describe('The goal’s lead id, as listed with the user’s message'),
          text: z.string().describe('What to tell them, in words they can act on'),
        },
        activity: 'Telling a goal’s lead',
        run: (input) => Promise.resolve().then(() => this.tellGoal(input)),
      },
    ];
  }

  /** Runs its turn in the background; a turn superseded by a new conversation drops its reply. */
  private run(line: CosLine): void {
    const abort = new AbortController();
    this.running = abort;
    const current = () => this.running === abort;
    const projects = this.projects();
    this.turnEnded = this.officer
      .turn(
        {
          system: lineSystemPrompt(),
          prompt: linePrompt({ messages: line.messages, resumeSessionId: line.sessionId, projects, goals: this.goals(projects), started: line.started }),
          resumeSessionId: line.sessionId,
          projects,
          shipStatus: () => this.host.shipStatus(),
          tools: this.tools(),
          settings: this.host.settings(),
          signal: abort.signal,
        },
        (said) => {
          if (current() && said) this.host.live.set({ lineActivity: truncate(said, 120) });
        },
      )
      .then((reply) => {
        if (!current()) return;
        const now = this.current();
        this.save({
          ...now,
          messages: [...now.messages, { from: 'cos', text: reply.text.trim() || '…', at: Date.now() }],
          sessionId: reply.sessionId ?? now.sessionId,
          costUsd: now.costUsd + (reply.costUsd ?? 0),
          status: 'waiting',
        });
      })
      .catch((err: unknown) => {
        if (current()) this.save({ ...this.current(), status: 'failed', error: errorMessage(err) });
      })
      .finally(() => {
        if (this.running === abort) this.running = null;
      });
  }

  /** Until the turn running now (if any) has ended. */
  settled(): Promise<void> {
    return this.turnEnded;
  }
}

// ---------------------------------------------------------------- prompts

/** Its system prompt on the line: the same every turn, since a resumed session keeps its first (crew/line.md). */
export const lineSystemPrompt = (): string => CREW.prompt('line', {});

const SPEAKERS: Record<LineMessage['from'], string> = { user: 'The user', cos: 'You' };

/** How an open goal reads on the line: its lead's id, title, who leads it, how they stand, and what waits on the user. */
function goalLine(g: Readonly<Agent>): string {
  const read = readOf(g)?.judged;
  const waits = read && (read.route === 2 || read.route === 3) ? `; waiting on the user: ${headlineOf(read.asks)}` : '';
  return `  - ${g.id}: “${titleOf(g, g.name)}” (${g.name}, ${doing(g.status)}${waits})`;
}

/**
 * The user's words since it last replied, and the ship as it is now: the projects on the line with their open goals,
 * and the goals it started from the line. Without a session (a new conversation, or one lost), the conversation
 * before them too.
 */
export function linePrompt(req: { messages: readonly LineMessage[]; resumeSessionId?: string; projects: readonly ChatProject[]; goals: readonly Readonly<Agent>[]; started: readonly LineStart[] }): string {
  const answered = req.messages.map((m) => m.from).lastIndexOf('cos') + 1;
  const earlier = req.messages.slice(0, answered);
  const latest = req.messages.slice(answered).map((m) => m.text).join('\n\n');
  const recap = !req.resumeSessionId && earlier.length ? `Here's the conversation so far:\n"""\n${earlier.map((m) => `${SPEAKERS[m.from]}: ${m.text}`).join('\n\n')}\n"""\n\n` : '';
  const projects = req.projects.map((p) => {
    const goals = req.goals.filter((g) => g.projectId === p.id).map(goalLine);
    return [`- ${p.name} (id ${p.id})${goals.length ? ':' : ': no open goals'}`, ...goals].join('\n');
  });
  const open = new Set(req.goals.map((g) => g.id));
  const started = req.started.map((s) => `- “${truncate(s.text, 120)}” in ${s.project} (${s.leadId}): ${s.closed !== undefined ? 'closed by the user' : open.has(s.leadId) ? 'open' : 'gone'}`);
  return [
    `${recap}The user says:\n"""\n${latest}\n"""`,
    `The projects on your line, and their open goals:\n${projects.join('\n') || 'None: the chief of staff isn’t switched on for any project, so you can’t start or tell a goal.'}`,
    `Goals you've started from this line:\n${started.join('\n') || 'None yet.'}`,
  ].join('\n\n');
}
