import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Board, BrowserFrame, Project, Settings, TermLine } from '../shared/types';
import { ACTIVE_STATUSES, DESKS_PER_ROOM } from '../shared/types';
import { paths } from './config';
import { newId } from './util';

interface PersistedState {
  settings: Settings;
  projects: Project[];
  agents: Agent[];
}

const DEFAULT_SETTINGS: Settings = {
  maxConcurrent: 4,
  autonomy: 'ask',
  model: '',
  mergeMethod: 'squash',
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
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly persist: boolean) {}

  load(): void {
    if (!this.persist) return;
    fs.mkdirSync(paths.logs, { recursive: true });
    if (!fs.existsSync(paths.state)) return;
    const raw = JSON.parse(fs.readFileSync(paths.state, 'utf8')) as Partial<PersistedState>;
    this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
    this.projects = raw.projects ?? [];
    for (const agent of raw.agents ?? []) {
      if (ACTIVE_STATUSES.includes(agent.status) || agent.status === 'queued') {
        agent.status = 'stopped';
        agent.activity = 'Interrupted when the office closed. Send a message to pick it back up.';
        agent.permission = undefined;
      }
      this.agents.set(agent.id, agent);
      this.lines.set(agent.id, this.readLog(agent.id, MEMORY_LINES));
    }
  }

  save(): void {
    if (!this.persist) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const state: PersistedState = { settings: this.settings, projects: this.projects, agents: [...this.agents.values()] };
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

  addProject(name: string, color?: string): Project {
    const project: Project = {
      id: newId('proj'),
      name: name.trim() || 'Untitled project',
      color: color || PROJECT_COLORS[this.projects.length % PROJECT_COLORS.length],
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

  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'maxAgents' | 'autoAssign' | 'autoLabel' | 'onlyMyPrs'>>): Project {
    const project = this.project(id);
    if (patch.name !== undefined) project.name = patch.name.trim() || project.name;
    if (patch.color !== undefined) project.color = patch.color;
    if (patch.maxAgents !== undefined) project.maxAgents = Math.max(1, Math.min(DESKS_PER_ROOM, Math.round(patch.maxAgents)));
    if (patch.autoAssign !== undefined) project.autoAssign = patch.autoAssign;
    if (patch.autoLabel !== undefined) project.autoLabel = patch.autoLabel.trim();
    if (patch.onlyMyPrs !== undefined) project.onlyMyPrs = !!patch.onlyMyPrs;
    this.save();
    return project;
  }

  removeProject(id: string): void {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.boards.delete(id);
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
