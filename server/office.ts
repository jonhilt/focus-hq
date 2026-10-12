import { isAutonomy } from '../shared/autonomy';
import { chiefEngineer } from '../shared/crew';
import type { Board, ConflictsOutcome, Effort, Issue, Preview, PreviewSet, Project, PullRequest, RoomTheme, RetroDraft, ServerInfo, Settings, Snapshot } from '../shared/types';
import { DESKS_PER_ROOM, EFFORT_LEVELS, MERGE_METHODS } from '../shared/types';
import { carryMergeable } from '../shared/board';
import { chosenSet, previewPrs } from '../shared/previewSet';
import { startOrder } from '../shared/dependencies';
import type { Closer } from '../shared/ledger';
import { autoMergeFor, type GateMark, mergeMethodFor, mergeStep, type MergeStep, requestedMerge } from '../shared/mergeGate';
import { autoSendBackFor, prKey } from '../shared/qa';
import type { AgentManager } from './agents/manager';
import type { Calls } from './call/calls';
import type { ChiefEngineer } from './agents/engineer';
import type { NumberOne } from './agents/numberOne';
import type { StudioComputer } from './agents/studioComputer';
import type { IssuePlanner } from './agents/planner';
import { config } from './config';
import type { GitHubProvider } from './github/provider';
import type { Hub } from './hub';
import type { Previews } from './previews';
import type { Store } from './store';
import { errorMessage } from './util';
import type { Voice } from './voice';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function normalizeRepo(input: string): string {
  const trimmed = input.trim().replace(/\.git$/, '');
  const fromUrl = /github\.com[/:]([\w.-]+\/[\w.-]+)/.exec(trimmed);
  const repo = fromUrl ? fromUrl[1] : trimmed;
  if (!REPO_RE.test(repo)) throw new Error(`"${input}" doesn't look like owner/name or a GitHub URL`);
  return repo;
}

/** The office itself: projects (rooms), their Kanban boards, and the manager's actions. */
export class Office {
  agents!: AgentManager;
  private info: ServerInfo;
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private refreshing = new Map<string, Promise<void>>();
  /** What auto-merge already did about each PR's head commit (by prKey). Forgotten on restart, so it may try once more. */
  private gateMarks = new Map<string, GateMark>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly github: GitHubProvider,
    readonly previews: Previews,
    readonly planner: IssuePlanner,
    readonly numberOne: NumberOne,
    readonly studio: StudioComputer,
    readonly engineer: ChiefEngineer,
    readonly voice: Voice,
    readonly calls: Calls,
    version: string,
  ) {
    this.info = {
      mode: config.demo ? 'demo' : 'live',
      version,
      github: { ok: false, error: 'Checking…' },
      settings: store.settings,
      deskCount: DESKS_PER_ROOM,
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
    this.hub.send({ type: 'info', info: this.info });
    return this.info;
  }

  async snapshot(): Promise<Snapshot> {
    const agents = [...this.store.agents.values()];
    return {
      info: { ...this.info, settings: this.store.settings },
      projects: this.store.projects,
      agents,
      boards: [...this.store.boards.values()],
      lines: Object.fromEntries(agents.map((a) => [a.id, this.store.recentLines(a.id)])),
      browser: Object.fromEntries(this.store.browser),
      previews: this.previews.list(),
      drafts: this.planner.list(),
      numberOne: this.numberOne.current(),
      studio: this.studio.current(),
      reviews: [...this.store.reviews.values()],
      voice: this.voice.status(),
      call: this.calls.status(),
      report: this.agents.report(),
      retro: this.engineer.current(),
    };
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

  updateProject(id: string, patch: Parameters<Store['updateProject']>[1]): Project {
    const project = this.store.updateProject(id, patch);
    this.broadcastProjects();
    if (patch.autoAssign || patch.autoMerge || patch.maxAgents !== undefined) {
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
    const project = this.store.project(projectId);
    if (!project.repos.includes(repo)) throw new Error(`${repo} is not part of ${project.name}`);
    if (!title.trim()) throw new Error('An issue needs a title');
    const issue = await this.fileIssue(projectId, repo, title.trim(), body, labels);
    this.hub.toast('success', `Filed ${repo}#${issue.number}`, undefined, projectId);
    if (fromDraft) this.planner.discard(projectId);
    const agent = assign ? this.agents.hire(projectId, repo, issue, assign) : undefined;
    return { issue, agent };
  }

  /**
   * The captain's call on one of the retro's drafts: an accepted one is filed in `repo` (one of `projectId`'s); either
   * way the decision goes in the ledger with the frictions' signatures, so later retros leave them be and the report
   * card can tell whether an accepted fix stopped them.
   */
  async decideDraft(id: string, accepted: boolean, projectId?: string, repo?: string): Promise<RetroDraft> {
    const draft = this.engineer.current().drafts.find((d) => d.id === id);
    if (!draft) throw new Error('That draft isn’t in the latest retro');
    if (draft.decision) throw new Error(`That draft was already ${draft.decision.accepted ? 'accepted' : 'rejected'}`);
    let issue: { repo: string; number: number; url: string } | undefined;
    if (accepted) {
      if (!projectId || !repo) throw new Error('Pick the repository to file it in');
      if (!this.store.project(projectId).repos.includes(repo)) throw new Error(`${repo} isn’t one of the project’s repositories`);
      const filed = await this.fileIssue(projectId, repo, draft.title, `${draft.body}\n\n_Drafted by ${chiefEngineer().name}, the Focus office's chief engineer, from frictions in ${draft.sessions} agent sessions; accepted by the captain._`);
      issue = { repo, number: filed.number, url: filed.url };
      this.hub.toast('success', `🔧 Filed ${repo}#${filed.number}: ${draft.title}`, undefined, projectId);
    }
    this.agents.record(projectId ?? '', { kind: 'retro-decision', title: draft.title, signatures: draft.signatures, accepted, ...(issue && { issue: { repo: issue.repo, number: issue.number } }) });
    return this.engineer.decided(id, { accepted, at: Date.now(), issue });
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

  /** `headSha` merges only that commit: GitHub refuses if the branch has moved on since. The office auto-merges; otherwise it's the captain. */
  async mergePullRequest(projectId: string, repo: string, number: number, headSha?: string, by: Closer = 'captain'): Promise<void> {
    const method = mergeMethodFor(this.store.projects.find((p) => p.id === projectId), repo, this.store.settings.mergeMethod);
    await this.github.mergePullRequest(repo, number, method, headSha);
    const board = this.store.boards.get(projectId);
    this.agents.prClosed(repo, number, true, by, headSha ?? board?.prs.find((p) => p.repo === repo && p.number === number)?.headSha);
    this.previews.closed(repo, number);
    if (board) {
      board.prs = board.prs.filter((p) => !(p.repo === repo && p.number === number));
      this.hub.send({ type: 'board', board });
    }
    this.boardChanged(projectId);
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
    if (!project.repos.includes(repo)) throw new Error(`${repo} is not part of ${project.name}`);
    const board = this.store.boards.get(projectId);
    const pr = board?.prs.find((p) => p.repo === repo && p.number === number);
    if (!board || !pr) throw new Error(`${repo}#${number} is not an open pull request`);
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
    const board: Board = { projectId, issues: [], prs: [], updatedAt: Date.now() };
    const errors: string[] = [];
    await Promise.all(
      project.repos.map(async (repo) => {
        try {
          const [issues, prs] = await Promise.all([this.github.listIssues(repo), this.github.listPullRequests(repo)]);
          board.issues.push(...issues);
          board.prs.push(...prs);
        } catch (err) {
          errors.push(`${repo}: ${errorMessage(err)}`);
        }
      }),
    );
    if (errors.length) board.error = errors.join('\n');
    board.issues.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const issue of board.issues) issue.closedPr = this.store.closedPrs.get(prKey(issue.repo, issue.number));
    for (const closed of [...this.store.closedPrs.values()]) {
      // the issue was closed since (or built another way): nothing left to mark
      const listed = !project.repos.includes(closed.repo) || board.error?.includes(closed.repo) || board.issues.some((i) => i.repo === closed.repo && i.number === closed.issue);
      if (!listed) this.store.removeClosedPr(closed.repo, closed.issue);
    }
    board.prs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    board.prs = carryMergeable(this.store.boards.get(projectId)?.prs ?? [], board.prs);
    if (!this.store.projects.some((p) => p.id === projectId)) return;
    this.store.boards.set(projectId, board);
    this.hub.send({ type: 'board', board });

    const preview = this.previews.list().find((p) => p.projectId === projectId);
    for (const { repo, number } of preview ? previewPrs(preview) : []) {
      if (!board.error?.includes(repo) && !board.prs.some((p) => p.repo === repo && p.number === number)) this.previews.closed(repo, number);
    }

    await this.noticeClosedPullRequests(projectId, board);
    await this.requestedMerges(projectId, board);
    await this.autoMerge(projectId, board);
    this.autoAssign(projectId, board);
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
          try {
            await this.mergePullRequest(projectId, pr.repo, pr.number, step.sha, 'captain');
            this.hub.toast('success', `Merged ${where}: QA passed it, as you asked`, undefined, projectId);
          } catch (err) {
            this.agents.requestMerge(pr.repo, pr.number, false);
            this.hub.toast('error', `GitHub refused to merge ${where}: ${errorMessage(err)}`, undefined, projectId);
          }
      }
    }
  }

  /** With auto-merge on, takes each open PR one step further along mergeStep: QA, checks, conflicts, merged. */
  private async autoMerge(projectId: string, board: Board): Promise<void> {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project || !autoMergeFor(project)) return;
    const open = new Set(board.prs.map((p) => prKey(p.repo, p.number)));
    for (const key of this.gateMarks.keys()) {
      const repo = key.slice(0, key.lastIndexOf('#'));
      if (project.repos.includes(repo) && !board.error?.includes(repo) && !open.has(key)) this.gateMarks.delete(key);
    }
    for (const pr of [...board.prs]) {
      const key = prKey(pr.repo, pr.number);
      const step = mergeStep(pr, this.store.reviews.get(key), {
        openedByOffice: this.agents.openedByOffice(pr.repo, pr.number),
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
    switch (step.kind) {
      case 'wait':
      case 'blocked':
        return;
      case 'merge':
        try {
          await this.mergePullRequest(projectId, pr.repo, pr.number, step.sha, 'office');
          this.gateMarks.delete(key);
          this.hub.toast('success', `🤖 Auto-merged ${where}: QA passed it and its checks are green`, undefined, projectId);
        } catch (err) {
          this.gateMarks.set(key, { sha: step.sha, kind: 'refused', reason: errorMessage(err) });
          this.hub.toast('error', `🤖 GitHub refused to merge ${where}: ${errorMessage(err)}`, undefined, projectId);
        }
        return;
      case 'qa':
        this.agents.requestReview(projectId, pr.repo, pr.number, pr.title);
        this.hub.toast('info', `🔍 ${where} goes to QA before it can merge: ${step.reason}`, undefined, projectId);
        return;
      case 'rerun-checks':
        this.gateMarks.set(key, { sha: step.sha, kind: 'rerun' });
        await this.github.rerunFailedRuns(pr.repo, step.runIds);
        this.hub.toast('info', `↻ Re-running the failed checks on ${where}`, undefined, projectId);
        return;
      case 'send-back':
        this.gateMarks.set(key, { sha: step.sha, kind: 'sent-back' });
        await this.agents.sendBackChecks(pr.repo, pr.number, step.checks);
        return;
      case 'resolve-conflicts': {
        this.gateMarks.set(key, { sha: step.sha, kind: 'resolving' });
        const outcome = await this.agents.resolveConflicts(projectId, pr);
        const said = {
          agent: `– resolving them before QA`,
          merged: outcome.kind === 'merged' && outcome.auto
            ? `– the office merged ${pr.baseBranch} in, settling ${outcome.auto.join(', ')} by rule`
            : `– the office merged ${pr.baseBranch} in cleanly`,
          'up-to-date': `on GitHub, but it already has everything from ${pr.baseBranch}`,
        }[outcome.kind];
        this.hub.toast('info', `🔧 ${where} conflicts with ${pr.baseBranch} ${said}`, outcome.kind === 'agent' ? outcome.agent.id : undefined, projectId);
        return;
      }
    }
  }

  private async noticeClosedPullRequests(projectId: string, board: Board): Promise<void> {
    // QA reviews of PRs that left the board (asked of GitHub, since a PR opened a moment ago may not be listed yet)
    for (const review of [...this.store.reviews.values()].filter((r) => r.projectId === projectId)) {
      if (board.prs.some((p) => p.repo === review.repo && p.number === review.number) || board.error?.includes(review.repo)) continue;
      try {
        const state = await this.github.pullRequestState(review.repo, review.number);
        if (state === 'OPEN') continue;
        this.agents.recordLanding(review.repo, review.number, state === 'MERGED');
        this.agents.reviewGone(review.repo, review.number, state === 'MERGED');
      } catch {
        // try again next refresh
      }
    }
    // the leads' pull requests, merged or closed on GitHub
    for (const pr of this.agents.leadPrs(projectId)) {
      if (board.prs.some((p) => p.repo === pr.repo && p.number === pr.number) || board.error?.includes(pr.repo)) continue;
      try {
        const state = await this.github.pullRequestState(pr.repo, pr.number);
        if (state !== 'OPEN') this.agents.prClosed(pr.repo, pr.number, state === 'MERGED');
      } catch {
        // try again next refresh
      }
    }
    for (const agent of this.store.agentsIn(projectId)) {
      if (!agent.pr || agent.status !== 'done') continue;
      if (board.prs.some((p) => p.repo === agent.repo && p.number === agent.pr!.number)) continue;
      if (board.error?.includes(agent.repo)) continue;
      try {
        const state = await this.github.pullRequestState(agent.repo, agent.pr.number);
        if (state !== 'OPEN') this.agents.prClosed(agent.repo, agent.pr.number, state === 'MERGED');
      } catch {
        // try again next refresh
      }
    }
  }

  private autoAssign(projectId: string, board: Board): void {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project?.autoAssign) return;
    let slots = this.agents.freeSlots(projectId);
    for (const issue of startOrder(board.issues)) {
      if (slots <= 0) break;
      if (project.autoLabel && !issue.labels.includes(project.autoLabel)) continue;
      if (this.agents.claimed(issue.repo).has(issue.number)) continue;
      if (board.prs.some((p) => p.repo === issue.repo && p.branch.startsWith(`focus/${issue.number}-`))) continue;
      try {
        this.agents.hire(projectId, issue.repo, issue);
        slots--;
      } catch {
        break; // room is full
      }
    }
  }

  // ---------------------------------------------------------------- settings

  updateSettings(patch: Partial<Settings>): Settings {
    const s = this.store.settings;
    if (patch.maxConcurrent !== undefined) s.maxConcurrent = Math.max(1, Math.min(32, Math.round(patch.maxConcurrent)));
    if (isAutonomy(patch.autonomy)) s.autonomy = patch.autonomy;
    if (patch.model !== undefined) s.model = patch.model.trim();
    if (typeof patch.conflictsModel === 'string') s.conflictsModel = patch.conflictsModel.trim();
    // an empty (or unknown) choice goes back to the model's default
    if (patch.conflictsEffort !== undefined) s.conflictsEffort = EFFORT_LEVELS.find((e) => e === patch.conflictsEffort);
    if (typeof patch.qaModel === 'string') s.qaModel = patch.qaModel.trim();
    const mergeMethod = MERGE_METHODS.find((m) => m === patch.mergeMethod);
    if (mergeMethod) s.mergeMethod = mergeMethod;
    if (typeof patch.attribution === 'boolean') s.attribution = patch.attribution;
    if (typeof patch.userClaudeMd === 'boolean') s.userClaudeMd = patch.userClaudeMd;
    const leadEffort = EFFORT_LEVELS.find((e) => e === patch.leadEffort);
    if (leadEffort) s.leadEffort = leadEffort;
    this.store.save();
    this.hub.send({ type: 'info', info: { ...this.info, settings: s } });
    this.agents.schedule();
    return s;
  }

  async listRepos(): Promise<string[]> {
    return this.github.listRepos();
  }
}
