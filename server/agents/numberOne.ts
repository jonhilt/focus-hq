import { statusLine } from '../../shared/agentStatus';
import { numberOne } from '../../shared/crew';
import { shownProjects } from '../../shared/hidden';
import { prKey, qaBadge } from '../../shared/qa';
import type { Agent, NumberOneChat, NumberOneMessage, Project, PullRequest, Settings, Snapshot, WorkSuggestion } from '../../shared/types';
import { spokenLine } from '../../shared/voice';
import type { Hub } from '../hub';
import { freshNumberOne, type Store, type StoredNumberOne } from '../store';
import { errorMessage, truncate } from '../util';
import { repoFolders } from './planner';

export type ChatProject = Pick<Project, 'id' | 'name' | 'repos'>;

export interface NumberOneTurn {
  projects: ChatProject[];
  /** Everything said so far, the captain's latest message included. */
  messages: NumberOneMessage[];
  /** Number One's session so far; missing on the first turn of a conversation. */
  resumeSessionId?: string;
  /** The ship as it is right now, for the ship_status tool. */
  shipStatus: () => Promise<ShipStatus>;
  settings: Settings;
  signal: AbortSignal;
}

export interface NumberOneReply {
  text: string;
  spoken?: string;
  suggest?: WorkSuggestion;
  sessionId?: string;
  costUsd?: number;
}

/** Takes one turn of the chat. The live one resumes a read-only Claude Code session; the demo one is scripted. */
export interface NumberOneOfficer {
  turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply>;
}

const publicView = ({ sessionId: _, ...chat }: StoredNumberOne): NumberOneChat => chat;

/**
 * Number One in the ready room: the captain's chat with the ship's first officer, who reads any project's code and the
 * ship's live state and changes nothing. When a chat turns into work they suggest it; the captain decides where it goes.
 * One conversation, one turn at a time, each resuming the same session, so it survives a restart.
 */
export class NumberOne {
  private running: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly officer: NumberOneOfficer,
    private readonly shipStatus: () => Promise<ShipStatus>,
  ) {}

  current(): NumberOneChat {
    return publicView(this.store.numberOne);
  }

  say(text: string): NumberOneChat {
    const chat = this.store.numberOne;
    if (chat.status === 'thinking') throw new Error(`${numberOne().name} is still thinking`);
    if (!text.trim()) throw new Error('Say something first');
    chat.messages.push({ from: 'manager', text: text.trim(), at: Date.now() });
    Object.assign(chat, { status: 'thinking', activity: 'Thinking it over', error: undefined, updatedAt: Date.now() });
    this.changed();
    this.run(chat);
    return publicView(chat);
  }

  /** Clears the log (stopping Number One mid-thought if need be); the next message starts a fresh session. */
  newConversation(): NumberOneChat {
    this.running?.abort();
    this.running = null;
    this.store.numberOne = freshNumberOne();
    this.changed();
    return this.current();
  }

  private changed(): void {
    this.store.save();
    this.hub.send({ type: 'number-one', chat: this.current() });
  }

  /** Runs Number One's turn in the background; a turn superseded by a new conversation drops its reply. */
  private run(chat: StoredNumberOne): void {
    const abort = new AbortController();
    this.running = abort;
    const current = () => this.store.numberOne === chat && this.running === abort;
    // hidden projects stay out of the chat, so a demo can't turn them up
    const projects = shownProjects(this.store.projects).map(({ id, name, repos }) => ({ id, name, repos: [...repos] }));
    void this.officer
      .turn(
        { projects, messages: [...chat.messages], resumeSessionId: chat.sessionId, shipStatus: this.shipStatus, settings: this.store.settings, signal: abort.signal },
        (text) => {
          if (!current() || !text) return;
          chat.activity = truncate(text, 120);
          this.hub.send({ type: 'number-one', chat: this.current() });
        },
      )
      .then((reply) => {
        if (!current()) return;
        const text = reply.text.trim() || '…';
        chat.messages.push({ from: 'number-one', text, spoken: spokenLine(reply.spoken, text), suggest: reply.suggest, at: Date.now() });
        Object.assign(chat, {
          sessionId: reply.sessionId ?? chat.sessionId,
          costUsd: chat.costUsd + (reply.costUsd ?? 0),
          status: 'waiting',
          activity: 'Waiting for you',
          updatedAt: Date.now(),
        });
        this.changed();
      })
      .catch((err: unknown) => {
        if (!current()) return;
        Object.assign(chat, { status: 'failed', activity: 'Lost the thread', error: errorMessage(err), updatedAt: Date.now() });
        this.changed();
      })
      .finally(() => {
        if (this.running === abort) this.running = null;
      });
  }
}

// ---------------------------------------------------------------- ship_status

export interface AgentStatusLine {
  name: string;
  task: Agent['task'];
  repo: string;
  /** "#12 Add a wishlist" */
  issue: string;
  status: Agent['status'];
  activity: string;
  pr?: number;
  /** The agent's worktree on this machine, read-only for Number One. Missing for cloud agents. */
  worktree?: string;
}

export interface PrStatusLine {
  repo: string;
  number: number;
  title: string;
  author?: string;
  draft: boolean;
  /** QA's verdict as the board shows it ("✅ QA passed", "not tested"). */
  qa: string;
  checks: PullRequest['checks'];
  failedChecks?: string[];
  conflicts: boolean;
}

export interface ProjectStatus {
  id: string;
  name: string;
  repos: string[];
  agents: AgentStatusLine[];
  openIssues: number;
  prs: PrStatusLine[];
  /** PRs left out to keep it short. */
  morePrs?: number;
  /** What's waiting on the captain in this room. */
  needsCaptain: string[];
  boardError?: string;
}

/** What `ship_status` tells Number One: per project, who's working on what, the open PRs and what needs the captain. */
export interface ShipStatus {
  projects: ProjectStatus[];
}

const MAX_PRS = 15;
const TITLE = 80;
const ACTIVITY = 120;

/**
 * The ship's live state, trimmed hard for Number One: no terminal lines, browser frames, previews or voice, and short
 * lines throughout, and nothing about hidden projects. `worktree` says where an agent's checkout lives on this machine.
 */
export function summariseShip(snapshot: Snapshot, worktree: (agentId: string) => string): ShipStatus {
  const reviews = new Map(snapshot.reviews.map((r) => [prKey(r.repo, r.number), r]));
  const projects = shownProjects(snapshot.projects).map((project): ProjectStatus => {
    const agents = snapshot.agents.filter((a) => a.projectId === project.id);
    const board = snapshot.boards.find((b) => b.projectId === project.id);
    const prs = board?.prs ?? [];
    const needs: string[] = [];
    for (const agent of agents) {
      if (agent.status === 'waiting') needs.push(`${agent.name} has a hand up${agent.permission ? `: ${truncate(agent.permission.summary, ACTIVITY)}` : ''}`);
      if (agent.status === 'error') needs.push(`${agent.name} hit a problem${agent.error ? `: ${truncate(agent.error, ACTIVITY)}` : ''}`);
    }
    for (const pr of prs) {
      const ref = `${pr.repo}#${pr.number}`;
      const review = reviews.get(prKey(pr.repo, pr.number));
      if (pr.mergeable === 'CONFLICTING') needs.push(`${ref} conflicts with ${pr.baseBranch}`);
      if (review?.followUp?.kind === 'needs-you') needs.push(`${ref} failed QA and needs you: ${truncate(review.followUp.reason, ACTIVITY)}`);
      if (review?.status === 'error') needs.push(`${ref}: QA couldn’t finish`);
      if (qaBadge(review, pr).state === 'passed' && pr.checks !== 'failing' && pr.checks !== 'pending' && pr.mergeable !== 'CONFLICTING' && !pr.isDraft) {
        needs.push(`${ref} passed QA: ready to merge`);
      }
    }
    const draft = snapshot.drafts.find((d) => d.projectId === project.id);
    if (draft?.status === 'ready') needs.push(`An issue draft is waiting at the stand: “${truncate(draft.title ?? draft.idea, TITLE)}”`);
    if (draft?.status === 'failed') needs.push(`The stand's draft of “${truncate(draft.idea, TITLE)}” failed`);
    return {
      id: project.id,
      name: project.name,
      repos: project.repos,
      agents: agents.map((a) => ({
        name: a.name,
        task: a.task,
        repo: a.repo,
        issue: a.task === 'lead' ? truncate(`Goal “${a.lead?.title ?? a.issue.title}”, slice ${a.lead?.slice ?? 1}, with the captain`, TITLE) : truncate(`#${a.issue.number} ${a.issue.title}`, TITLE),
        status: a.status,
        activity: truncate(statusLine(a), ACTIVITY),
        ...(a.pr && { pr: a.pr.number }),
        ...(!a.cloud && { worktree: worktree(a.id) }),
      })),
      openIssues: board?.issues.length ?? 0,
      prs: prs.slice(0, MAX_PRS).map((pr) => ({
        repo: pr.repo,
        number: pr.number,
        title: truncate(pr.title, TITLE),
        author: pr.author,
        draft: pr.isDraft,
        qa: qaBadge(reviews.get(prKey(pr.repo, pr.number)), pr).label,
        checks: pr.checks,
        ...(pr.failedChecks.length > 0 && { failedChecks: pr.failedChecks.map((c) => c.name).slice(0, 5) }),
        conflicts: pr.mergeable === 'CONFLICTING',
      })),
      ...(prs.length > MAX_PRS && { morePrs: prs.length - MAX_PRS }),
      needsCaptain: needs,
      ...(board?.error && { boardError: truncate(board.error, ACTIVITY) }),
    };
  });
  return { projects };
}

// ---------------------------------------------------------------- prompts and reply

/** Where each project's checkout goes once `open_project` has fetched it, relative to Number One's cwd. */
function projectList(projects: ChatProject[]): string {
  if (!projects.length) return 'There are no projects aboard yet.';
  return projects
    .map((p) => {
      const folders = repoFolders(p.repos);
      const repos = p.repos.length ? p.repos.map((r) => `\`${p.id}/${folders.get(r)}/\` (${r})`).join(', ') : 'no repositories yet';
      return `- ${p.name}, id \`${p.id}\`: ${repos}`;
    })
    .join('\n');
}

export function numberOneSystemPrompt(req: { projects: ChatProject[]; workspaces: string }): string {
  return `
# You are ${numberOne().name}, Number One: first officer of the Focus, in the ready room with the captain

The Focus is an office of Claude Code agents. Each project is a room: agents at its desks build GitHub issues into pull requests, a QA officer tests every pull request, the room's operations officer drafts issues at the ＋ New issue stand, and at its team stations the captain's goals are built a slice at a time, each by a lead of its own (the captain's own Claude Code session for that goal, across the project's repos). The captain (the person you're talking to) runs the ship.

You are the one the captain just talks to: questions about any project's code, what's going on aboard, or thinking something through. Answer plainly and briefly, like a trusted first officer. No headings or essays.

The projects aboard, and where their code goes once you open them:
${projectList(req.projects)}

Your tools (you can't change anything, and must not try):
- mcp__number-one__ship_status: the ship right now, per project: agents and what they're on, open pull requests with QA's verdict and checks, and what needs the captain. Call it whenever the captain asks what's going on, what's stuck or who's doing what; don't answer that from memory, it changes all the time.
- mcp__number-one__open_project: checks a project's repositories out at their default branch into the folders above. Call it once per project per conversation, before reading that project's code. If it fails, tell the captain the checkout failed and for which project, then carry on with whatever else you can answer.
- Read, Glob and Grep: the code. Answer "how does X work" from the default-branch checkouts only, naming the files.
- An agent's worktree (the \`worktree\` path in ship_status, under ${req.workspaces}) holds their half-finished work: read it only to see what that agent has done so far, never to explain how the code works.
- WebSearch and WebFetch: for anything beyond the code, with the source.

You never file, push, edit, start agents, draft issues or talk to the lead yourself. When a conversation turns into work, suggest it: put \`suggest\` in your result with the project's id and the idea in a sentence or two, and say so in your reply. The captain decides whether to draft it at the stand or start it as a goal with a lead. Leave \`suggest\` out of every other reply.

Finish every reply with the structured result: \`reply\`, what you'd write (file names and all), and \`spoken\`, the same reply said aloud in one or two short conversational sentences, with no file paths, code or symbols.
`.trim();
}

const SPEAKERS: Record<NumberOneMessage['from'], string> = { manager: 'Captain', 'number-one': 'You' };

/** The captain's messages since Number One last replied; without a session (a new conversation), the chat before them too. */
export function numberOnePrompt(req: Pick<NumberOneTurn, 'messages' | 'resumeSessionId'>): string {
  const answered = req.messages.map((m) => m.from).lastIndexOf('number-one') + 1;
  const earlier = req.messages.slice(0, answered);
  const latest = req.messages.slice(answered).map((m) => m.text).join('\n\n');
  const recap = !req.resumeSessionId && earlier.length ? `Here's the conversation so far:\n"""\n${earlier.map((m) => `${SPEAKERS[m.from]}: ${m.text}`).join('\n\n')}\n"""\n\n` : '';
  return `${recap}The captain says:\n"""\n${latest}\n"""`;
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
      ...(projectIds.length > 0 && {
        suggest: {
          type: 'object',
          additionalProperties: false,
          required: ['projectId', 'idea'],
          description: 'Only when the conversation has turned into work worth doing: the project and the idea, for the captain to draft at the stand or start as a goal with a lead',
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
export function asNumberOneReply(out: unknown, fallback: string, projectIds: string[]): Pick<NumberOneReply, 'text' | 'spoken' | 'suggest'> {
  const record = (v: unknown) => (typeof v === 'object' && v ? (v as Record<string, unknown>) : {});
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const result = record(out);
  const suggest = record(result.suggest);
  const projectId = text(suggest.projectId);
  const idea = text(suggest.idea);
  return {
    text: text(result.reply) || fallback,
    spoken: text(result.spoken) || undefined,
    ...(projectIds.includes(projectId) && idea && { suggest: { projectId, idea: truncate(idea, 1000) } }),
  };
}
