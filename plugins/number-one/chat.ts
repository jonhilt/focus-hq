// Number One's chat in the ready room: one conversation, a turn at a time, and the prompts and reply
// schema of their read-only Claude Code session.
import { freshChat, numberOne, type NumberOneChat, type NumberOneLive, type NumberOneMessage, type NumberOneSaved, type WorkSuggestion } from './shared';
import { type ChatProject, errorMessage, type PersonalEntry, type PluginState, type Project, projectList, type Settings, type ShipStatus, shownProjects, spokenLine, truncate } from '../../plugin-api/server';

export interface NumberOneTurn {
  projects: ChatProject[];
  /** Everything said so far, the captain's latest message included. */
  messages: NumberOneMessage[];
  /** Number One's session so far; missing on the first turn of a conversation. */
  resumeSessionId?: string;
  /** The ship as it is right now, for the ship_status tool. */
  shipStatus: () => Promise<ShipStatus>;
  /** What's on the captain's mind, from their personal log (`personalLogLines`): empty when there's nothing. */
  personalLog: string;
  settings: Settings;
  signal: AbortSignal;
}

export interface NumberOneReply {
  text: string;
  spoken?: string;
  suggest?: WorkSuggestion;
  /** A thought to jot down in the captain's personal log, when the captain asked for one. */
  log?: string;
  sessionId?: string;
  costUsd?: number;
}

/** Takes one turn of the chat. The live one resumes a read-only Claude Code session; the demo one is scripted. */
export interface NumberOneOfficer {
  turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply>;
}

/** What the chat needs from the office: its projects and settings, the ship's status, and its own state. */
export interface ChatOffice {
  projects(): Project[];
  settings(): Settings;
  shipStatus(): Promise<ShipStatus>;
  /** The captain's personal log: what's in it, and jotting a thought down in it for them. */
  personalLog: { entries(): readonly PersonalEntry[]; note(text: string): void };
  /** The saved chat. */
  saved: PluginState<NumberOneSaved>;
  /** What Number One is doing this moment, which isn't saved. */
  live: PluginState<Pick<NumberOneLive, 'activity'>>;
}

/**
 * Number One in the ready room: the captain's chat with the ship's first officer, who reads any project's code and the
 * ship's live state and changes nothing. When a chat turns into work they suggest it; the captain decides where it goes.
 * One conversation, one turn at a time, each resuming the same session, so it survives a restart.
 */
export class NumberOne {
  private running: AbortController | null = null;

  constructor(
    private readonly office: ChatOffice,
    private readonly officer: NumberOneOfficer,
  ) {}

  current(): NumberOneChat {
    return this.office.saved.get().chat;
  }

  say(text: string): NumberOneChat {
    const chat = this.current();
    if (chat.status === 'thinking') throw new Error(`${numberOne().name} is still thinking`);
    if (!text.trim()) throw new Error('Say something first');
    const next: NumberOneChat = {
      ...chat,
      messages: [...chat.messages, { from: 'manager', text: text.trim(), at: Date.now() }],
      status: 'thinking',
      activity: 'Thinking it over',
      error: undefined,
      updatedAt: Date.now(),
    };
    this.save(next);
    this.run(next);
    return next;
  }

  /** Clears the log (stopping Number One mid-thought if need be); the next message starts a fresh session. */
  newConversation(): NumberOneChat {
    this.running?.abort();
    this.running = null;
    this.save(freshChat());
    return this.current();
  }

  /** Saves the chat, and what Number One is doing now goes back to what it says (sent only when it changes). */
  private save(chat: NumberOneChat): void {
    if (this.office.live.get().activity) this.office.live.set({ activity: '' });
    this.office.saved.set({ chat });
  }

  /** Jots `text` down in the captain's personal log: what was jotted down, or nothing if the log refused it. */
  private jot(text: string): string | undefined {
    try {
      this.office.personalLog.note(text);
      return text;
    } catch {
      return undefined;
    }
  }

  /** Runs Number One's turn in the background; a turn superseded by a new conversation drops its reply. */
  private run(chat: NumberOneChat): void {
    const abort = new AbortController();
    this.running = abort;
    const current = () => this.running === abort;
    // hidden projects stay out of the chat, so a demo can't turn them up
    const projects = shownProjects(this.office.projects()).map(({ id, name, repos }) => ({ id, name, repos: [...repos] }));
    void this.officer
      .turn(
        {
          projects,
          messages: [...chat.messages],
          resumeSessionId: chat.sessionId,
          shipStatus: () => this.office.shipStatus(),
          personalLog: personalLogLines(this.office.personalLog.entries(), Date.now()),
          settings: this.office.settings(),
          signal: abort.signal,
        },
        // what they're doing goes to every screen, but isn't saved: a turn reads a lot
        (text) => {
          if (current() && text) this.office.live.set({ activity: truncate(text, 120) });
        },
      )
      .then((reply) => {
        if (!current()) return;
        const text = reply.text.trim() || '…';
        const logged = reply.log && this.jot(reply.log);
        const now = this.current();
        this.save({
          ...now,
          messages: [...now.messages, { from: 'number-one', text, spoken: spokenLine(reply.spoken, text), suggest: reply.suggest, ...(logged && { logged }), at: Date.now() }],
          sessionId: reply.sessionId ?? now.sessionId,
          costUsd: now.costUsd + (reply.costUsd ?? 0),
          status: 'waiting',
          activity: 'Waiting for you',
          updatedAt: Date.now(),
        });
      })
      .catch((err: unknown) => {
        if (!current()) return;
        this.save({ ...this.current(), status: 'failed', activity: 'Lost the thread', error: errorMessage(err), updatedAt: Date.now() });
      })
      .finally(() => {
        if (this.running === abort) this.running = null;
      });
  }
}

// ---------------------------------------------------------------- prompts and reply

export function numberOneSystemPrompt(req: { projects: ChatProject[]; workspaces: string }): string {
  return `
# You are ${numberOne().name}, Number One: first officer of the Focus, in the ready room with the captain

The Focus is an office of Claude Code agents. Each project is a room: agents at its desks build GitHub issues into pull requests, a QA officer tests every pull request, the room's operations officer drafts issues at the Ops station, and at its team stations the captain's goals are built a slice at a time, each by a lead of its own (the captain's own Claude Code session for that goal, across the project's repos). The captain (the person you're talking to) runs the ship.

You are the one the captain just talks to: questions about any project's code, what's going on aboard, or thinking something through. Answer plainly and briefly, like a trusted first officer. No headings or essays.

The projects aboard, and where their code goes once you open them:
${projectList(req.projects)}

Your tools (you can't change anything, and must not try):
- mcp__number-one__ship_status: the ship right now, per project: agents and what they're on, open pull requests with QA's verdict and checks, what needs the captain, and the goals the captain has closed with each of their pull requests' state on GitHub right now (open, merged or closed; \`stale\` means GitHub couldn't be asked and it's only what was recorded when the goal closed, so say so). Call it whenever the captain asks what's going on, what's stuck or who's doing what, or whether a closed goal landed; don't answer that from memory, it changes all the time.
- mcp__number-one__open_project: checks a project's repositories out at their default branch into the folders above. Call it once per project per conversation, before reading that project's code. If it fails, tell the captain the checkout failed and for which project, then carry on with whatever else you can answer.
- Read, Glob and Grep: the code. Answer "how does X work" from the default-branch checkouts only, naming the files.
- An agent's worktree (the \`worktree\` path in ship_status, under ${req.workspaces}) holds their half-finished work: read it only to see what that agent has done so far, never to explain how the code works.
- WebSearch and WebFetch: for anything beyond the code, with the source.

The captain keeps a personal log of thoughts to come back to (ideas, things to check); what's open in it comes with each message. Bring an entry up when it bears on what you're talking about, not otherwise. When the captain asks you to remember, note or log something, put \`log\` in your result: the thought as they'd jot it down, in a sentence or two, and say you've logged it. Leave \`log\` out of every other reply.

You never file, push, edit, start agents, draft issues or talk to the lead yourself. When a conversation turns into work, suggest it: put \`suggest\` in your result with the project's id and the idea in a sentence or two, and say so in your reply. The captain decides whether to draft it at Ops or start it as a goal with a lead. Leave \`suggest\` out of every other reply.

Finish every reply with the structured result: \`reply\`, what you'd write (file names and all), and \`spoken\`, the same reply said aloud in one or two short conversational sentences, with no file paths, code or symbols.
`.trim();
}

const SPEAKERS: Record<NumberOneMessage['from'], string> = { manager: 'Captain', 'number-one': 'You' };

/** The captain's messages since Number One last replied (and what's on their mind); without a session (a new conversation), the chat before them too. */
export function numberOnePrompt(req: Pick<NumberOneTurn, 'messages' | 'resumeSessionId'> & { personalLog?: string }): string {
  const answered = req.messages.map((m) => m.from).lastIndexOf('number-one') + 1;
  const earlier = req.messages.slice(0, answered);
  const latest = req.messages.slice(answered).map((m) => m.text).join('\n\n');
  const recap = !req.resumeSessionId && earlier.length ? `Here's the conversation so far:\n"""\n${earlier.map((m) => `${SPEAKERS[m.from]}: ${m.text}`).join('\n\n')}\n"""\n\n` : '';
  const mind = req.personalLog ? `\n\nWhat's open in the captain's personal log (bring it up only when it bears on this; \`log\` to jot something new down):\n${req.personalLog}` : '';
  return `${recap}The captain says:\n"""\n${latest}\n"""${mind}`;
}

/** The most of the personal log's open entries Number One hears each turn, and the most of each one. */
const LOG_SHOWN = 15;
const LOG_CHARS = 300;

/** What's open in the captain's personal log at `now`, newest first, a line each: what Number One hears each turn. */
export function personalLogLines(entries: readonly PersonalEntry[], now: number): string {
  const open = entries.filter((e) => e.status === 'open' && !(e.until !== undefined && e.until > now)).sort((a, b) => b.at - a.at);
  const aside = entries.filter((e) => e.status === 'open' && e.until !== undefined && e.until > now).length;
  const days = (e: PersonalEntry) => Math.floor((now - e.at) / 86_400_000);
  const lines = open.slice(0, LOG_SHOWN).map((e) => `- ${truncate(e.text.replace(/\s+/g, ' '), LOG_CHARS)} (${days(e) === 0 ? 'today' : `${days(e)}d ago`})`);
  if (open.length > LOG_SHOWN) lines.push(`- …and ${open.length - LOG_SHOWN} older`);
  if (aside) lines.push(`(${aside} more put aside till later)`);
  return lines.join('\n');
}

/** `suggest` names one of the projects aboard; with none aboard there's nothing to suggest work in. */
export function numberOneReplySchema(projectIds: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'spoken'],
    properties: {
      reply: { type: 'string', description: 'Your reply for the chat log' },
      spoken: { type: 'string', description: 'The same reply said aloud: one or two short conversational sentences, no file paths, code or symbols' },
      log: { type: 'string', description: 'Only when the captain asks you to remember, note or log something: the thought for their personal log, as they would jot it down' },
      ...(projectIds.length > 0 && {
        suggest: {
          type: 'object',
          additionalProperties: false,
          required: ['projectId', 'idea'],
          description: 'Only when the conversation has turned into work worth doing: the project and the idea, for the captain to draft at Ops or start as a goal with a lead',
          properties: {
            projectId: { type: 'string', enum: projectIds },
            idea: { type: 'string', description: 'The work in a sentence or two, as the captain would put it to the operations officer or the lead' },
          },
        },
      }),
    },
  };
}

/** Number One's structured reply; the session's final text stands in if it's missing. A suggestion for no real project is dropped. */
export function asNumberOneReply(out: unknown, fallback: string, projectIds: string[]): Pick<NumberOneReply, 'text' | 'spoken' | 'suggest' | 'log'> {
  const record = (v: unknown) => (typeof v === 'object' && v ? (v as Record<string, unknown>) : {});
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const result = record(out);
  const suggest = record(result.suggest);
  const projectId = text(suggest.projectId);
  const idea = text(suggest.idea);
  const log = text(result.log);
  return {
    text: text(result.reply) || fallback,
    spoken: text(result.spoken) || undefined,
    ...(projectIds.includes(projectId) && idea && { suggest: { projectId, idea: truncate(idea, 1000) } }),
    ...(log && { log: truncate(log, 2000) }),
  };
}
