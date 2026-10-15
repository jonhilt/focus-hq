import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { qaOfficerFor, randomAvatar } from '../shared/crew';
import type { LedgerEntry, LedgerEvent } from '../shared/ledger';
import { type LedgerHealth, LedgerLog } from './ledgerLog';
import { olderVerdict, prKey } from '../shared/qa';
import type { Agent, Board, BrowserFrame, Climb, ClosedPr, MergeMethod, NumberOneChat, Project, QaReview, Retro, Settings, StudioSession, TermLine } from '../shared/types';
import { ACTIVE_STATUSES, DESKS_PER_ROOM, EFFORT_LEVELS, freshClimb, MERGE_METHODS, ROOM_THEMES, type RoomTheme } from '../shared/types';
import { config, paths } from './config';
import { takeLock } from './fileLock';
import { fitDesks } from './agents/desks';
import { upgradeLead } from './agents/lead';
import { newId } from './util';

/** Number One's chat as saved: with their session, so the next message resumes it. */
export type StoredNumberOne = NumberOneChat & { sessionId?: string };

export const freshRetro = (): Retro => ({ status: 'idle', activity: '', days: 14, sessions: 0, drafts: [], watch: [], costUsd: 0 });

/** The latest retro as it picks up after a restart: one under way when Focus shut down ends, so another can start. */
export function retroAfterRestart(saved: Retro): Retro {
  // a retro saved before drafts replaced proposals has none
  saved = { ...saved, drafts: saved.drafts ?? [], watch: saved.watch ?? [] };
  if (saved.status !== 'gathering' && saved.status !== 'thinking') return saved;
  return { ...saved, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Start it again.' };
}

export const freshNumberOne = (): StoredNumberOne => ({ status: 'waiting', activity: '', messages: [], updatedAt: Date.now(), costUsd: 0 });

export type StoredStudio = StudioSession & { sessionId?: string };
export const freshStudio = (): StoredStudio => ({ status: 'waiting', activity: '', messages: [], takes: [], updatedAt: Date.now(), costUsd: 0 });

/** The studio's saved conversation as it picks up after a restart: a turn in flight when Focus shut down ends. */
export function studioAfterRestart(saved: StoredStudio): StoredStudio {
  if (saved.status !== 'thinking') return saved;
  return { ...saved, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Say it again.' };
}

/** Number One's saved chat as it picks up after a restart: a turn in flight when Focus shut down ends, and the chat stays usable. */
export function numberOneAfterRestart(saved: StoredNumberOne): StoredNumberOne {
  if (saved.status !== 'thinking') return saved;
  return { ...saved, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Ask again.' };
}

/** A QA review as it picks up after a restart: one queued or under way ends, and a PR the operations officer was looking at goes to the captain. */
export function reviewAfterRestart(saved: QaReview): QaReview {
  let review = saved;
  if (review.status === 'queued' || review.status === 'testing') {
    review = { ...review, status: 'error', error: 'Interrupted when Focus shut down. Send it to QA again.' };
  }
  if (review.followUp?.kind === 'triaging') {
    review = { ...review, followUp: { kind: 'needs-you', reason: `${review.followUp.officer} was looking at it when Focus shut down` } };
  }
  return review;
}

/**
 * An agent as they pick up after a restart (`projectName` is their room's, for a lead saved before team stations): whoever was at
 * work stops, and waits for a message; what doesn't outlive the office (a lead's subagents, workflows and background work, a hold
 * for the plan's usage limit) goes; and one saved before a field existed gets it.
 */
export function agentAfterRestart(saved: Agent, projectName: string): Agent {
  let agent: Agent = { ...saved, task: saved.task ?? 'issue', helpers: undefined, workflows: undefined, background: undefined };
  if (agent.handover) {
    // still waiting for the captain to start their cloud session; a terminal opened before isn't watched any more
    agent = { ...agent, status: 'waiting', activity: 'Waiting for a cloud session', handover: { ...agent.handover, terminalAt: undefined } };
  } else if (ACTIVE_STATUSES.includes(agent.status) || agent.status === 'queued') {
    agent = { ...agent, status: 'stopped', activity: 'Interrupted when Focus shut down. Send a message to pick it back up.', permission: undefined };
  }
  if (agent.held) {
    // whatever waited for your plan's limit to reset waits for the captain now
    agent = { ...agent, held: undefined, activity: 'Was waiting for your plan’s usage limit when Focus shut down. Send a message to pick it back up.' };
  }
  agent = upgradeLead(agent, projectName);
  // saved before the crew wore uniforms
  if (!('division' in agent.avatar)) agent = { ...agent, avatar: agent.task === 'review' ? qaOfficerFor(agent.projectId).avatar : randomAvatar() };
  return agent;
}

interface PersistedState {
  settings: Settings;
  projects: Project[];
  agents: Agent[];
  numberOne?: StoredNumberOne;
  studio?: StoredStudio;
  retro?: Retro;
  climb?: Climb;
  reviews?: QaReview[];
  closedPrs?: ClosedPr[];
}

const DEFAULT_SETTINGS: Settings = {
  maxConcurrent: 4,
  autonomy: 'ask',
  model: '',
  conflictsModel: '',
  qaModel: '',
  mergeMethod: 'squash',
  attribution: true,
  userClaudeMd: true,
  leadEffort: 'high',
};

const PROJECT_COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#c879ff', '#fde74c', '#ff5d8f', '#2ec4b6', '#f4a259'];

const MEMORY_LINES = 400;

/** Projects, agents and settings, saved to data/state.json. Terminal output goes to data/logs/<agent>.jsonl. */
export class Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  projects: Project[] = [];
  agents = new Map<string, Agent>();
  boards = new Map<string, Board>();
  private lines = new Map<string, TermLine[]>();
  browser = new Map<string, BrowserFrame>();
  /** The captain's chat with Number One. */
  numberOne: StoredNumberOne = freshNumberOne();
  studio: StoredStudio = freshStudio();
  /** The chief engineer's latest retro. */
  retro: Retro = freshRetro();
  /** Main engineering's climber: the captain's switch and the climb under way. */
  climb: Climb = freshClimb();
  /** The latest QA review per pull request (by prKey). */
  reviews = new Map<string, QaReview>();
  /** PRs the operations officer closed as the wrong approach, by prKey of the issue they were for. */
  closedPrs = new Map<string, ClosedPr>();
  /** The ship's log of how work went, oldest first: data/ledger.jsonl, appended to as it grows. */
  ledger: LedgerEvent[] = [];
  /** What opening the ledger repaired or found wrong. */
  ledgerHealth: LedgerHealth = { repaired: [], problems: [], notes: [] };
  /** Its one writer, when saving to disk. */
  private ledgerLog: LedgerLog | null = null;
  /** QA screenshots by file name, when not persisting (demo). */
  private shots = new Map<string, Buffer>();
  /** Artifacts' pages and pictures when nothing's saved to disk, by `<lead id>/<file>`. */
  private artifacts = new Map<string, Buffer>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly persist: boolean) {}

  /**
   * Reads the saved state. Throws a StateLockedError if another office holds data/state.json: two offices on one data folder each save
   * their own copy over the other's, so a review one finished comes back as the other's older one.
   */
  load(): void {
    if (!this.persist) return;
    fs.mkdirSync(paths.logs, { recursive: true });
    const holder = takeLock(`${paths.state}.lock`);
    if (holder) throw new StateLockedError(holder, config.dataDir);
    // what changed in the last moments before exiting is saved too, before the lock goes
    process.prependListener('exit', () => this.flush());
    const opened = LedgerLog.open(paths.ledger);
    this.ledgerLog = opened.log;
    this.ledger = opened.events;
    this.ledgerHealth = opened.health;
    for (const line of [...opened.health.repaired, ...opened.health.problems, ...opened.health.notes]) console.warn(`Ledger: ${line}`);
    if (!fs.existsSync(paths.state)) return;
    const raw = JSON.parse(fs.readFileSync(paths.state, 'utf8')) as Partial<PersistedState>;
    this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
    this.projects = raw.projects ?? [];
    if (raw.numberOne) this.numberOne = numberOneAfterRestart(raw.numberOne);
    if (raw.studio) this.studio = studioAfterRestart(raw.studio);
    if (raw.retro) this.retro = retroAfterRestart(raw.retro);
    if (raw.climb) this.climb = { ...freshClimb(), ...raw.climb };
    for (const saved of raw.reviews ?? []) {
      const review = reviewAfterRestart(saved);
      this.reviews.set(prKey(review.repo, review.number), review);
    }
    for (const closed of raw.closedPrs ?? []) this.closedPrs.set(prKey(closed.repo, closed.issue), closed);
    for (const saved of raw.agents ?? []) {
      const agent = agentAfterRestart(saved, this.projects.find((p) => p.id === saved.projectId)?.name ?? 'The project');
      this.agents.set(agent.id, agent);
      this.lines.set(agent.id, this.readLog(agent.id, MEMORY_LINES));
    }
    // rooms had six desks before team stations: anyone at a desk that's gone takes a free one, or waits off the floor
    for (const [id, desk] of fitDesks([...this.agents.values()])) {
      const agent = this.agents.get(id);
      if (agent) agent.desk = desk;
    }
    for (const project of this.projects) project.maxAgents = Math.min(project.maxAgents, DESKS_PER_ROOM);
  }

  /** Saves soon: changes that come close together are written once. */
  save(): void {
    if (!this.persist) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  /** Writes a save that's waiting, now. */
  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const state: PersistedState = {
      settings: this.settings,
      projects: this.projects,
      agents: [...this.agents.values()],
      numberOne: this.numberOne,
      studio: this.studio,
      retro: this.retro,
      climb: this.climb,
      reviews: [...this.reviews.values()],
      closedPrs: [...this.closedPrs.values()],
    };
    fs.mkdirSync(path.dirname(paths.state), { recursive: true });
    const tmp = `${paths.state}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, paths.state);
  }

  // ---- projects ----

  project(id: string): Project {
    const project = this.projects.find((p) => p.id === id);
    if (!project) throw new Error(`Unknown project ${id}`);
    return project;
  }

  addProject(name: string, color?: string, theme?: RoomTheme): Project {
    const project: Project = {
      id: newId('proj'),
      name: name.trim() || 'Untitled project',
      color: color || PROJECT_COLORS[this.projects.length % PROJECT_COLORS.length],
      theme: isTheme(theme) ? theme : this.nextTheme(),
      repos: [],
      maxAgents: DESKS_PER_ROOM,
      autoAssign: false,
      autoLabel: '',
      createdAt: Date.now(),
    };
    this.projects.push(project);
    this.save();
    return project;
  }

  /** The first landscape no room uses yet, so new rooms don't repeat while there are fresh ones. */
  private nextTheme(): RoomTheme {
    const scenic = ROOM_THEMES.filter((t) => t !== 'office');
    const used = new Set(this.projects.map((p) => p.theme));
    return scenic.find((t) => !used.has(t)) ?? scenic[this.projects.length % scenic.length];
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'color' | 'theme' | 'maxAgents' | 'autoAssign' | 'autoLabel' | 'onlyMyPrs' | 'preview' | 'autoQa' | 'autoSendBack' | 'autoMerge' | 'qaBrief' | 'qaEffort' | 'hidden'>> & { mergeMethod?: { repo: string; method: MergeMethod | '' } },
  ): Project {
    const project = this.project(id);
    // checked before anything changes, so a refused patch leaves the project as it was
    if (patch.mergeMethod && !project.repos.includes(patch.mergeMethod.repo)) throw new Error(`${patch.mergeMethod.repo} isn’t connected to ${project.name}`);
    if (patch.name !== undefined) project.name = patch.name.trim() || project.name;
    if (patch.color !== undefined) project.color = patch.color;
    if (patch.theme !== undefined) {
      if (!isTheme(patch.theme)) throw new Error(`Unknown room theme ${String(patch.theme)}`);
      project.theme = patch.theme;
    }
    if (patch.maxAgents !== undefined) project.maxAgents = Math.max(1, Math.min(DESKS_PER_ROOM, Math.round(patch.maxAgents)));
    if (patch.autoAssign !== undefined) project.autoAssign = patch.autoAssign;
    if (patch.autoQa !== undefined) project.autoQa = patch.autoQa === true;
    if (patch.autoSendBack !== undefined) project.autoSendBack = patch.autoSendBack === true;
    if (patch.autoMerge !== undefined) project.autoMerge = patch.autoMerge === true;
    if (patch.qaBrief !== undefined) project.qaBrief = String(patch.qaBrief).slice(0, 4000);
    // an empty choice goes back to the model's default
    if (patch.qaEffort !== undefined) project.qaEffort = EFFORT_LEVELS.find((e) => e === patch.qaEffort);
    if (patch.autoLabel !== undefined) project.autoLabel = patch.autoLabel.trim();
    if (patch.onlyMyPrs !== undefined) project.onlyMyPrs = !!patch.onlyMyPrs;
    if (patch.hidden !== undefined) project.hidden = patch.hidden === true;
    if (patch.mergeMethod !== undefined) {
      const { repo, method } = patch.mergeMethod;
      // an empty (or unknown) choice goes back to the office-wide setting
      const { [repo]: _, ...rest } = project.mergeMethods ?? {};
      const chosen = MERGE_METHODS.find((m) => m === method);
      project.mergeMethods = chosen ? { ...rest, [repo]: chosen } : rest;
    }
    if (patch.preview !== undefined) {
      const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      const p = patch.preview ?? {};
      project.preview = { command: text(p.command), stopCommand: text(p.stopCommand), statusCommand: text(p.statusCommand) };
    }
    this.save();
    return project;
  }

  removeProject(id: string): void {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.boards.delete(id);
    for (const review of [...this.reviews.values()]) if (review.projectId === id) this.removeReview(review.repo, review.number);
    this.save();
  }

  /** Keeps `review`, unless it's an older copy that would put back a verdict QA has since replaced: false then. */
  putReview(review: QaReview): boolean {
    const key = prKey(review.repo, review.number);
    const current = this.reviews.get(key);
    if (current && olderVerdict(current, review)) {
      console.warn(`Not putting back QA's older verdict on ${key} (${review.status} at ${review.sha?.slice(0, 7)}): it has since ${current.status} ${current.sha?.slice(0, 7)}`);
      return false;
    }
    this.dropShots(current, review);
    this.reviews.set(key, review);
    this.save();
    return true;
  }

  putClosedPr(closed: ClosedPr): void {
    this.closedPrs.set(prKey(closed.repo, closed.issue), closed);
    this.save();
  }

  removeClosedPr(repo: string, issue: number): void {
    if (this.closedPrs.delete(prKey(repo, issue))) this.save();
  }

  removeReview(repo: string, number: number): boolean {
    const key = prKey(repo, number);
    this.dropShots(this.reviews.get(key));
    const removed = this.reviews.delete(key);
    if (removed) this.save();
    return removed;
  }

  // ---- the ledger ----

  /** Numbers the event and appends it: on disk, flushed before this returns, when saving to disk. */
  record(entry: LedgerEntry & { at: number; projectId: string }): LedgerEvent {
    const event = this.ledgerLog?.append(entry) ?? ({ ...entry, seq: (this.ledger.at(-1)?.seq ?? 0) + 1 });
    this.ledger.push(event);
    return event;
  }

  // ---- QA screenshots ----

  saveShot(file: string, bytes: Buffer): void {
    if (!this.persist) {
      this.shots.set(file, bytes);
      return;
    }
    fs.mkdirSync(paths.qaShots, { recursive: true });
    fs.writeFileSync(path.join(paths.qaShots, file), bytes);
  }

  async readShot(file: string): Promise<Buffer | undefined> {
    if (!this.persist) return this.shots.get(file);
    return fsp.readFile(path.join(paths.qaShots, file)).catch(() => undefined);
  }

  /** Deletes the screenshots of a review that its replacement no longer shows. */
  private dropShots(old: QaReview | undefined, replacement?: QaReview): void {
    const keep = new Set(replacement?.screenshots?.map((s) => s.file));
    for (const { file } of old?.screenshots ?? []) {
      if (keep.has(file)) continue;
      this.shots.delete(file);
      if (this.persist) fs.rm(path.join(paths.qaShots, file), { force: true }, () => undefined);
    }
  }

  // ---- goals' artifacts ----

  saveArtifact(leadId: string, file: string, bytes: Buffer): void {
    if (!this.persist) {
      this.artifacts.set(`${leadId}/${file}`, bytes);
      return;
    }
    fs.mkdirSync(path.join(paths.artifacts, leadId), { recursive: true });
    fs.writeFileSync(path.join(paths.artifacts, leadId, file), bytes);
  }

  /** Callers check `leadId` and `file` are plain names: they become a path. */
  async readArtifact(leadId: string, file: string): Promise<Buffer | undefined> {
    if (!this.persist) return this.artifacts.get(`${leadId}/${file}`);
    return fsp.readFile(path.join(paths.artifacts, leadId, file)).catch(() => undefined);
  }

  deleteArtifact(leadId: string, file: string): void {
    this.artifacts.delete(`${leadId}/${file}`);
    if (this.persist) fs.rm(path.join(paths.artifacts, leadId, file), { force: true }, () => undefined);
  }

  // ---- agents ----

  agent(id: string): Agent {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Unknown agent ${id}`);
    return agent;
  }

  agentsIn(projectId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.projectId === projectId);
  }

  putAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.save();
  }

  removeAgent(id: string): void {
    this.agents.delete(id);
    this.lines.delete(id);
    this.browser.delete(id);
    this.save();
  }

  // ---- terminal output ----

  /** `persist` false keeps them in memory only, like a lead's helpers' transcripts, which go when the helper does. */
  appendLines(id: string, lines: TermLine[], persist = true): void {
    const buffer = this.lines.get(id) ?? [];
    buffer.push(...lines);
    if (buffer.length > MEMORY_LINES) buffer.splice(0, buffer.length - MEMORY_LINES);
    this.lines.set(id, buffer);
    if (this.persist && persist) {
      fs.appendFile(path.join(paths.logs, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', () => undefined);
    }
  }

  dropLines(id: string): void {
    this.lines.delete(id);
  }

  recentLines(id: string, count = 80): TermLine[] {
    return (this.lines.get(id) ?? []).slice(-count);
  }

  async allLines(id: string): Promise<TermLine[]> {
    if (!this.persist) return this.lines.get(id) ?? [];
    try {
      await fsp.access(path.join(paths.logs, `${id}.jsonl`));
    } catch {
      return this.lines.get(id) ?? [];
    }
    return this.readLog(id, 5000);
  }

  private readLog(id: string, max: number): TermLine[] {
    try {
      const text = fs.readFileSync(path.join(paths.logs, `${id}.jsonl`), 'utf8');
      return text
        .split('\n')
        .filter(Boolean)
        .slice(-max)
        .map((l) => JSON.parse(l) as TermLine);
    } catch {
      return [];
    }
  }
}

/** Why the office won't open a data folder another office is using, and what to do instead. */
/** Another live office holds the data folder: an expected refusal, which the office reports in a line, not a crash. */
export class StateLockedError extends Error {
  constructor(
    readonly pid: number,
    readonly dataDir: string,
  ) {
    super(stateLocked(pid, dataDir));
    this.name = 'StateLockedError';
  }
}

export function stateLocked(pid: number, dataDir: string): string {
  return `Another Focus office (pid ${pid}) is using ${dataDir}. Stop it first, or give this one a data folder of its own (FOCUS_DATA_DIR=<empty folder>), or run pnpm run demo, which saves nothing.`;
}

function isTheme(value: unknown): value is RoomTheme {
  return typeof value === 'string' && (ROOM_THEMES as readonly string[]).includes(value);
}
