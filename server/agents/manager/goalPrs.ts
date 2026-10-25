import { Effect, Option } from 'effect';
import { higherLane, type Lane, laneName, raisedPrs, raisedSaid } from '../../../shared/mergeLane';
import { autoQaFor, prKey } from '../../../shared/qa';
import type { Agent, LeadPr, PrReview, PullRequest, ReviewComment } from '../../../shared/types';
import { GitHub, type GitHubError } from '../../github/service';
import { everyPr, hasLeadWork, landedNote, leadWorktreeId, sliceLanded } from '../lead';
import { claims, filedClaims, readyPrs, retestAfterTurn, reviewNote, type SeenBranches, unheardReviews } from '../prRules';
import { writeRefused } from '../pushGuard';
import { diffFiles, type RecapInput, recapLane, recapMarkdown, recapPage, recapProblems, type SliceRecap, withRecap } from '../recap';
import { backedMap, MAX_FILES, primitivesToRead, SOURCE } from '../recapImports';
import { type Renderer, Workspace } from '../services';
import { nextWaypoints, shippedWaypoint } from '../waypoints';
import { Part, Refused } from './core';

/**
 * A goal's pull requests: which are its (the ones its lead opened from branches their checkouts have been on), where each
 * stands (ready, re-tested, landed), the lane its recap gives it, and the pushes its lead is refused. The rules are pure
 * functions in prRules.ts and pushGuard.ts; this is their I/O, run as the board refreshes and the lead's turns start and end.
 */
export class GoalPrs extends Part {
  /** The lead whose open pull request this is, if any. */
  ownerOf(repo: string, number: number): Agent | undefined {
    return [...this.store.agents.values()].find((a) => a.task === 'lead' && a.lead?.prs.some((p) => p.repo === repo && p.number === number && !p.outcome));
  }

  /** The leads' pull requests still open, for Ops to notice when they're merged or closed on GitHub. */
  open(projectId: string): Pick<LeadPr, 'repo' | 'number' | 'lane'>[] {
    return this.store.agentsIn(projectId).flatMap((a) => (a.task === 'lead' ? (a.lead?.prs ?? []).filter((p) => !p.outcome) : []));
  }

  /**
   * The board refreshed: the goals claim the pull requests their leads opened, note those gone ready, send them to QA,
   * and their leads hear the reviews on them they haven't.
   */
  async boardRefreshed(projectId: string, prs: readonly PullRequest[]): Promise<void> {
    await this.claim(projectId, prs);
    this.sendReady(projectId, prs);
    await this.hearReviews(projectId, prs);
  }

  /** A lead's turn starts: their pushes are held to the goal as it is now. */
  turnStarts(leadId: string): void {
    this.guardPushes(leadId);
  }

  /** As the lead's turn ends, their ready PRs with a verdict go back to QA, which re-tests the ones they pushed to (`retestAfterTurn`). */
  turnEnded(leadId: string): void {
    const lead = this.store.agents.get(leadId);
    if (!lead || !hasLeadWork(lead) || !autoQaFor(this.store.project(lead.projectId))) return;
    const board = this.store.boards.get(lead.projectId)?.prs ?? [];
    for (const pr of retestAfterTurn(lead.lead.prs, board, (repo, number) => this.store.reviews.get(prKey(repo, number)))) {
      this.core.reviews.requestReview(lead.projectId, pr.repo, pr.number, pr.title);
    }
  }

  /** The lead's pull request was merged or closed. Once the slice's have all landed, the goal moves on to its next slice and the lead hears about it. */
  landed(repo: string, number: number, merged: boolean): boolean {
    const lead = this.ownerOf(repo, number);
    if (!lead?.lead) return false;
    const prs = lead.lead.prs.map((p) => (p.repo === repo && p.number === number ? { ...p, outcome: merged ? ('merged' as const) : ('closed' as const) } : p));
    const work = { ...lead.lead, prs };
    // every pull request of the slice in: the goal moves on to its next slice there and then, its checkouts as they are
    const landed = sliceLanded(prs);
    this.update(lead, { lead: landed ? { ...work, slice: work.slice + 1, prs: [], landed: everyPr(work), waypoints: nextWaypoints(work, Date.now()) } : work });
    if (merged) this.guardPushes(lead.id);
    this.print(lead, [{ kind: merged ? 'success' : 'system', text: `${merged ? '🎉' : '✻'} ${repo}#${number} was ${merged ? 'merged' : 'closed'}` }]);
    if (landed) {
      this.core.ledger.digestSession(lead, prs.map((p) => ({ repo: p.repo, pr: p.number })));
      this.core.leads.noteForLead(lead, 'Ops', landedNote(work), { kind: 'slice-landed', slice: work.slice });
    }
    return true;
  }

  /**
   * The lead's recap on one of the goal's open pull requests: checked to cover every file it changes, then put in its
   * description and on their station's screen, and its lane set from it (never below a raise). Refused, in words, for a
   * pull request the goal isn't following, or a recap that needs fixing.
   */
  recap(agent: Agent, input: RecapInput): Effect.Effect<string, GitHubError | Refused, GitHub | Workspace | Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!hasLeadWork(agent)) return yield* new Refused({ message: 'There’s no goal under way here' });
      const where = `${input.repo}#${input.number}`;
      const held = agent.lead.prs.find((p) => p.repo === input.repo && p.number === input.number && !p.outcome);
      if (!held) return yield* new Refused({ message: `${where} isn’t one of this goal’s open pull requests: Ops follows one you opened within a minute of it opening` });
      const folder = agent.lead.repos.find((r) => r.repo === input.repo)?.folder;
      if (!folder) return yield* new Refused({ message: `${input.repo} isn’t one of this goal’s repos` });
      const github = yield* GitHub;
      const workspace = yield* Workspace;
      const changed = diffFiles(yield* this.retrying(agent, 'reading the pull request’s diff', github.pullRequestDiff(input.repo, input.number))).map((f) => `${folder}/${f}`);
      const problems = recapProblems(input.recap, changed);
      if (problems.length) return yield* new Refused({ message: `The recap needs fixing first.\n\n${problems.map((p) => `- ${p}`).join('\n')}` });
      const repos = agent.lead.repos.map((r) => ({ folder: r.folder, dir: workspace.dir(leadWorktreeId(agent.id, r.folder)) }));
      const recap = input.recap.map?.length ? { ...input.recap, map: backedMap(input.recap.primitives, input.recap.map, yield* this.recapSources(input.recap, repos)) } : input.recap;
      const detail = yield* this.retrying(agent, 'reading the pull request', github.getPullRequest(input.repo, input.number));
      yield* this.retrying(agent, 'putting the recap in it', github.editPullRequestBody(input.repo, input.number, withRecap(detail.body, recapMarkdown(recap))));
      // a lane raised before stays raised: the lead's pick only ever takes it higher
      const now = this.store.agent(agent.id);
      const work = hasLeadWork(now) ? now.lead : agent.lead;
      const lane = held.raised ? higherLane(recapLane(recap), held.raised.lane) : recapLane(recap);
      const prs = work.prs.map((p) => (p.repo === input.repo && p.number === input.number ? { ...p, lane, sha: detail.headSha, recap: { title: detail.title, summary: detail.body, recap } } : p));
      this.update(agent, { lead: { ...work, prs } });
      yield* Effect.ignore(this.core.goalTools.showArtifact(agent, { id: `system-recap-${input.number}`, title: `System recap: ${detail.title}`.slice(0, 80), html: recapPage(recap, detail.title) }));
      this.boardChanged(agent.projectId);
      return `The recap is on ${where}, which merges in ${laneName(lane)} once QA passes it${lane !== recapLane(recap) ? ' (raised before: it stays there)' : ''}.`;
    });
  }

  /**
   * A plugin (`by`, its id) raises the lane of a goal's lead's open pull requests to `lane`, saying why: each in a lower
   * lane goes up (docs/merging.md#lanes-how-a-goals-leads-slice-merges), with a ledger line and a comment on it; none
   * comes down. Only `only`, when it's given. What it raised, by repo#number.
   */
  raiseLane(leadId: string, lane: Lane, why: string, by: string, only?: { repo: string; number: number }): string[] {
    const lead = this.store.agents.get(leadId);
    if (lead?.task !== 'lead' || !lead.lead) return [];
    const { prs, from } = raisedPrs(lead.lead.prs, lane, { by, why }, only);
    if (!from.size) return [];
    this.update(lead, { lead: { ...lead.lead, prs } });
    for (const [pr, was] of from) {
      this.core.ledger.record(lead.projectId, { kind: 'lane-raised', repo: pr.repo, pr: pr.number, goal: lead.lead.title, from: was, to: lane, by, why });
      this.background(GitHub.use((gh) => gh.commentOnPullRequest(pr.repo, pr.number, raisedSaid(was, lane))).pipe(Effect.ignore));
    }
    const where = [...from.keys()].map((p) => `${p.repo.split('/')[1]}#${p.number}`);
    this.hub.toast('info', `⬆ ${where.join(', ')} raised to ${lane[0].toUpperCase()}${lane.slice(1)}: ${why}`, lead.id);
    this.boardChanged(lead.projectId);
    return where;
  }

  /**
   * Writes which branches the lead's pushes are refused for (`refusedPushes`): before each of their turns, and as a pull
   * request of theirs merges, so a push mid-turn is held to it too.
   */
  guardPushes(leadId: string): void {
    const lead = this.store.agents.get(leadId);
    if (!lead || !hasLeadWork(lead)) return;
    writeRefused(lead.id, lead.lead);
  }

  /**
   * Claims the board's PRs that the project's leads opened themselves (`claims`), each with the ledger line and a line
   * on the lead's station, and writes a ready line for each goal PR seen ready for review the first time. A checkout git
   * can't read claims nothing this time round: the next refresh looks again.
   */
  private async claim(projectId: string, prs: readonly PullRequest[]): Promise<void> {
    const checkouts = this.store.agentsIn(projectId).filter(hasLeadWork).flatMap((lead) => lead.lead.repos.map((r) => ({ leadId: lead.id, repo: r.repo, folder: r.folder })));
    const seen = await this.runtime.runPromise(Effect.gen(function* () {
      const workspace = yield* Workspace;
      const read = yield* Effect.forEach(checkouts, (c) => workspace.branchesSeen(workspace.dir(leadWorktreeId(c.leadId, c.folder))).pipe(
        Effect.map((branches): SeenBranches[] => [{ leadId: c.leadId, repo: c.repo, branches }]),
        Effect.orElseSucceed((): SeenBranches[] => []),
      ));
      return read.flat();
    }));
    const held = (repo: string, number: number) => !!this.core.seating.prOwner(repo, number)
      || [...this.store.agents.values()].some((a) => a.lead?.prs.some((p) => p.repo === repo && p.number === number));
    const claimed = claims(prs, seen, held);
    for (const claim of claimed) {
      const lead = this.store.agents.get(claim.leadId);
      if (!lead || !hasLeadWork(lead)) continue;
      this.update(lead, { lead: { ...lead.lead, prs: [...lead.lead.prs, claim.pr] } });
      this.core.ledger.record(projectId, { kind: 'pr', repo: claim.pr.repo, pr: claim.pr.number, goal: lead.lead.title, lead: lead.id, agent: lead.name, branch: claim.pr.branch, draft: claim.draft });
      this.print(lead, [{ kind: 'system', text: `✻ Ops is following ${claim.pr.repo}#${claim.pr.number}${claim.draft ? ', a draft,' : ''} as this goal's: it was opened from ${claim.pr.branch}` }]);
    }
    // one opened from a closed goal's branch as it closed stays with that goal
    const project = this.store.project(projectId);
    for (const filed of filedClaims(prs, project.goals ?? [], held)) {
      const goal = project.goals?.find((g) => g.id === filed.goalId);
      if (!goal) continue;
      project.goals = project.goals?.map((g) => (g.id === goal.id ? { ...g, prs: [...g.prs, filed.pr] } : g));
      this.core.ledger.record(projectId, { kind: 'pr', repo: filed.pr.repo, pr: filed.pr.number, goal: goal.title, lead: goal.id, agent: goal.leadName, branch: filed.pr.branch, draft: filed.draft });
      this.projectsChanged();
    }
    const readied = (repo: string, number: number) => this.store.ledger.some((e) => e.kind === 'pr-ready' && e.repo === repo && e.pr === number);
    for (const pr of readyPrs(prs, (repo, number) => !!this.ownerOf(repo, number), readied)) {
      const lead = this.ownerOf(pr.repo, pr.number);
      if (!lead?.lead) continue;
      this.core.ledger.record(projectId, { kind: 'pr-ready', repo: pr.repo, pr: pr.number, goal: lead.lead.title, lead: lead.id, agent: lead.name, branch: pr.branch });
      // the chart's waypoint for the slice takes what it set out to do from the first of its pull requests to go out
      this.update(lead, { lead: { ...lead.lead, waypoints: shippedWaypoint(lead.lead, { title: pr.title, summary: '' }, Date.now()) } });
    }
    if (claimed.length) this.boardChanged(projectId);
  }

  /**
   * The reviews on the goals' open pull requests that their leads haven't heard (`unheardReviews`): every one's comments
   * on the code read from GitHub first, then, all together, a note for each lead (`reviewNote`) and the review marked
   * heard on its pull request, so a review reaches them once, and a restart part way leaves none half told. A review
   * GitHub won't give the comments of waits for the next refresh.
   */
  private async hearReviews(projectId: string, prs: readonly PullRequest[]): Promise<void> {
    const read: { leadId: string; repo: string; number: number; review: PrReview; comments: ReviewComment[] }[] = [];
    for (const lead of this.store.agentsIn(projectId).filter(hasLeadWork)) {
      for (const { repo, number, ...held } of lead.lead.prs) {
        for (const review of unheardReviews(held, prs.find((p) => p.repo === repo && p.number === number))) {
          const comments = await this.runtime.runPromise(GitHub.use((gh) => gh.reviewComments(repo, review.id)).pipe(Effect.option));
          if (Option.isSome(comments)) read.push({ leadId: lead.id, repo, number, review, comments: comments.value });
        }
      }
    }
    for (const { leadId, repo, number, review, comments } of read) {
      // heard while GitHub answered (a refresh at the same time), or no longer the goal's: nothing to tell
      const lead = this.store.agents.get(leadId);
      const pr = lead?.lead?.prs.find((p) => p.repo === repo && p.number === number && !p.outcome);
      if (!lead?.lead || !pr || pr.heardReviews?.includes(review.id)) continue;
      const note = reviewNote(repo, number, review, comments);
      if (note) this.core.leads.noteForLead(lead, 'GitHub', note, { kind: 'pr-review', repo, number, state: review.state, author: review.author });
      this.update(lead, { lead: { ...lead.lead, prs: lead.lead.prs.map((p) => (p === pr ? { ...p, heardReviews: [...(p.heardReviews ?? []), review.id] } : p)) } });
    }
  }

  /** The goal PRs on the board that are ready and QA hasn't looked at go to QA, where the project sends PRs to QA itself. */
  private sendReady(projectId: string, prs: readonly PullRequest[]): void {
    if (!autoQaFor(this.store.project(projectId))) return;
    const goals = (repo: string, number: number) => !!this.ownerOf(repo, number);
    for (const pr of readyPrs(prs, goals, (repo, number) => this.store.reviews.has(prKey(repo, number)))) {
      this.core.reviews.requestReview(projectId, pr.repo, pr.number, pr.title);
    }
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
}
