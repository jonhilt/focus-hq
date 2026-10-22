import type { Board, BotChange, BotStatus, ConflictsOutcome, Effort, Issue, Preview, PreviewSet, Project, PullRequest, RoomTheme, ServerInfo, Settings, ShipPlugins, Snapshot } from '../shared/types';
import { DESKS_PER_ROOM } from '../shared/types';
import { freshBoard, prsOffBoard, type RepoListing, staleClosedPrs } from '../shared/board';
import { chosenSet, previewPrsGone } from '../shared/previewSet';
import { issuesToAssign } from '../shared/dependencies';
import type { Closer } from '../shared/ledger';
import { autoMergeFor, boardMergeSaid, conflictsSaid, forgottenMarks, type GateMark, mergeMethodFor, mergeStep, type MergeStep, requestedMerge, stepMark } from '../shared/mergeGate';
import { entryIn, entryText, type LogFrom, type PersonalEntry, type PersonalMark } from '../shared/personalLog';
import { autoQaFor, autoSendBackFor, prKey, verdictBehindHead } from '../shared/qa';
import type { AgentManager } from './agents/manager';
import { BotSetup } from './bot';
import type { Lent } from './agents/manager/pluginHost';
import type { FocusPlugin } from './plugins/contract';
import type { IssuePlanner } from './agents/planner';
import { config, paths } from './config';
import { demoPace } from './demoPace';
import type { GitHubProvider } from './github/provider';
import type { Hub } from './hub';
import type { Previews } from './previews';
import type { Store } from './store';
import { Secrets } from './secrets';
import { changeSettings } from './settings';
import { projectChangeFollowUps } from './projectChange';
import { issueRefusal, previewTarget } from './focusRequests';
import { errorMessage, newId } from './util';
import type { Voice } from './voice';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function normalizeRepo(input: string): string {
  const trimmed = input.trim().replace(/\.git$/, '');
  const fromUrl = /github\.com[/:]([\w.-]+\/[\w.-]+)/.exec(trimmed);
  const repo = fromUrl ? fromUrl[1] : trimmed;
  if (!REPO_RE.test(repo)) throw new Error(`"${input}" doesn't look like owner/name or a GitHub URL`);
  return repo;
}

/** The ship itself: projects (rooms), their Kanban boards, and the manager's actions. */
export class Focus {
  agents!: AgentManager;
  /** Focus's own repo (`owner/repo`, from its checkout's remote), lent to plugins (main engineering's climber works on it). */
  ownRepo: string | undefined;
  /** Shuts Focus down for its supervisor to start it again (server/supervise.ts), once Focus can. */
  restart?: () => Promise<void>;
  /** A bot speaking for the captain: its settings as they are now, and the captain's changes to them. */
  readonly bot = new BotSetup({ secrets: new Secrets(paths.secrets), publicUrl: () => this.store.settings.publicUrl });
  private info: ServerInfo;
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private refreshing = new Map<string, Promise<void>>();
  /** What auto-merge already did about each PR's head commit (by prKey). Forgotten on restart, so it may try once more. */
  private gateMarks = new Map<string, GateMark>();
  /** The PRs (by prKey) Ops is merging, their merge check under way. */
  private merging = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly github: GitHubProvider,
    readonly previews: Previews,
    readonly planner: IssuePlanner,
    readonly voice: Voice,
    version: string,
  ) {
    this.info = {
      mode: config.demo ? 'demo' : 'live',
      version,
      github: { ok: false, error: 'Checking…' },
      settings: store.settings,
      deskCount: DESKS_PER_ROOM,
      plugins: [],
      shipPlugins: { pinnedBy: null, startedWith: [], available: [], canRestart: false },
      bot: this.bot.status(),
    };
  }

  async start(): Promise<void> {
    await this.checkGitHub();
    setInterval(() => void this.checkGitHub(), 5 * 60_000).unref();
    void this.refreshAll();
    setInterval(() => void this.refreshAll(), config.boardRefreshMs).unref();
  }

  async checkGitHub(): Promise<ServerInfo> {
    this.info.github = await this.github.status();
    return this.infoChanged();
  }

  /** Who Focus is on GitHub, when it knows: whose pull requests the boards' "only mine" shows. */
  get githubLogin(): string | undefined {
    return this.info.github.login;
  }

  /** What Focus says of itself now: its settings, the bot's, and in a demo ship the pace its agents go at. */
  private served(): ServerInfo {
    return { ...this.info, settings: this.store.settings, bot: this.bot.status(), ...(config.demo && { demoPace: demoPace() }) };
  }

  /** Tells every browser what Focus says of itself now, as after the demo's pace changes. */
  infoChanged(): ServerInfo {
    const info = this.served();
    this.hub.send({ type: 'info', info });
    return info;
  }

  async snapshot(): Promise<Snapshot> {
    const agents = [...this.store.agents.values()];
    return {
      info: this.served(),
      projects: this.store.projects,
      agents,
      boards: [...this.store.boards.values()],
      lines: Object.fromEntries(agents.map((a) => [a.id, this.store.recentLines(a.id)])),
      browser: Object.fromEntries(this.store.browser),
      previews: this.previews.list(),
      drafts: this.planner.list(),
      reviews: [...this.store.reviews.values()],
      voice: this.voice.status(),
      report: this.agents.report(),
      plugins: this.agents.plugins.states(),
      personalLog: this.store.personalEntries,
    };
  }

  // ---------------------------------------------------------------- the captain's personal log

  /** Jots `text` down in the captain's personal log (`via` a crew member, when one jotted it down for them). */
  notePersonal(text: unknown, from: LogFrom, via?: string): PersonalEntry {
    const id = newId('note');
    const log = this.store.personalLog({ kind: 'noted', id, text: entryText(text), from, ...(via && { via }) });
    this.hub.send({ type: 'personal-log', entries: log.entries });
    return entryIn(log.entries, id);
  }

  /** Records what the captain did with an entry: edited, done, dropped, put aside or reopened. */
  markPersonal(fact: PersonalMark): PersonalEntry {
    entryIn(this.store.personalEntries, fact.id);
    const log = this.store.personalLog(fact.kind === 'edited' ? { ...fact, text: entryText(fact.text) } : fact);
    this.hub.send({ type: 'personal-log', entries: log.entries });
    return entryIn(log.entries, fact.id);
  }

  private broadcastProjects(): void {
    this.hub.send({ type: 'projects', projects: this.store.projects });
  }

  // ---------------------------------------------------------------- projects

  async createProject(name: string, color: string | undefined, repos: string[], theme?: RoomTheme): Promise<Project> {
    const normalized = await Promise.all(repos.filter((r) => r.trim()).map((r) => this.resolveRepo(r)));
    const project = this.store.addProject(name, color, theme);
    project.repos = [...new Set(normalized)];
    this.store.save();
    this.broadcastProjects();
    this.boardChanged(project.id, 0);
    return project;
  }

  updateProject(id: string, patch: unknown): Project {
    const project = this.store.updateProject(id, patch);
    const followUps = projectChangeFollowUps(patch);
    this.broadcastProjects();
    // a plugin switched on (or off) for the project starts (or stops) its work there
    if (followUps.plugins) this.agents.plugins.projectChanged(id);
    if (followUps.schedule) {
      this.agents.schedule();
      this.boardChanged(id, 0);
    }
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    for (const agent of this.store.agentsIn(id)) await this.agents.dismiss(agent.id);
    this.store.removeProject(id);
    this.broadcastProjects();
    this.planner.remove(id);
    await this.previews.remove(id);
  }

  private async resolveRepo(input: string): Promise<string> {
    const repo = normalizeRepo(input);
    try {
      return (await this.github.repoInfo(repo)).nameWithOwner;
    } catch (err) {
      throw new Error(`Can't open ${repo} on GitHub: ${errorMessage(err)}`, { cause: err });
    }
  }

  async connectRepo(projectId: string, input: string): Promise<Project> {
    const project = this.store.project(projectId);
    const repo = await this.resolveRepo(input);
    if (!project.repos.includes(repo)) project.repos.push(repo);
    this.store.save();
    this.broadcastProjects();
    this.boardChanged(projectId, 0);
    return project;
  }

  disconnectRepo(projectId: string, repo: string): Project {
    const project = this.store.project(projectId);
    if (this.store.agentsIn(projectId).some((a) => a.repo === repo && a.status !== 'done' && a.status !== 'error' && a.status !== 'stopped')) {
      throw new Error(`Agents are still working on ${repo}`);
    }
    project.repos = project.repos.filter((r) => r !== repo);
    if (project.mergeMethods) delete project.mergeMethods[repo];
    this.store.save();
    this.broadcastProjects();
    this.boardChanged(projectId, 0);
    if (this.previews.list().some((p) => p.projectId === projectId && (p.repo === repo || p.checkouts.some((c) => c.repo === repo)))) void this.previews.stop(projectId);
    return project;
  }

  async createRepo(name: string, opts: { owner?: string; private: boolean; description: string }, projectId?: string): Promise<string> {
    const clean = name.trim().replace(/\s+/g, '-');
    if (!/^[\w.-]+$/.test(clean)) throw new Error('Repository names may only contain letters, numbers, ".", "-" and "_"');
    const repo = await this.github.createRepo(clean, opts);
    this.hub.toast('success', `Created ${repo} on GitHub`, undefined, projectId);
    if (projectId) await this.connectRepo(projectId, repo);
    return repo;
  }

  // ---------------------------------------------------------------- issues and pull requests

  /** `assign` hires an agent for the new issue straight away; `fromDraft` clears the planner's draft once it's filed. */
  async createIssue(projectId: string, repo: string, title: string, body: string, labels: string[], assign?: { effort?: Effort; cloud?: boolean }, fromDraft = false) {
    const refused = issueRefusal(this.store.project(projectId), repo, title);
    if (refused) throw new Error(refused);
    const issue = await this.fileIssue(projectId, repo, title.trim(), body, labels);
    this.hub.toast('success', `Filed ${repo}#${issue.number}`, undefined, projectId);
    if (fromDraft) this.planner.discard(projectId);
    const agent = assign ? this.agents.hire(projectId, repo, issue, assign) : undefined;
    return { issue, agent };
  }

  /** Files an issue on GitHub and puts it on the project's board straight away (then refreshes it), without a toast. */
  async fileIssue(projectId: string, repo: string, title: string, body: string, labels: string[] = []): Promise<Issue> {
    const issue = await this.github.createIssue(repo, title, body, labels);
    const board = this.store.boards.get(projectId);
    if (board && !board.issues.some((i) => i.repo === repo && i.number === issue.number)) {
      board.issues.push(issue);
      this.hub.send({ type: 'board', board });
    }
    this.boardChanged(projectId);
    return issue;
  }

  /**
   * Merges an open PR on the board once its merge check passes (docs/merging.md), or past it when the captain
   * `override`s it. `headSha` merges only that commit: the check refuses if the PR has moved on since. Ops
   * auto-merges; otherwise it's the captain. Rejects with why it didn't merge.
   */
  async mergePullRequest(projectId: string, repo: string, number: number, headSha?: string, by: Closer = 'captain', override = false): Promise<void> {
    const method = mergeMethodFor(this.store.projects.find((p) => p.id === projectId), repo, this.store.settings.mergeMethod);
    await this.agents.merge(projectId, this.boardPr(projectId, repo, number), { method, by, want: headSha, override });
    this.previews.closed(repo, number);
    this.offBoard(projectId, repo, number);
    this.boardChanged(projectId);
  }

  /** An open pull request on the project's board; throws for one that isn't. */
  private boardPr(projectId: string, repo: string, number: number): PullRequest {
    const pr = this.store.boards.get(projectId)?.prs.find((p) => p.repo === repo && p.number === number);
    if (!pr) throw new Error(`${repo}#${number} is not an open pull request on this board`);
    return pr;
  }

  /** Takes a merged PR off the board straight away, before the refresh that would. */
  private offBoard(projectId: string, repo: string, number: number): void {
    const board = this.store.boards.get(projectId);
    if (!board) return;
    board.prs = board.prs.filter((p) => !(p.repo === repo && p.number === number));
    this.hub.send({ type: 'board', board });
  }

  /**
   * The captain's merge from the board: its merge check runs in the background, the card saying so, and a toast says
   * how it went. `override` merges past the check, at the head the captain saw, and the ledger notes it.
   */
  mergeFromBoard(projectId: string, repo: string, number: number, override = false): { checking: true } {
    const pr = this.boardPr(projectId, repo, number);
    const where = `${repo.split('/')[1]}#${number}`;
    const started = this.mergeLater(projectId, pr, override ? pr.headSha : undefined, 'captain', override, {
      merged: () => this.hub.toast('success', boardMergeSaid(where, pr.baseBranch, override), undefined, projectId),
      refused: (err) => this.hub.toast('error', `${where} didn’t merge: ${errorMessage(err)}`, undefined, projectId),
    });
    if (!started) throw new Error(`Ops is already merging ${where}`);
    return { checking: true };
  }

  /**
   * Starts a merge without waiting for its merge check, which can take minutes: a board refresh carries on meanwhile,
   * and one for a PR already merging starts nothing (false).
   */
  private mergeLater(projectId: string, pr: PullRequest, sha: string | undefined, by: Closer, override: boolean, then: { merged: () => void; refused: (err: unknown) => void }): boolean {
    const key = prKey(pr.repo, pr.number);
    if (this.merging.has(key)) return false;
    this.merging.add(key);
    void this.mergePullRequest(projectId, pr.repo, pr.number, sha, by, override)
      .then(then.merged, then.refused)
      .finally(() => this.merging.delete(key));
    return true;
  }

  /** The captain's "Merge when QA passes" (or, with `on` false, taking it back): the board refresh after QA's verdict merges it. */
  mergeWhenPassed(projectId: string, repo: string, number: number, on = true) {
    const pr = this.store.boards.get(projectId)?.prs.find((p) => p.repo === repo && p.number === number);
    if (!pr) throw new Error(`${repo}#${number} is not an open pull request on this board`);
    const review = this.agents.requestMerge(repo, number, on);
    this.boardChanged(projectId, 0);
    return review;
  }

  /** Hands an open pull request on the board to the room's QA officer (any PR, a teammate's too). */
  requestReview(projectId: string, repo: string, number: number) {
    const pr = this.store.boards.get(projectId)?.prs.find((p) => p.repo === repo && p.number === number);
    if (!pr) throw new Error(`${repo}#${number} is not an open pull request on this board`);
    return this.agents.requestReview(projectId, repo, number, pr.title, undefined, true);
  }

  resolveConflicts(projectId: string, repo: string, number: number): Promise<ConflictsOutcome> {
    const pr = this.store.boards.get(projectId)?.prs.find((p) => p.repo === repo && p.number === number);
    if (!pr) throw new Error(`${repo}#${number} is not an open pull request on this board`);
    if (pr.mergeable !== 'CONFLICTING') throw new Error(`PR #${number} has no merge conflicts`);
    return this.agents.resolveConflicts(projectId, pr);
  }

  // ---------------------------------------------------------------- previews

  /**
   * Runs an open PR locally (replacing the project's current preview) for the manager to click through, together with
   * the PRs linked to it through a feature label, or the PRs `picks` names (null: that repo's default branch).
   */
  startPreview(projectId: string, repo: string, number: number, picks?: PreviewSet): Promise<Preview> {
    const project = this.store.project(projectId);
    const target = previewTarget(project, this.store.boards.get(projectId), repo, number);
    if (typeof target === 'string') throw new Error(target);
    const { board, pr } = target;
    const set = chosenSet(pr, board, project.repos, picks);
    return this.previews.start({ projectId, repos: project.repos, repo, number, title: pr.title, set, config: project.preview ?? {} });
  }

  // ---------------------------------------------------------------- boards

  /** Coalesces refresh requests for a project's board. */
  boardChanged(projectId: string, delayMs = 1500): void {
    clearTimeout(this.refreshTimers.get(projectId));
    this.refreshTimers.set(
      projectId,
      setTimeout(() => {
        this.refreshTimers.delete(projectId);
        void this.refreshBoard(projectId);
      }, delayMs),
    );
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.store.projects.map((p) => this.refreshBoard(p.id)));
  }

  refreshBoard(projectId: string): Promise<void> {
    const inFlight = this.refreshing.get(projectId);
    if (inFlight) return inFlight;
    const job = this.doRefresh(projectId).finally(() => this.refreshing.delete(projectId));
    this.refreshing.set(projectId, job);
    return job;
  }

  private async doRefresh(projectId: string): Promise<void> {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project) return;
    const listings = await Promise.all(project.repos.map((repo) => this.listRepo(repo)));
    const closed = [...this.store.closedPrs.values()];
    const board = freshBoard(projectId, listings, this.store.boards.get(projectId)?.prs ?? [], closed, Date.now());
    this.stampMergeChecks(board);
    for (const stale of staleClosedPrs(project.repos, board, closed)) this.store.removeClosedPr(stale.repo, stale.issue);
    if (!this.store.projects.some((p) => p.id === projectId)) return;
    this.store.boards.set(projectId, board);
    this.hub.send({ type: 'board', board });

    const preview = this.previews.list().find((p) => p.projectId === projectId);
    for (const { repo, number } of previewPrsGone(preview, board)) this.previews.closed(repo, number);

    await this.noticeClosedPullRequests(projectId, board);
    await this.requestedMerges(projectId, board);
    this.verdictsCatchUp(projectId, board);
    await this.autoMerge(projectId, board);
    this.autoAssign(projectId, board);
    this.agents.plugins.boardRefreshed(projectId);
  }

  /** Each PR's merge check on its head, which GitHub's listing doesn't have, back on its card. */
  private stampMergeChecks(board: Board): void {
    for (const pr of board.prs) {
      const check = this.agents.mergeCheck(pr);
      if (check) pr.mergeCheck = check;
    }
  }

  private async listRepo(repo: string): Promise<RepoListing> {
    try {
      const [issues, prs] = await Promise.all([this.github.listIssues(repo), this.github.listPullRequests(repo)]);
      return { repo, issues, prs };
    } catch (err) {
      return { repo, error: errorMessage(err) };
    }
  }

  /** Starts the plugins switched on (docs/plugins.md), lending them Focus's own repo, and in the demo its agents' transcripts. */
  /** `more`: the demo's transcripts, and the ship's status, which needs GitHub and the agents' worktrees. */
  /** `ship`: how they were chosen, for the captain to change them from the ready room. */
  startPlugins(plugins: FocusPlugin[], more: Pick<Lent, 'transcript' | 'shipStatus'>, ship: ShipPlugins): void {
    this.agents.startPlugins(plugins, { demo: config.demo, ownRepo: () => this.ownRepo, fileIssue: (...issue) => this.fileIssue(...issue), snapshot: () => this.snapshot(), personalLog: { entries: () => this.store.personalEntries, note: (text, via) => this.notePersonal(text, 'office', via) }, githubLogin: () => this.githubLogin, bot: () => this.bot.config(), ...more });
    this.info.plugins = this.agents.plugins.ids();
    this.info.shipPlugins = ship;
    // FOCUS_PLUGINS's plugins carry over as the captain's choice the first time, so taking it away later changes nothing
    if (ship.pinnedBy === 'FOCUS_PLUGINS' && !this.store.settings.plugins && !config.demo) {
      this.store.settings.plugins = ship.startedWith.filter((id) => ship.available.some((a) => a.id === id));
      this.store.save();
    }
    // its saved state is kept, but nothing of it runs: no briefs, hooks, or pull requests kept for the captain
    for (const id of this.agents.plugins.dormant()) console.warn(`Plugin ${id} has saved state but isn't switched on: switch it on in the ready room's Plugins tab to bring it back`);
  }

  /** Restarts Focus, as the captain asks to apply the plugins they switched: only under its supervisor, which starts it again. */
  restartFocus(): { restarting: true } {
    const restart = this.info.shipPlugins.canRestart ? this.restart : undefined;
    if (!restart) throw new Error('Focus can’t restart itself here: it isn’t running under pnpm start or pnpm run dev. Stop it and start it again.');
    setTimeout(() => void restart(), 200);
    return { restarting: true };
  }

  /** Merges the PRs the captain asked to merge once QA passed them, at exactly the commit QA passed. */
  private async requestedMerges(projectId: string, board: Board): Promise<void> {
    for (const pr of [...board.prs]) {
      const review = this.store.reviews.get(prKey(pr.repo, pr.number));
      if (!review?.mergeRequested) continue;
      const where = `${pr.repo.split('/')[1]}#${pr.number}`;
      const step = requestedMerge(pr, review);
      switch (step.kind) {
        case 'wait':
          continue;
        case 'qa':
          try {
            this.agents.requestReview(projectId, pr.repo, pr.number, pr.title);
            this.hub.toast('info', `🔍 ${where} goes back to QA before it merges: ${step.reason}`, undefined, projectId);
          } catch (err) {
            this.hub.toast('error', `${where} couldn’t go back to QA before it merges: ${errorMessage(err)}`, undefined, projectId);
          }
          continue;
        case 'drop':
          this.agents.requestMerge(pr.repo, pr.number, false);
          this.hub.toast('error', `${where} didn’t merge: ${step.reason}`, review.agentId, projectId);
          continue;
        case 'merge':
          this.mergeLater(projectId, pr, step.sha, 'captain', false, {
            merged: () => this.hub.toast('success', `Merged ${where}: QA passed it and its merge checks out, as you asked`, undefined, projectId),
            refused: (err) => {
              this.agents.requestMerge(pr.repo, pr.number, false);
              this.hub.toast('error', `${where} didn’t merge: ${errorMessage(err)}`, undefined, projectId);
            },
          });
      }
    }
  }

  /** Sends each of Ops' PRs whose head moved past QA's verdict, by a push Ops didn't make, back to QA. */
  private verdictsCatchUp(projectId: string, board: Board): void {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project) return;
    for (const pr of board.prs) {
      const review = this.store.reviews.get(prKey(pr.repo, pr.number));
      if (!verdictBehindHead(review, pr, { ours: this.agents.opsPr(pr.repo, pr.number), autoQa: autoQaFor(project) })) continue;
      try {
        this.agents.requestReview(projectId, pr.repo, pr.number, pr.title, undefined, false, pr.headSha);
      } catch (err) {
        console.warn(`Couldn't send ${pr.repo}#${pr.number} back to QA at its new head: ${errorMessage(err)}`);
      }
    }
  }

  /** With auto-merge on, takes each open PR one step further along mergeStep: QA, checks, conflicts, merged. */
  private async autoMerge(projectId: string, board: Board): Promise<void> {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project || !autoMergeFor(project)) return;
    for (const key of forgottenMarks(this.gateMarks.keys(), project.repos, board)) this.gateMarks.delete(key);
    for (const pr of [...board.prs]) {
      const key = prKey(pr.repo, pr.number);
      const step = mergeStep(pr, this.store.reviews.get(key), {
        openedByOffice: this.agents.openedByOffice(pr.repo, pr.number),
        captainMerges: this.agents.plugins.captainMerges(pr),
        developerBusy: this.agents.busyOn(pr.repo, pr.number),
        autoSendBack: autoSendBackFor(project),
        mark: this.gateMarks.get(key),
      });
      try {
        await this.followMergeStep(projectId, pr, step);
      } catch (err) {
        this.hub.toast('error', `Auto-merge of ${pr.repo.split('/')[1]}#${pr.number}: ${errorMessage(err)}`, undefined, projectId);
      }
    }
  }

  private async followMergeStep(projectId: string, pr: PullRequest, step: MergeStep): Promise<void> {
    const key = prKey(pr.repo, pr.number);
    const where = `${pr.repo.split('/')[1]}#${pr.number}`;
    const mark = stepMark(step);
    if (mark) this.gateMarks.set(key, mark);
    switch (step.kind) {
      case 'wait':
      case 'blocked':
        return;
      case 'merge':
        this.mergeLater(projectId, pr, step.sha, 'office', false, {
          merged: () => {
            this.gateMarks.delete(key);
            this.hub.toast('success', `🤖 Auto-merged ${where}: QA passed it, its checks are green and so is its merge`, undefined, projectId);
          },
          refused: (err) => {
            this.gateMarks.set(key, { sha: step.sha, kind: 'refused', reason: errorMessage(err) });
            this.hub.toast('error', `🤖 ${where} didn’t merge: ${errorMessage(err)}`, undefined, projectId);
          },
        });
        return;
      case 'qa':
        this.agents.requestReview(projectId, pr.repo, pr.number, pr.title);
        this.hub.toast('info', `🔍 ${where} goes to QA before it can merge: ${step.reason}`, undefined, projectId);
        return;
      case 'rerun-checks':
        await this.github.rerunFailedRuns(pr.repo, step.runIds);
        this.hub.toast('info', `↻ Re-running the failed checks on ${where}`, undefined, projectId);
        return;
      case 'send-back':
        await this.agents.sendBackChecks(pr.repo, pr.number, step.checks);
        return;
      case 'resolve-conflicts': {
        const outcome = await this.agents.resolveConflicts(projectId, pr);
        this.hub.toast('info', conflictsSaid(where, pr.baseBranch, outcome), outcome.kind === 'agent' ? outcome.agent.id : undefined, projectId);
        return;
      }
    }
  }

  private async noticeClosedPullRequests(projectId: string, board: Board): Promise<void> {
    const reviews = [...this.store.reviews.values()].filter((r) => r.projectId === projectId);
    const held = { reviews, leadPrs: this.agents.leadPrs(projectId), agents: this.store.agentsIn(projectId) };
    for (const pr of prsOffBoard(board, held)) {
      try {
        const state = await this.github.pullRequestState(pr.repo, pr.number);
        if (state === 'OPEN') continue;
        if (pr.kind === 'review') {
          this.agents.recordLanding(pr.repo, pr.number, state === 'MERGED');
          this.agents.reviewGone(pr.repo, pr.number, state === 'MERGED');
        } else this.agents.prClosed(pr.repo, pr.number, state === 'MERGED');
      } catch {
        // try again next refresh
      }
    }
  }

  private autoAssign(projectId: string, board: Board): void {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project?.autoAssign) return;
    const room = { slots: this.agents.freeSlots(projectId), autoLabel: project.autoLabel, claimed: (repo: string) => this.agents.claimed(repo) };
    for (const issue of issuesToAssign(board.issues, board.prs, room)) {
      try {
        this.agents.hire(projectId, issue.repo, issue);
      } catch {
        break; // room is full
      }
    }
  }

  // ---------------------------------------------------------------- settings

  /** The captain's change to the settings (any JSON: `changeSettings` takes what it gets right), saved and sent out. */
  updateSettings(patch: unknown): Settings {
    const s = Object.assign(this.store.settings, changeSettings(this.store.settings, patch));
    this.store.save();
    this.infoChanged();
    this.agents.schedule();
    return s;
  }

  /** The captain's change to the bot's webhook or its Authorization header (`BotSetup.change`), sent out. */
  changeBot(change: BotChange): BotStatus {
    const status = this.bot.change(change);
    this.infoChanged();
    return status;
  }

  /** A new bot token, for the captain to give the bot: told them this once. */
  newBotToken(): { token: string } {
    const token = this.bot.newToken();
    this.infoChanged();
    return { token };
  }

  clearBotToken(): BotStatus {
    const status = this.bot.clearToken();
    this.infoChanged();
    return status;
  }

  async listRepos(): Promise<string[]> {
    return this.github.listRepos();
  }
}
