import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { qaOfficerFor, randomAvatar } from '../shared/crew';
import { prKey } from '../shared/qa';
import type { Agent, Board, Briefing, BrowserFrame, ClosedPr, Project, QaReview, Settings, TermLine } from '../shared/types';
import { ACTIVE_STATUSES, DESKS_PER_ROOM, EMPTY_BRIEF, ROOM_THEMES, type RoomTheme } from '../shared/types';
import { paths } from './config';
import { newId } from './util';

/** A briefing as saved: with the officer's, QA's and the engineer's sessions, so the next turn can resume them. */
export type StoredBriefing = Briefing & { sessionId?: string; qaSessionId?: string; engineerSessionId?: string };

/** A saved briefing as it picks up after a restart: whatever was running when Focus shut down was interrupted. */
export function afterRestart(saved: StoredBriefing): StoredBriefing {
  // briefings saved before a field was added to the brief get its empty value
  const briefing = { ...saved, brief: { ...EMPTY_BRIEF, ...saved.brief } };
  switch (briefing.status) {
    case 'thinking':
    case 'wrapping-up':
      return { ...briefing, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Say something to pick it back up.' };
    case 'qa-checking':
      // the officer's reply is saved; only QA's note was lost
      return { ...briefing, status: 'waiting', activity: 'Waiting for you' };
    case 'engineering':
      return {
        ...briefing,
        status: 'waiting',
        activity: 'Waiting for you',
        messages: [...briefing.messages, { from: 'system', text: 'Engineering was interrupted when Focus shut down. Ask again.', at: Date.now() }],
      };
    case 'filing':
      // a goal's epic kept its number, so filing the step again doesn't file the goal twice
      if (briefing.goal) return { ...briefing, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down while filing the step. File it again to carry on.' };
      // whatever was filed kept its number, so filing again carries on
      return { ...briefing, status: 'reviewing', activity: 'Waiting for you to file the breakdown', error: 'Interrupted when Focus shut down. File all again to carry on.' };
    case 'waiting':
    case 'failed':
    case 'reviewing':
    case 'done':
    case 'parked':
      return briefing;
  }
}

interface PersistedState {
  settings: Settings;
  projects: Project[];
  agents: Agent[];
  briefing?: StoredBriefing | null;
  goals?: StoredBriefing[];
  reviews?: QaReview[];
  closedPrs?: ClosedPr[];
}

const DEFAULT_SETTINGS: Settings = {
  maxConcurrent: 4,
  autonomy: 'ask',
  model: '',
  mergeMethod: 'squash',
  attribution: true,
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
  /** The briefing in the observation lounge, if one is in session. */
  briefing: StoredBriefing | null = null;
  /** Goals parked out of the lounge while the crew builds their current step. */
  goals: StoredBriefing[] = [];
  /** The latest QA review per pull request (by prKey). */
  reviews = new Map<string, QaReview>();
  /** PRs the operations officer closed as the wrong approach, by prKey of the issue they were for. */
  closedPrs = new Map<string, ClosedPr>();
  /** QA screenshots by file name, when not persisting (demo). */
  private shots = new Map<string, Buffer>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly persist: boolean) {}

  load(): void {
    if (!this.persist) return;
    fs.mkdirSync(paths.logs, { recursive: true });
    if (!fs.existsSync(paths.state)) return;
    const raw = JSON.parse(fs.readFileSync(paths.state, 'utf8')) as Partial<PersistedState>;
    this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
    this.projects = raw.projects ?? [];
    this.briefing = raw.briefing ? afterRestart(raw.briefing) : null;
    this.goals = (raw.goals ?? []).map(afterRestart);
    for (const review of raw.reviews ?? []) {
      if (review.status === 'queued' || review.status === 'testing') {
        Object.assign(review, { status: 'error', error: 'Interrupted when Focus shut down. Send it to QA again.' });
      }
      if (review.followUp?.kind === 'triaging') {
        review.followUp = { kind: 'needs-you', reason: `${review.followUp.officer} was looking at it when Focus shut down` };
      }
      this.reviews.set(prKey(review.repo, review.number), review);
    }
    for (const closed of raw.closedPrs ?? []) this.closedPrs.set(prKey(closed.repo, closed.issue), closed);
    for (const agent of raw.agents ?? []) {
      if (ACTIVE_STATUSES.includes(agent.status) || agent.status === 'queued') {
        agent.status = 'stopped';
        agent.activity = 'Interrupted when Focus shut down. Send a message to pick it back up.';
        agent.permission = undefined;
      }
      agent.task ??= 'issue'; // saved before agents could be seated on a conflicting PR
      // saved before the crew wore uniforms
      if (!('division' in agent.avatar)) agent.avatar = agent.task === 'review' ? qaOfficerFor(agent.projectId).avatar : randomAvatar();
      this.agents.set(agent.id, agent);
      this.lines.set(agent.id, this.readLog(agent.id, MEMORY_LINES));
    }
  }

  save(): void {
    if (!this.persist) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const state: PersistedState = {
        settings: this.settings,
        projects: this.projects,
        agents: [...this.agents.values()],
        briefing: this.briefing,
        goals: this.goals,
        reviews: [...this.reviews.values()],
        closedPrs: [...this.closedPrs.values()],
      };
      fs.mkdirSync(path.dirname(paths.state), { recursive: true });
      const tmp = `${paths.state}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, paths.state);
    }, 250);
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
      maxAgents: 3,
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
    patch: Partial<Pick<Project, 'name' | 'color' | 'theme' | 'maxAgents' | 'autoAssign' | 'autoLabel' | 'onlyMyPrs' | 'preview' | 'autoQa' | 'autoSendBack' | 'autoMerge' | 'qaBrief'>>,
  ): Project {
    const project = this.project(id);
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
    if (patch.autoLabel !== undefined) project.autoLabel = patch.autoLabel.trim();
    if (patch.onlyMyPrs !== undefined) project.onlyMyPrs = !!patch.onlyMyPrs;
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

  putReview(review: QaReview): void {
    const key = prKey(review.repo, review.number);
    this.dropShots(this.reviews.get(key), review);
    this.reviews.set(key, review);
    this.save();
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

  setBriefing(briefing: StoredBriefing | null): void {
    this.briefing = briefing;
    this.save();
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

  appendLines(id: string, lines: TermLine[]): void {
    const buffer = this.lines.get(id) ?? [];
    buffer.push(...lines);
    if (buffer.length > MEMORY_LINES) buffer.splice(0, buffer.length - MEMORY_LINES);
    this.lines.set(id, buffer);
    if (this.persist) {
      fs.appendFile(path.join(paths.logs, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', () => undefined);
    }
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

function isTheme(value: unknown): value is RoomTheme {
  return typeof value === 'string' && (ROOM_THEMES as readonly string[]).includes(value);
}
