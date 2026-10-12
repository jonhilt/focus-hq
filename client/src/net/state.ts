import { isHidden, shownProjects } from '../../../shared/hidden';
import type { ReportCard } from '../../../shared/ledger';
import { prKey } from '../../../shared/qa';
import type { Agent, Board, BrowserFrame, CallStatus, IssueDraft, NumberOneChat, Preview, Project, QaReview, Retro, Scorecards, ServerEvent, ServerInfo, StudioSession, TermLine, VoiceStatus } from '../../../shared/types';

type Events = {
  snapshot: void;
  info: void;
  projects: void;
  agent: Agent;
  'agent-removed': Agent;
  lines: { id: string; lines: TermLine[] };
  browser: string;
  board: string;
  /** before = the preview this one replaced or updated, so listeners can spot status changes. */
  preview: { projectId: string; preview: Preview | null; before?: Preview };
  'preview-log': Extract<ServerEvent, { type: 'preview-log' }>;
  toast: Extract<ServerEvent, { type: 'toast' }>;
  /** A project's issue draft changed (project id). */
  draft: string;
  'number-one': void;
  /** The studio holodeck's conversation, video or takes changed. */
  studio: void;
  /** The ledger's report card changed. */
  report: void;
  /** The chief engineer's retro changed. */
  retro: void;
  /** Main engineering's scorecards changed: one measured, or a measurement started or failed. */
  scorecards: void;
  /** A QA review changed or went away (its project id). */
  review: string;
  voice: void;
  /** The call to Number One changed, or whether the office can take one. */
  call: void;
  connection: boolean;
};

type Listener<T> = (payload: T) => void;

const MAX_LINES = 600;

/** Mirror of the server's office state, kept live over the WebSocket. */
export class OfficeState {
  info: ServerInfo | null = null;
  projects: Project[] = [];
  agents = new Map<string, Agent>();
  boards = new Map<string, Board>();
  lines = new Map<string, TermLine[]>();
  browser = new Map<string, BrowserFrame>();
  /** Running previews by project id. */
  previews = new Map<string, Preview>();
  /** The planner's issue draft per project id, while one is being written or waits to be filed. */
  drafts = new Map<string, IssueDraft>();
  /** The captain's chat with Number One in the ready room. */
  numberOne: NumberOneChat | null = null;
  studio: StudioSession | null = null;
  report: ReportCard | null = null;
  retro: Retro | null = null;
  scorecards: Scorecards | null = null;
  /** The latest QA review per pull request (by prKey). */
  reviews = new Map<string, QaReview>();
  /** Whether dictation can run on the server, and the speech model's download. */
  voice: VoiceStatus | null = null;
  /** Whether the office can take a call to Number One, and the call under way (or the last one). */
  call: CallStatus | null = null;
  connected = false;

  private listeners = new Map<keyof Events, Set<Listener<never>>>();
  private ws: WebSocket | null = null;
  private retry = 500;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as Listener<Events[K]>)(payload);
  }

  /** Opens a fresh socket, dropping any earlier one; the snapshot the server sends on connect resyncs everything. */
  connect(): void {
    clearTimeout(this.retryTimer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    const before = this.ws;
    this.ws = ws;
    before?.close();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 500;
      this.connected = true;
      this.emit('connection', true);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.emit('connection', false);
      this.retryTimer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerEvent);
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'snapshot': {
        const s = event.snapshot;
        // The server restarted on newer code (auto update): reload to pick up the matching client.
        if (this.info && this.info.version !== s.info.version) return location.reload();
        this.info = s.info;
        this.projects = s.projects;
        this.agents = new Map(s.agents.map((a) => [a.id, a]));
        this.boards = new Map(s.boards.map((b) => [b.projectId, b]));
        this.lines = new Map(Object.entries(s.lines));
        this.browser = new Map(Object.entries(s.browser));
        this.previews = new Map((s.previews ?? []).map((p) => [p.projectId, p]));
        this.drafts = new Map((s.drafts ?? []).map((d) => [d.projectId, d]));
        this.reviews = new Map((s.reviews ?? []).map((r) => [prKey(r.repo, r.number), r]));
        this.numberOne = s.numberOne;
        this.studio = s.studio;
        this.report = s.report;
        this.retro = s.retro;
        this.scorecards = s.scorecards;
        this.voice = s.voice;
        this.call = s.call;
        this.emit('snapshot', undefined);
        this.emit('report', undefined);
        this.emit('scorecards', undefined);
        this.emit('voice', undefined);
        this.emit('call', undefined);
        this.emit('number-one', undefined);
        this.emit('studio', undefined);
        break;
      }
      case 'info':
        this.info = event.info;
        this.emit('info', undefined);
        break;
      case 'projects':
        this.projects = event.projects;
        this.emit('projects', undefined);
        break;
      case 'agent':
        // a lead's helper that's gone takes its transcript with it
        for (const h of this.agents.get(event.agent.id)?.helpers ?? []) if (!event.agent.helpers?.some((x) => x.id === h.id)) this.lines.delete(h.id);
        this.agents.set(event.agent.id, event.agent);
        this.emit('agent', event.agent);
        break;
      case 'agent-removed': {
        const agent = this.agents.get(event.id);
        this.agents.delete(event.id);
        this.lines.delete(event.id);
        for (const h of agent?.helpers ?? []) this.lines.delete(h.id);
        this.browser.delete(event.id);
        if (agent) this.emit('agent-removed', agent);
        break;
      }
      case 'lines': {
        const buffer = this.lines.get(event.id) ?? [];
        buffer.push(...event.lines);
        if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
        this.lines.set(event.id, buffer);
        this.emit('lines', { id: event.id, lines: event.lines });
        break;
      }
      case 'browser':
        if (event.frame) this.browser.set(event.id, event.frame);
        else this.browser.delete(event.id);
        this.emit('browser', event.id);
        break;
      case 'board':
        this.boards.set(event.board.projectId, event.board);
        this.emit('board', event.board.projectId);
        break;
      case 'preview': {
        const before = this.previews.get(event.projectId);
        if (event.preview) this.previews.set(event.projectId, { ...event.preview });
        else this.previews.delete(event.projectId);
        this.emit('preview', { projectId: event.projectId, preview: event.preview, before });
        break;
      }
      case 'preview-log':
        this.emit('preview-log', event);
        break;
      case 'toast':
        this.emit('toast', event);
        break;
      case 'review':
        this.reviews.set(prKey(event.review.repo, event.review.number), event.review);
        this.emit('review', event.review.projectId);
        break;
      case 'review-removed': {
        const key = prKey(event.repo, event.number);
        const review = this.reviews.get(key);
        this.reviews.delete(key);
        if (review) this.emit('review', review.projectId);
        break;
      }
      case 'voice':
        this.voice = event.voice;
        this.emit('voice', undefined);
        break;
      case 'call':
        this.call = { ...this.call, call: event.call };
        this.emit('call', undefined);
        break;
        break;
      case 'report':
        this.report = event.report;
        this.emit('report', undefined);
        break;
      case 'retro':
        this.retro = event.retro;
        this.emit('retro', undefined);
        break;
      case 'scorecards':
        this.scorecards = event.scorecards;
        this.emit('scorecards', undefined);
        break;
      case 'number-one':
        this.numberOne = event.chat;
        this.emit('number-one', undefined);
        break;
      case 'studio':
        this.studio = event.session;
        this.emit('studio', undefined);
        break;
      case 'draft':
        if (event.draft) this.drafts.set(event.projectId, event.draft);
        else this.drafts.delete(event.projectId);
        this.emit('draft', event.projectId);
        break;
    }
  }

  project(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  /** The projects that show aboard: every one but the hidden ones, which nothing outside the ready room names. */
  get shown(): Project[] {
    return shownProjects(this.projects);
  }

  /** Whether the project is hidden (see Project.hidden). */
  isHidden(projectId: string): boolean {
    return isHidden(this.project(projectId));
  }

  /** Every agent but those of hidden projects. */
  shownAgents(): Agent[] {
    return [...this.agents.values()].filter((a) => !this.isHidden(a.projectId));
  }

  agentsIn(projectId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.projectId === projectId);
  }

  /** The room's goals: each one's lead, by team station. */
  leadsIn(projectId: string): Agent[] {
    return this.agentsIn(projectId).filter((a) => a.task === 'lead').sort((a, b) => (a.lead?.station ?? 0) - (b.lead?.station ?? 0));
  }

  /** The room's QA officer's agent record, while they have one. */
  qaAgent(projectId: string): Agent | undefined {
    return this.agentsIn(projectId).find((a) => a.task === 'review' && !a.reviewFor);
  }

  /** The goals' own QA reviewers in the room, while they have a record. */
  reviewersIn(projectId: string): Agent[] {
    return this.agentsIn(projectId).filter((a) => a.task === 'review' && a.reviewFor);
  }

  reviewsIn(projectId: string): QaReview[] {
    return [...this.reviews.values()].filter((r) => r.projectId === projectId).sort((a, b) => (b.finishedAt ?? b.requestedAt) - (a.finishedAt ?? a.requestedAt));
  }
}

export const state = new OfficeState();
