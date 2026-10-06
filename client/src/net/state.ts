import { prKey } from '../../../shared/qa';
import type { Agent, Board, BrowserFrame, IssueDraft, NumberOneChat, QaReview, Preview, Project, ServerEvent, ServerInfo, TermLine, VoiceStatus } from '../../../shared/types';

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
  /** A QA review changed or went away (its project id). */
  review: string;
  voice: void;
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
  /** The latest QA review per pull request (by prKey). */
  reviews = new Map<string, QaReview>();
  /** Whether dictation can run on the server, and the speech model's download. */
  voice: VoiceStatus | null = null;
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
        this.voice = s.voice;
        this.emit('snapshot', undefined);
        this.emit('voice', undefined);
        this.emit('number-one', undefined);
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
        this.agents.set(event.agent.id, event.agent);
        this.emit('agent', event.agent);
        break;
      case 'agent-removed': {
        const agent = this.agents.get(event.id);
        this.agents.delete(event.id);
        this.lines.delete(event.id);
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
        break;
      case 'number-one':
        this.numberOne = event.chat;
        this.emit('number-one', undefined);
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

  agentsIn(projectId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.projectId === projectId);
  }

  /** The room's QA officer's agent record, while they have one. */
  qaAgent(projectId: string): Agent | undefined {
    return this.agentsIn(projectId).find((a) => a.task === 'review');
  }

  reviewsIn(projectId: string): QaReview[] {
    return [...this.reviews.values()].filter((r) => r.projectId === projectId).sort((a, b) => (b.finishedAt ?? b.requestedAt) - (a.finishedAt ?? a.requestedAt));
  }
}

export const state = new OfficeState();
