import { Cause, Effect } from 'effect';
import { higherLane } from '../../../shared/mergeLane';
import { autoQaFor, sameCommit } from '../../../shared/qa';
import type { Agent, LeadAgent } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { errorMessage, newId } from '../../util';
import { afterLanding, afterPush, landedMidShipNote, hasLeadWork, sliceLanded, carriedNote, behindNote, everyPr, heldBack, leadPrBody, leadWorktreeId, newSliceNote, notShipped, openPr, reposBackNote, shipped, shippedSha, shipPlan, shipBranch, sliceBranch, type FreshBranch, freshBranchNote, needsFreshBranch, repoBranch } from '../lead';
import { repoFolders } from '../planner';
import { recapLane, recapMarkdown, recapPage, recapProblems, type ShipInput, type SliceRecap, withRecap } from '../recap';
import { backedMap, MAX_FILES, primitivesToRead, SOURCE } from '../recapImports';
import { type Moving, reconciledPrs, sliceRecovery } from '../sliceJournal';
import { nextWaypoints, shippedWaypoint } from '../waypoints';
import { type GitFailed, type Renderer, Workspace } from '../services';
import { type ManagerServices, NothingToCheckOut, Part, Refused } from './core';

/** A goal's slices: checking every repo out side by side, moving on to fresh code when a slice lands, and the lead's ship tool. */
export class Slices extends Part {
  /** Worktrees of `repos` on the lead's current branch, each from its repo's default branch, recorded on the lead. */
  checkOutSlice(agent: LeadAgent, repos: string[]): Effect.Effect<void, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const checkouts: LeadAgent['lead']['repos'] = [];
      for (const [repo, folder] of repoFolders(repos)) {
        const info = yield* github.repoInfo(repo);
        if (info.isEmpty) {
          this.print(agent, [{ kind: 'system', text: `✻ Skipping ${repo}: it has no commits yet` }]);
          continue;
        }
        this.update(agent, { activity: `Checking out ${repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Checking out ${repo} at ./${folder} on ${agent.branch}` }]);
        yield* workspace.create(repo, leadWorktreeId(agent.id, folder), agent.branch, info.defaultBranch, (id) => this.store.agents.has(id));
        yield* this.install(agent, workspace.dir(leadWorktreeId(agent.id, folder)));
        checkouts.push({ repo, folder, baseBranch: info.defaultBranch });
      }
      if (!checkouts.length) return yield* new NothingToCheckOut();
      this.update(agent, { lead: { ...agent.lead, repos: checkouts }, baseBranch: checkouts[0].baseBranch });
    });
  }

  /**
   * The slice has landed: a new branch on fresh code in every repo, unless a repo has uncommitted changes, which are
   * never thrown away. Commits that never shipped come along onto the new branch, or stay on the old one, with the
   * lead told how to bring them over, when they don't apply cleanly. Succeeds with what the lead hears about it.
   */
  nextSlice(agent: LeadAgent): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const lead = agent.lead;
      const workspace = yield* Workspace;
      const dir = (folder: string) => workspace.dir(leadWorktreeId(agent.id, folder));
      const dirty = yield* Effect.filter(lead.repos, (r) => workspace.hasUncommittedChanges(dir(r.folder)));
      if (afterLanding(dirty.map((r) => r.folder)) === 'held-back') return heldBack(lead, dirty.map((r) => r.folder));
      const unshipped = yield* Effect.forEach(lead.repos, (r) =>
        workspace.unshippedCommits(dir(r.folder), r.baseBranch, shippedSha(lead, r.repo)).pipe(Effect.map((commits) => ({ ...r, commits }))),
      );
      const moving: Moving = {
        slice: lead.slice + 1,
        branch: sliceBranch(lead.title, lead.slice + 1, newId('s').slice(-4)),
        from: agent.branch,
        repos: lead.repos.map(({ repo, folder }) => ({ repo, folder })),
        carry: unshipped.filter((r) => r.commits.length).map(({ repo, commits }) => ({ repo, commits })),
      };
      // decided, and on disk before any checkout goes: a restart finishes the move from here (`move`)
      this.store.sliceJournal(agent.id, { kind: 'moving', ...moving });
      return yield* this.move(agent, moving);
    });
  }

  /**
   * Moves the lead's repos on to fresh code as `moving` says: the old checkouts go, every repo is checked out on the new
   * branch, and the commits that never shipped are brought over. Each step is safe to take again, so a move cut off part
   * way (Focus stopped, a checkout failed) is finished from the start. Succeeds with what the lead hears about it.
   */
  move(agent: LeadAgent, moving: Moving): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, ManagerServices> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const dir = (folder: string) => workspace.dir(leadWorktreeId(agent.id, folder));
      yield* Effect.forEach(moving.repos, (r) => workspace.remove(r.repo, leadWorktreeId(agent.id, r.folder)), { discard: true });
      const lead = agent.lead;
      // the lead moves on once: a move taken again after that only checks out what's missing
      if (lead.slice < moving.slice) {
        this.update(agent, { branch: moving.branch, lead: { ...lead, repos: [], slice: moving.slice, prs: [], shipped: undefined, landed: everyPr(lead), waypoints: nextWaypoints(lead, Date.now()) } });
      } else {
        this.update(agent, { branch: moving.branch, lead: { ...lead, repos: [] } });
      }
      yield* this.checkOutSlice(agent, this.store.project(agent.projectId).repos);
      const carried = yield* Effect.forEach(moving.carry, ({ repo, commits }) =>
        Effect.gen({ self: this }, function* () {
          const now = agent.lead.repos.find((r) => r.repo === repo);
          if (!now) return { folder: repo.split('/')[1], commits, applied: false };
          this.print(agent, [{ kind: 'system', text: `✻ Bringing ${commits.length} unshipped commit${commits.length === 1 ? '' : 's'} over to ./${now.folder}` }]);
          const applied = yield* workspace.cherryPick(dir(now.folder), commits).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
          return { folder: now.folder, commits, applied };
        }),
      );
      this.store.sliceJournal(agent.id, { kind: 'moved' });
      return [newSliceNote(agent.lead, agent.branch), carriedNote(carried, moving.from)].filter(Boolean).join('\n\n');
    });
  }

  /**
   * After a restart: each lead's pull requests are put right from their slice journal (one the saved state lost is
   * watched again), and a ship or a move to fresh code that Focus cut off is finished by Ops, with no Claude turn,
   * before the lead's own run picks back up (`recoverAgent`), so the two never ship at once. The leads it's finishing
   * something for: their runs are recovered once it's done.
   */
  recover(onKey: boolean): Set<string> {
    const later = new Set<string>();
    for (const agent of [...this.store.agents.values()]) {
      if (agent.task !== 'lead' || !hasLeadWork(agent)) continue;
      const journal = this.store.slice(agent.id);
      // a move under way has the slice's pull requests behind it already
      if (journal.phase !== 'moving') {
        const prs = reconciledPrs(agent.lead.prs, journal.prs);
        if (prs.length !== agent.lead.prs.length || prs.some((p, i) => p !== agent.lead.prs[i])) this.update(agent, { lead: { ...agent.lead, prs } });
      }
      const next = sliceRecovery(journal);
      if (next.kind === 'none') continue;
      later.add(agent.id);
      const { status, activity } = agent;
      const finish: Effect.Effect<string, GitHubError | GitFailed | Refused | NothingToCheckOut, ManagerServices> = next.kind === 'ship'
        ? this.shipLead(agent, next).pipe(Effect.map((said) => `Focus restarted while your slice was shipping, so Ops finished it:\n\n${said}`))
        : this.move(agent, next.moving).pipe(Effect.map((said) => `Focus restarted while your repos were moving to fresh code, so Ops finished the move:\n\n${said}`));
      this.print(agent, [{ kind: 'system', text: `✻ Focus restarted part way through ${next.kind === 'ship' ? 'shipping their slice' : 'moving their repos to fresh code'}: finishing that` }]);
      this.background(finish.pipe(
        // news for the lead, heard with the next message they get
        Effect.tap((said) => Effect.sync(() => this.core.leads.noteForLead(agent, 'Ops', said))),
        Effect.catch((err) => Effect.sync(() => {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't finish it: ${err.message}` }]);
          this.core.leads.noteForLead(agent, 'Ops', `Focus restarted part way through ${next.kind === 'ship' ? 'shipping your slice' : 'moving your repos to fresh code'}, and Ops couldn't finish it: ${err.message}`);
        })),
        // the ship marked them at work: they're as the restart left them, for their own run to pick up
        Effect.ensuring(Effect.sync(() => {
          this.update(agent, { status, activity });
          this.core.sessions.recoverAgent(agent, onKey);
        })),
      ));
    }
    return later;
  }

  /**
   * Where the lead's repos stand before their turn, and what they hear about it first (nothing, when nothing moved): a
   * move to fresh code that didn't finish (a checkout failed) finishes from what was decided; a slice that's landed moves
   * on; and a lead left with no repos (a move from before slices had a journal) has them checked out again.
   */
  beforeTurn(lead: LeadAgent): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, ManagerServices> {
    const moving = this.store.slice(lead.id).moving;
    if (moving) return this.move(lead, moving);
    if (sliceLanded(lead.lead.prs)) return this.nextSlice(lead);
    if (!lead.lead.repos.length) return this.reposBack(lead);
    return Effect.succeed('');
  }

  /** A lead left with no repos (a slice move whose checkout failed): every repo checked out again on their branch. Succeeds with what they hear. */
  reposBack(agent: LeadAgent): Effect.Effect<string, GitHubError | GitFailed | NothingToCheckOut, GitHub | Workspace> {
    return Effect.gen({ self: this }, function* () {
      this.print(agent, [{ kind: 'system', text: '✻ No repos are checked out (the last checkout didn’t finish): checking them out again' }]);
      yield* this.checkOutSlice(agent, this.store.project(agent.projectId).repos);
      return reposBackNote(agent.lead, agent.branch);
    });
  }

  /**
   * The lead's ship tool: pushes every repo with new commits and opens (or updates) its pull request, which QA then
   * reviews. Nothing ships while any repo has uncommitted changes.
   */
  shipLead(agent: Agent, input: ShipInput): Effect.Effect<string, GitHubError | GitFailed | Refused, GitHub | Workspace | Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!hasLeadWork(agent) || !agent.lead.repos.length) return yield* new Refused({ message: 'There’s nothing checked out to ship' });
      if (this.core.leads.closingGoals.has(agent.id)) return yield* new Refused({ message: 'The captain is closing the goal: nothing ships now' });
      // on disk before anything's pushed (unless it's a ship cut off before, being finished): a restart finishes it
      if (this.store.slice(agent.id).phase !== 'shipping') this.store.sliceJournal(agent.id, { kind: 'shipping', title: input.title, summary: input.summary, ...(input.recap && { recap: input.recap }) });
      return yield* this.ship(agent, input).pipe(
        // a ship that shipped nothing, failed (or hit a bug) is over; an interrupted one isn't: a restart finishes it
        Effect.tap(() => Effect.sync(() => this.shipEnded(agent.id))),
        Effect.tapCause((cause) => Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause)) this.shipEnded(agent.id, errorMessage(Cause.squash(cause)));
        })),
      );
    });
  }

  /** A pull request's description with the recap as the slice is now, in place of the one it had. */
  private updateRecap(agent: LeadAgent, repo: string, number: number, recap: SliceRecap): Effect.Effect<void, GitHubError, GitHub> {
    return Effect.gen({ self: this }, function* () {
      const github = yield* GitHub;
      const { body } = yield* this.retrying(agent, 'reading the pull request', github.getPullRequest(repo, number));
      yield* this.retrying(agent, 'updating its recap', github.editPullRequestBody(repo, number, withRecap(body, recapMarkdown(recap))));
    });
  }

  /**
   * The source files of the primitives at both ends of the map's arrows, by the workspace's paths, for their imports:
   * each primitive's first `MAX_FILES` that git tracks. A repo git can't list reads as having none.
   */
  private recapSources(recap: SliceRecap, repos: readonly { folder: string; dir: string }[]): Effect.Effect<Map<string, string>, never, Workspace> {
    return Effect.gen(function* () {
      const workspace = yield* Workspace;
      const sources = new Map<string, string>();
      for (const primitive of primitivesToRead(recap.primitives, recap.map ?? [])) {
        const files: string[] = [];
        for (const p of primitive.paths) {
          const [folder, ...rest] = p.replace(/^\.\//, '').split('/');
          const repo = repos.find((r) => r.folder === folder);
          if (!repo) continue;
          const listed = yield* workspace.runIn(repo.dir, ['git', 'ls-files', '--', rest.join('/') || '.'], 30_000);
          if (listed.code === 0) files.push(...listed.output.split('\n').filter((f) => SOURCE.test(f)).map((f) => `${folder}/${f}`));
        }
        for (const file of files.slice(0, MAX_FILES)) {
          if (sources.has(file)) continue;
          const [folder, ...rest] = file.split('/');
          const dir = repos.find((r) => r.folder === folder)?.dir;
          const text = dir ? yield* workspace.readIn(dir, rest.join('/')) : undefined;
          if (text !== undefined) sources.set(file, text);
        }
      }
      return sources;
    });
  }

  /** The ship's over without shipping, if the journal still has it under way. */
  private shipEnded(id: string, error?: string): void {
    if (this.store.slice(id).phase === 'shipping') this.store.sliceJournal(id, { kind: 'ship-ended', ...(error && { error }) });
  }

  private ship(agent: LeadAgent, input: ShipInput): Effect.Effect<string, GitHubError | GitFailed | Refused, GitHub | Workspace | Renderer> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      // a repo whose pull request merged moves to a fresh branch first: its own still carries the merged commits
      const title = input.title.trim() || `Slice ${work.slice}`;
      const moved = yield* this.freshBranches(agent, title);
      const movedNotes = moved.map(freshBranchNote);
      if (moved.some((m) => !m.applied)) return `Nothing shipped.\n\n${movedNotes.join('\n\n')}`;
      const states = yield* Effect.forEach(
        agent.lead.repos,
        (r) =>
          Effect.gen(function* () {
            const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
            const head = yield* workspace.head(dir);
            const shippedAt = openPr(work, r.repo)?.sha;
            const changed = !shippedAt || !sameCommit(head, shippedAt);
            return { ...r, dir, head, branch: repoBranch(r, agent.branch), changed, dirty: yield* workspace.hasUncommittedChanges(dir), ahead: yield* workspace.commitsAhead(dir, r.baseBranch) };
          }),
        { concurrency: 'unbounded' },
      );
      // Ops may have pushed a merge to the slice's branch (resolving conflicts): never ship over it
      for (const s of states.filter((x) => x.changed && openPr(work, x.repo))) {
        if (yield* workspace.missingRemoteCommits(s.dir, s.branch)) return yield* new Refused({ message: behindNote(s.folder, s.branch) });
      }
      const plan = shipPlan(states);
      if (plan.kind !== 'ship') return [notShipped(plan), ...movedNotes].join('\n\n');
      // the recap must cover every file the slice changes, in every repo, so nothing in it goes unseen
      let recap = input.recap;
      if (recap) {
        const changed = yield* Effect.forEach(states.filter((s) => s.ahead > 0), (s) => Effect.map(workspace.changedFiles(s.dir, s.baseBranch), (files) => files.map((f) => `${s.folder}/${f}`)));
        const problems = recapProblems(recap, changed.flat());
        if (problems.length) return yield* new Refused({ message: `Nothing shipped: the recap needs fixing first.\n\n${problems.map((p) => `- ${p}`).join('\n')}` });
        // each of the map's arrows marked whether an import stands behind it
        if (recap.map?.length) recap = { ...recap, map: backedMap(recap.primitives, recap.map, yield* this.recapSources(recap, states)) };
        // kept before any pull request opens or moves, so a ship read as it lands is read as shipped
        this.update(agent, { lead: { ...agent.lead, shipped: { title, summary: input.summary, recap } } });
      }
      const project = this.store.project(agent.projectId);
      const lines: string[] = [];
      const toReview: { repo: string; number: number; head: string }[] = [];
      for (const shipping of states.filter((x) => plan.repos.includes(x.repo))) {
        const s = { ...shipping, branch: yield* this.nameAfterWork(agent, shipping, title, lines) };
        this.update(agent, { status: 'pushing', activity: `Shipping ${s.repo}` });
        this.print(agent, [{ kind: 'system', text: `✻ Pushing ${s.branch} in ${s.repo}` }]);
        yield* this.retrying(agent, `the push in ${s.repo}`, workspace.push(s.dir, s.branch));
        // the captain may have merged or closed it while the push was under way: as the lead's pull requests are now
        const next = afterPush(openPr(work, s.repo), agent.lead, s.repo);
        if (next.kind === 'landed') {
          lines.push(landedMidShipNote(next.pr));
          this.print(agent, [{ kind: 'system', text: `✻ ${s.repo}#${next.pr.number} was ${next.pr.outcome} while the ship was pushing to it` }]);
          continue;
        }
        const found = next.kind === 'update' ? next.pr : yield* this.retrying(agent, 'looking for the pull request', github.findPullRequest(s.repo, s.branch));
        let pr: { number: number; url: string };
        if (found) {
          pr = found;
          lines.push(`Updated ${s.repo}#${pr.number}: ${pr.url}`);
          // the description keeps what it opened with, its recap now as the slice is
          if (recap) yield* this.updateRecap(agent, s.repo, pr.number, recap);
        } else {
          const alongside = plan.repos.filter((r) => r !== s.repo);
          const body = leadPrBody(input.summary, agent, alongside, this.store.settings.attribution, recap && recapMarkdown(recap));
          pr = yield* this.retrying(agent, 'opening the pull request', github.createPullRequest(s.repo, { head: s.branch, base: s.baseBranch, title, body }));
          lines.push(`Opened ${s.repo}#${pr.number}: ${pr.url}`);
          this.hub.toast('success', `🎉 ${agent.name} opened ${s.repo.split('/')[1]}#${pr.number}: ${title}`, agent.id);
        }
        // a lane raised before stays raised: the lead's pick only ever takes it higher
        const raised = agent.lead.prs.find((p) => p.repo === s.repo && p.number === pr.number)?.raised;
        const lane = raised ? higherLane(recapLane(recap), raised.lane) : recapLane(recap);
        this.store.sliceJournal(agent.id, { kind: 'pr', repo: s.repo, number: pr.number, url: pr.url, sha: s.head, branch: s.branch, lane });
        const others = agent.lead.prs.filter((p) => !(p.repo === s.repo && p.number === pr.number));
        this.update(agent, { lead: { ...agent.lead, prs: [...others, { repo: s.repo, number: pr.number, url: pr.url, sha: s.head, branch: s.branch, lane, ...(raised && { raised }) }] } });
        this.print(agent, [{ kind: 'success', text: `✔ ${lines.at(-1)}` }]);
        toReview.push({ repo: s.repo, number: pr.number, head: s.head });
      }
      // only now the slice's PRs are all open, so QA checks each out with the others beside it
      for (const pr of autoQaFor(project) ? toReview : []) {
        try {
          this.core.reviews.requestReview(agent.projectId, pr.repo, pr.number, title, undefined, false, pr.head);
        } catch (err) {
          this.print(agent, [{ kind: 'error', text: `✘ Couldn't hand ${pr.repo}#${pr.number} to QA: ${errorMessage(err)}` }]);
        }
      }
      this.store.sliceJournal(agent.id, { kind: 'shipped' });
      // the recap up on the station's screen, where Comms shows it with the lead's turn: a picture that won't go up loses nothing
      if (recap) yield* Effect.ignore(this.core.goalTools.showArtifact(agent, { id: 'system-recap', title: `System recap: ${title}`.slice(0, 80), html: recapPage(recap, title) }));
      this.update(agent, { status: 'working', activity: 'Shipped the slice', lead: { ...agent.lead, waypoints: shippedWaypoint(agent.lead, { title, summary: input.summary }, Date.now()) } });
      this.boardChanged(agent.projectId);
      return [shipped(lines, autoQaFor(project)), ...movedNotes].join('\n\n');
    });
  }

  /**
   * The branch a repo ships from: at its first ship in the slice, Ops renames the slice's working branch after
   * the slice's work (`shipBranch`), so the pull request's branch says what it does. A repo with a pull request open
   * keeps the branch it's on, and so does one git won't rename (the name's taken).
   */
  private nameAfterWork(agent: LeadAgent, s: { repo: string; folder: string; dir: string; branch: string }, title: string, lines: string[]): Effect.Effect<string, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const named = openPr(agent.lead, s.repo) ? undefined : shipBranch(title, s.branch);
      if (!named || named === s.branch) return s.branch;
      const workspace = yield* Workspace;
      const renamed = yield* workspace.renameBranch(s.dir, s.branch, named).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
      if (!renamed) return s.branch;
      this.print(agent, [{ kind: 'system', text: `✻ Renamed ${s.branch} to ${named} in ${s.repo}, after the slice's work` }]);
      this.update(agent, { lead: { ...agent.lead, repos: agent.lead.repos.map((x) => (x.repo === s.repo ? { ...x, branch: named } : x)) } });
      lines.push(`./${s.folder} is now on \`${named}\`, named after the slice's work.`);
      return named;
    });
  }

  /**
   * Moves each of the lead's repos whose pull request merged (`needsFreshBranch`) onto a new branch from its base, with
   * the commits that hadn't shipped cherry-picked onto it. A repo with uncommitted changes stays put: it can't ship yet.
   */
  private freshBranches(agent: LeadAgent, title: string): Effect.Effect<FreshBranch[], GitFailed, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const workspace = yield* Workspace;
      const moved: FreshBranch[] = [];
      for (const r of agent.lead.repos) {
        const work = agent.lead;
        const from = repoBranch(r, agent.branch);
        if (!needsFreshBranch(work, r.repo, from)) continue;
        const dir = workspace.dir(leadWorktreeId(agent.id, r.folder));
        if (yield* workspace.hasUncommittedChanges(dir)) continue;
        const commits = yield* workspace.unshippedCommits(dir, r.baseBranch, shippedSha(work, r.repo));
        const working = sliceBranch(work.title, work.slice, newId('s').slice(-4));
        const to = shipBranch(title, working) ?? working;
        this.print(agent, [{ kind: 'system', text: `✻ ${r.repo}'s pull request from ${from} has merged: starting ${to} from ${r.baseBranch}` }]);
        yield* workspace.freshBranch(dir, to, r.baseBranch);
        yield* this.install(agent, dir);
        this.update(agent, { lead: { ...agent.lead, repos: agent.lead.repos.map((x) => (x.repo === r.repo ? { ...x, branch: to } : x)) } });
        const applied = commits.length ? yield* workspace.cherryPick(dir, commits).pipe(Effect.as(true), Effect.orElseSucceed(() => false)) : true;
        if (commits.length) this.print(agent, [{ kind: 'system', text: applied ? `✻ Brought ${commits.length} unshipped commit${commits.length === 1 ? '' : 's'} over to ${to}` : `✻ The unshipped commits didn't apply cleanly to ${to}: they're still on ${from}` }]);
        moved.push({ folder: r.folder, from, to, baseBranch: r.baseBranch, commits, applied });
      }
      return moved;
    });
  }
}
