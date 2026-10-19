import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { qaOfficerFor, randomAvatar } from '../shared/crew';
import type { LedgerEntry, LedgerEvent } from '../shared/ledger';
import { type LedgerHealth, LedgerLog } from './ledgerLog';
import { prKey } from '../shared/qa';
import type { Agent, Board, BrowserFrame, ClosedPr, PluginStates, Project, QaReview, Settings, TermLine } from '../shared/types';
import { ACTIVE_STATUSES, DESKS_PER_ROOM, ROOM_THEMES, type RoomTheme } from '../shared/types';
import { isOneOf } from '../shared/records';
import { config, paths } from './config';
import { takeLock } from './fileLock';
import { fitDesks } from './agents/desks';
import { upgradeLead } from './agents/lead';
import { EMPTY_REVIEW, evolveReview, type ReviewEntry, type ReviewFact, type ReviewState, reviewView } from './agents/reviewJournal';
import { EMPTY_RUN, evolve, type JournalEntry, type RunFact, type RunState, runView } from './agents/runJournal';
import { EMPTY_SLICE, evolveSlice, type SliceFact, type SliceState } from './agents/sliceJournal';
import { Journals, type Stamped } from './journals';
import { EMPTY_PERSONAL_LOG, evolvePersonalLog, type PersonalFact, type PersonalLog } from '../shared/personalLog';
import type { LogSources } from './agents/captainsLog';
import { machineRuns } from './agents/machines';
import type { MachineRun } from '../shared/machines';
import { fromBeforePlugins, type SavedBeforePlugins } from './plugins/migrate';
import { newId } from './util';
import { changeProject } from './projectChange';

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
  /** Each plugin's state, by plugin id: kept while a plugin's switched off, for when it's back. */
  plugins?: PluginStates;
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

/** The personal log's one journal. */
const PERSONAL = 'personal';

/** How many facts of each agent's run journal the demo keeps in memory, for a replay. */
const JOURNAL_MEMORY = 2000;

/** Projects, agents and settings, saved to data/state.json. Terminal output goes to data/logs/<agent>.jsonl. */
export class Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  projects: Project[] = [];
  agents = new Map<string, Agent>();
  boards = new Map<string, Board>();
  private lines = new Map<string, TermLine[]>();
  browser = new Map<string, BrowserFrame>();
  /** Each plugin's own state, by plugin id (`PluginHost.state`, docs/plugins.md). */
  plugins: PluginStates = {};
  /** The latest QA review per pull request (by prKey), as the board shows it: what each review journal adds up to (`reviewJournal`). */
  readonly reviews = new Map<string, QaReview>();
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
  /** Each agent's run journal, by agent id (data/runs/<agent>.jsonl, `journal`). */
  private runs: Journals<RunFact, RunState>;
  /** Each pull request's review journal, by prKey (data/runs/reviews/<pr>.jsonl, `reviewJournal`). */
  private reviewJournals: Journals<ReviewFact, ReviewState>;
  /** Each goal's slice journal, by its lead's id (data/runs/slices/<lead>.jsonl, `sliceJournal`). */
  private slices: Journals<SliceFact, SliceState>;
  /** The captain's personal log, one journal (data/personal-log.jsonl, `shared/personalLog`). */
  private personal: Journals<PersonalFact, PersonalLog>;

  constructor(private readonly persist: boolean) {
    const asIs = (id: string) => id;
    this.runs = new Journals(persist, { dir: paths.runs, name: asIs, key: asIs }, EMPTY_RUN, evolve, JOURNAL_MEMORY);
    this.reviewJournals = new Journals(persist, { dir: path.join(paths.runs, 'reviews'), name: fileKey, key: prKeyOf }, EMPTY_REVIEW, evolveReview, JOURNAL_MEMORY);
    this.slices = new Journals(persist, { dir: path.join(paths.runs, 'slices'), name: asIs, key: asIs }, EMPTY_SLICE, evolveSlice, JOURNAL_MEMORY);
    const personal = path.basename(paths.personalLog, '.jsonl');
    this.personal = new Journals<PersonalFact, PersonalLog>(persist, { dir: path.dirname(paths.personalLog), name: () => personal, key: () => PERSONAL }, EMPTY_PERSONAL_LOG, evolvePersonalLog, JOURNAL_MEMORY);
  }

  /**
   * Reads the saved state. Throws a StateLockedError if another office holds data/state.json: two offices on one data folder each save
   * their own copy over the other's, so a review one finished comes back as the other's older one.
   */
  load(): void {
    if (!this.persist) return;
    fs.mkdirSync(paths.logs, { recursive: true });
    fs.mkdirSync(path.join(paths.runs, 'reviews'), { recursive: true });
    fs.mkdirSync(path.join(paths.runs, 'slices'), { recursive: true });
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
    const raw = JSON.parse(fs.readFileSync(paths.state, 'utf8')) as Partial<PersistedState> & SavedBeforePlugins;
    fromBeforePlugins(raw);
    this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
    this.projects = raw.projects ?? [];
    this.plugins = raw.plugins ?? {};
    // the board's reviews are what their journals add up to; one the board kept before reviews had journals is taken in, once
    for (const key of this.reviewJournals.written(0)) this.showReview(key);
    for (const saved of raw.reviews ?? []) {
      const key = prKey(saved.repo, saved.number);
      if (!this.reviews.has(key) && this.review(key).phase !== 'gone') this.reviewJournal(key, { kind: 'imported', review: saved });
    }
    for (const closed of raw.closedPrs ?? []) this.closedPrs.set(prKey(closed.repo, closed.issue), closed);
    for (const saved of raw.agents ?? []) {
      const agent = agentAfterRestart(saved, this.projects.find((p) => p.id === saved.projectId)?.name ?? 'The project');
      this.agents.set(agent.id, agent);
      this.lines.set(agent.id, this.readLog(agent.id, MEMORY_LINES));
      agent.run = runView(this.runs.state(agent.id));
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
      plugins: this.plugins,
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

  /** The captain's change to a project (any JSON: `changeProject` takes what it gets right), saved. */
  updateProject(id: string, patch: unknown): Project {
    const project = this.project(id);
    Object.assign(project, changeProject(project, patch));
    this.save();
    return project;
  }

  removeProject(id: string): void {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.boards.delete(id);
    for (const review of [...this.reviews.values()]) if (review.projectId === id) this.reviewJournal(prKey(review.repo, review.number), { kind: 'gone', merged: false });
    this.save();
  }

  putClosedPr(closed: ClosedPr): void {
    this.closedPrs.set(prKey(closed.repo, closed.issue), closed);
    this.save();
  }

  removeClosedPr(repo: string, issue: number): void {
    if (this.closedPrs.delete(prKey(repo, issue))) this.save();
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
    // the id may come back (a reopened goal, QA's next review): it starts from nothing, its journal's numbering carrying on
    this.journal(id, { kind: 'reset' });
    this.browser.delete(id);
    this.save();
  }

  // ---- run journals ----

  /**
   * Records a fact in the agent's run journal, and what the run adds up to with it. Saving to disk, it's written and
   * flushed (fsync) before this returns, so whatever the office does next on the strength of it survives a crash.
   */
  journal(id: string, fact: RunFact): RunState {
    const after = this.runs.append(id, fact);
    const agent = this.agents.get(id);
    if (agent) {
      agent.run = runView(after);
      this.save();
      this.journaled?.(agent);
    }
    this.stepped?.(fact.kind === 'decided' ? 'turn' : 'run', id);
    return after;
  }

  /** Told of each agent whose run moved on: the office sends them to every browser. */
  journaled?: (agent: Agent) => void;

  /** Told of each journal that stepped its machine (`server/agents/machines.ts`), by the machine's id and the run's key. */
  stepped?: (machine: string, key: string) => void;

  /** Where every run of each of the office's machines is now (`machineRuns`). */
  machineRuns(): MachineRun[] {
    return machineRuns({
      agents: [...this.agents.values()],
      projects: this.projects,
      slice: (leadId) => this.slices.state(leadId),
      reviews: [...this.reviews.keys()].map((key) => ({ key, ...this.reviewJournals.state(key) })),
    });
  }

  /** The agent's run journal, oldest first: its file, or what's kept of it in memory. */
  journalEntries(id: string): JournalEntry[] {
    return this.runs.entries(id);
  }

  /** What the agent's run journal adds up to (an agent not saved when the office started, a goal reopened since, may have one already). */
  run(id: string): RunState {
    return this.runs.state(id);
  }

  // ---- review journals ----

  /** Records a fact in a pull request's review journal (`key` its prKey), flushed before this returns, and what the review adds up to with it. */
  reviewJournal(key: string, fact: ReviewFact): ReviewState {
    const after = this.reviewJournals.append(key, fact);
    this.showReview(key);
    this.stepped?.('review', key);
    return after;
  }

  /** The board's review of a pull request, as its journal has it now (none once it's gone), and its screenshots kept with it. */
  private showReview(key: string): void {
    const view = reviewView(this.review(key));
    this.dropShots(this.reviews.get(key), view);
    if (view) this.reviews.set(key, view);
    else this.reviews.delete(key);
  }

  /** What a pull request's review journal adds up to. */
  review(key: string): ReviewState {
    return this.reviewJournals.state(key);
  }

  /** A pull request's review journal, oldest first. */
  reviewEntries(key: string): ReviewEntry[] {
    return this.reviewJournals.entries(key);
  }

  // ---- slice journals ----

  /** Records a fact in a goal's slice journal (`id` its lead's), flushed before this returns, and what its slices add up to with it. */
  sliceJournal(id: string, fact: SliceFact): SliceState {
    const after = this.slices.append(id, fact);
    this.stepped?.('slice', id);
    return after;
  }

  /** What a goal's slice journal adds up to. */
  slice(id: string): SliceState {
    return this.slices.state(id);
  }

  /** A goal's slice journal, oldest first. */
  sliceEntries(id: string): Stamped<SliceFact>[] {
    return this.slices.entries(id);
  }

  // ---- the captain's personal log ----

  /** Records a fact in the captain's personal log, flushed before this returns, and what the log adds up to with it. */
  personalLog(fact: PersonalFact): PersonalLog {
    return this.personal.append(PERSONAL, fact);
  }

  /** What the captain's personal log adds up to. */
  get personalEntries(): PersonalLog['entries'] {
    return this.personal.state(PERSONAL).entries;
  }

  // ---- the captain's log ----

  /**
   * What the captain's log is made of since `since` (`captainsLog`): every journal written to since, with who and what
   * it's about (a crew member who's gone home is named from the ledger, where their sessions and goals were kept), and
   * the ledger.
   */
  logSources(since: number): LogSources {
    const names = new Map<string, string>();
    const goals = new Map<string, { title: string; projectId: string }>();
    for (const e of this.ledger) {
      if (e.kind === 'session-digest') names.set(e.agentId, e.agent);
      if (e.kind === 'goal-closed') {
        names.set(e.goal.id, e.goal.leadName);
        goals.set(e.goal.id, { title: e.goal.title, projectId: e.projectId });
      }
    }
    for (const a of this.agents.values()) {
      names.set(a.id, a.name);
      if (a.lead) goals.set(a.id, { title: a.lead.title, projectId: a.projectId });
    }
    const nameOf = (id: string) => names.get(id);
    const roomOf = (repo: string) => this.projects.find((p) => p.repos.includes(repo))?.id;
    const leadOf = (repo: string, number: number) => [...this.agents.values()].find((a) => a.lead?.prs.some((p) => p.repo === repo && p.number === number));
    const about = (o: { projectId?: string; goal?: string; agentId?: string }) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    return {
      runs: this.runs.written(since).map((id) => {
        const a = this.agents.get(id);
        const goal = goals.get(a?.reviewFor ?? id);
        return { key: id, who: nameOf(id) ?? 'A crew member who’s gone home', ...about({ agentId: id, projectId: a?.projectId ?? goal?.projectId, goal: goal?.title }), entries: this.runs.entries(id) };
      }),
      reviews: this.reviewJournals.written(since).map((key) => {
        const [repo, number] = [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))];
        return { key, who: 'QA', ...about({ projectId: roomOf(repo), goal: leadOf(repo, number)?.lead?.title }), entries: this.reviewJournals.entries(key) };
      }),
      slices: this.slices.written(since).map((id) => {
        const goal = goals.get(id);
        return { key: id, who: nameOf(id) ?? 'A lead who’s gone home', ...about({ agentId: id, projectId: goal?.projectId, goal: goal?.title }), entries: this.slices.entries(id) };
      }),
      ledger: this.ledger,
      nameOf,
    };
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
  return isOneOf(ROOM_THEMES, value);
}

/** `owner/repo#12` → `owner__repo-12`: a pull request's key as a file name. */
export function fileKey(key: string): string {
  return key.replace('/', '__').replace('#', '-').replace(/[^A-Za-z0-9_.-]/g, '_');
}

/** `owner__repo-12` → `owner/repo#12`: a review journal's file name as its pull request's key (GitHub owners have no underscores). */
export function prKeyOf(name: string): string {
  return name.replace('__', '/').replace(/-(\d+)$/, '#$1');
}
