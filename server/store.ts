import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomAvatar } from '../shared/crew';
import type { LedgerEntry, LedgerEvent } from '../shared/ledger';
import { type LedgerHealth, LedgerLog } from './ledgerLog';
import { prKey } from '../shared/qa';
import type { Agent, Board, BrowserFrame, ClosedPr, PluginStates, Project, QaReview, Settings, TermLine } from '../shared/types';
import { DESKS_PER_ROOM, ROOM_THEMES, type RoomTheme } from '../shared/types';
import { isOneOf } from '../shared/records';
import { config, paths } from './config';
import { takeLock } from './fileLock';
import { fitDesks } from './agents/deskRules';
import { EMPTY_REVIEW, evolveReview, type ReviewEntry, type ReviewFact, type ReviewState, reviewView } from './agents/reviewJournal';
import { EMPTY_RUN, evolve, type JournalEntry, type RunFact, type RunState, runView } from './agents/runJournal';
import { Journals } from './journals';
import { EMPTY_PERSONAL_LOG, evolvePersonalLog, type PersonalFact, type PersonalLog } from '../shared/personalLog';
import { machinePath, machineRuns } from './agents/machines';
import type { MachineRun, MachineStep } from '../shared/machines';
import type { LentJournals } from './plugins/contract';
import { fromBeforePlugins, type SavedBeforePlugins } from './plugins/migrate';
import { fileIn, newId } from './util';
import { changeProject } from './projectChange';
import { agentAfterRestart } from './agentRestartRules';

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
  codexModel: '',
  mergeMethod: 'squash',
  attribution: true,
  userClaudeMd: true,
  leadEffort: 'high',
  leadCompactAt: 200_000,
};

const PROJECT_COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#c879ff', '#fde74c', '#ff5d8f', '#2ec4b6', '#f4a259'];

const MEMORY_LINES = 400;

/** The personal log's one journal. */
const PERSONAL = 'personal';

/** How many facts of each agent's run journal the demo keeps in memory, for a replay. */
const JOURNAL_MEMORY = 2000;

/** Projects, agents and settings, saved to data/state.json. Terminal output goes to data/logs/<agent>.jsonl. */
export class Store {
  /** The captain's settings: one object for Focus's life, so what holds it sees each change (`replaceSettings`). */
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
  /** Each review's board view and the verdict a precheck can put back: the reviews whose files Ops keeps. */
  private readonly keptReviews = new Map<string, (QaReview | undefined)[]>();
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
  /** The captain's personal log, one journal (data/personal-log.jsonl, `shared/personalLog`). */
  private personal: Journals<PersonalFact, PersonalLog>;

  constructor(private readonly persist: boolean) {
    const asIs = (id: string) => id;
    this.runs = new Journals(persist, { dir: paths.runs, name: asIs, key: asIs }, EMPTY_RUN, evolve, JOURNAL_MEMORY);
    this.reviewJournals = new Journals(persist, { dir: path.join(paths.runs, 'reviews'), name: fileKey, key: prKeyOf }, EMPTY_REVIEW, evolveReview, JOURNAL_MEMORY);
    const personal = path.basename(paths.personalLog, '.jsonl');
    this.personal = new Journals<PersonalFact, PersonalLog>(persist, { dir: path.dirname(paths.personalLog), name: () => personal, key: () => PERSONAL }, EMPTY_PERSONAL_LOG, evolvePersonalLog, JOURNAL_MEMORY);
  }

  /**
   * Reads the saved state. Throws a StateLockedError if another Focus holds data/state.json: two of them on one data folder each save
   * their own copy over the other's, so a review one finished comes back as the other's older one.
   */
  load(): void {
    if (!this.persist) return;
    fs.mkdirSync(paths.logs, { recursive: true });
    fs.mkdirSync(path.join(paths.runs, 'reviews'), { recursive: true });
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
      const agent = agentAfterRestart(saved, this.projects.find((p) => p.id === saved.projectId)?.name ?? 'The project', randomAvatar);
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
  /**
   * Makes the settings `next`, in the same object: a field `next` doesn't have goes (a merge would keep one the captain
   * cleared). Saved with the rest by `save`.
   */
  replaceSettings(next: Settings): Settings {
    for (const key of Object.keys(this.settings)) if (!(key in next)) Reflect.deleteProperty(this.settings, key);
    return Object.assign(this.settings, next);
  }

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
      // A new project starts with QA waiting to be asked: each review is a session of QA's, so the captain sends a PR
      // with "Send to QA" on the board, or switches auto-QA on (docs/qa.md). Projects from before keep theirs.
      autoQa: false,
      // A new project starts with QA reporting to the captain rather than sending fails back by itself: each round costs a
      // developer's session and QA's, so it's theirs to switch on (docs/qa.md). Projects from before keep theirs.
      autoSendBack: false,
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

  /** Deletes the screenshots and recordings the reviews `old` named that none of `kept` still does. */
  private dropShots(old: (QaReview | undefined)[], kept: (QaReview | undefined)[]): void {
    for (const file of shotsToDrop(old, kept)) {
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
   * flushed (fsync) before this returns, so whatever Ops does next on the strength of it survives a crash.
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

  /** Told of each agent whose run moved on: Ops sends them to every browser. */
  journaled?: (agent: Agent) => void;

  /** Told of each journal that stepped its machine (`server/agents/machines.ts`), by the machine's id and the run's key. */
  stepped?: (machine: string, key: string) => void;

  /** A run's path through machine `machine` (`key` an agent's id, or a pull request's key), from its journal: none for a machine it isn't. */
  machinePath(machine: string, key: string): MachineStep[] {
    return machinePath(machine, key, { runs: this.runs, reviews: this.reviewJournals });
  }

  /** Where every run of each of Ops' machines is now (`machineRuns`). */
  machineRuns(): MachineRun[] {
    return machineRuns({
      agents: [...this.agents.values()],
      projects: this.projects,
      reviews: [...this.reviews.keys()].map((key) => ({ key, ...this.reviewJournals.state(key) })),
    });
  }

  /** The agent's run journal, oldest first: its file, or what's kept of it in memory. */
  journalEntries(id: string): JournalEntry[] {
    return this.runs.entries(id);
  }

  /** What the agent's run journal adds up to (an agent not saved when Focus started, a goal reopened since, may have one already). */
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
    const state = this.review(key);
    const view = reviewView(state);
    // a review asked for again keeps its last verdict's files: a precheck that finds nothing to test puts that verdict back
    const kept = [view, state.previous];
    this.dropShots(this.keptReviews.get(key) ?? [this.reviews.get(key)], kept);
    if (view) this.keptReviews.set(key, kept);
    else this.keptReviews.delete(key);
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

  // ---- the captain's personal log ----

  /** Records a fact in the captain's personal log, flushed before this returns, and what the log adds up to with it. */
  personalLog(fact: PersonalFact): PersonalLog {
    return this.personal.append(PERSONAL, fact);
  }

  /** What the captain's personal log adds up to. */
  get personalEntries(): PersonalLog['entries'] {
    return this.personal.state(PERSONAL).entries;
  }

  // ---- every journal ----

  /** The journals written to since `since`, each with its facts, oldest first: lent to plugins (`host.journals`). */
  journalsSince(since: number): LentJournals {
    return {
      runs: this.runs.written(since).map((key) => ({ key, entries: this.runs.entries(key) })),
      reviews: this.reviewJournals.written(since).map((key) => ({ key, entries: this.reviewJournals.entries(key) })),
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
      fs.appendFile(fileIn(paths.logs, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', () => undefined);
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
      await fsp.access(fileIn(paths.logs, `${id}.jsonl`));
    } catch {
      return this.lines.get(id) ?? [];
    }
    return this.readLog(id, 5000);
  }

  private readLog(id: string, max: number): TermLine[] {
    try {
      const text = fs.readFileSync(fileIn(paths.logs, `${id}.jsonl`), 'utf8');
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

type Shown = Pick<QaReview, 'screenshots' | 'recording'> | undefined;

/** The screenshots and recordings of the reviews `old` that none of `kept` still names (all of them when there's none). */
export function shotsToDrop(old: Shown[], kept: Shown[] = []): string[] {
  const files = (r: Shown) => [...(r?.screenshots ?? []).map((s) => s.file), r?.recording?.mp4File, r?.recording?.gifFile].filter((f) => f !== undefined);
  const keep = new Set(kept.flatMap(files));
  return [...new Set(old.flatMap(files))].filter((file) => !keep.has(file));
}

/** Why Focus won't open a data folder another Focus is using, and what to do instead. */
/** Another running Focus holds the data folder: an expected refusal, which Focus reports in a line, not a crash. */
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
  return `Another running Focus (pid ${pid}) is using ${dataDir}. Stop it first, or give this one a data folder of its own (FOCUS_DATA_DIR=<empty folder>), or run pnpm run demo, which saves nothing.`;
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
