import type { Layer } from 'effect';
import { type CaptainAnswer, landed } from '../../shared/captainAnswer';
import type { Closer, LedgerEntry, ReportCard } from '../../shared/ledger';
import type { Agent, Autonomy, CodingAgent, ConflictsOutcome, Effort, FailedCheck, LeadPr, MergeCheck, MessageReply, PullRequest, QaChatReply, QaPlaybook, QaReview, QueuedGoal, ResumeHow, TermEntry, TextLine, WorkflowScript } from '../../shared/types';
import type { SessionExtras } from './types';
import type { Hub } from '../hub';
import type { FocusPlugin } from '../plugins/contract';
import type { Plugins } from '../plugins/registry';
import type { Store } from '../store';
import type { Transcript } from './transcript';
import { keyFallback } from './apiKey';
import { Comms } from './manager/comms';
import { Conflicts } from './manager/conflicts';
import { Delivery } from './manager/delivery';
import { GoalTools } from './manager/goalTools';
import { Leads } from './manager/leads';
import { Ledger } from './manager/ledger';
import { Merges, type MergeHow, type MergeTarget } from './manager/merges';
import { PlanLimit } from './manager/planLimit';
import { type Lent, pluginHost } from './manager/pluginHost';
import { Reviews } from './manager/reviews';
import { Seating } from './manager/seating';
import { AgentSessions, backgroundOutputLines, workflowAgentLines, workflowScript } from './manager/sessions';
import { Checkouts } from './manager/checkouts';
import { GoalPrs } from './manager/goalPrs';
import { Stacks } from './manager/stacks';
import { Triages } from './manager/triages';
import { Core, type ManagerServices } from './manager/core';

/**
 * Hires agents, seats them at desks, runs them, and turns their work into pull requests: Focus's one way in to its
 * agents, for the routes and its loops.
 *
 * Each concern is a part of its own in `manager/` (seating, sessions, delivery, conflicts, leads, slices, goal tools,
 * comms, reviews, triages, the ledger, merges, the plan's usage limit, stacked waypoints), sharing the `Core` (`manager/core.ts`): the store and hub, the one
 * runtime, and each agent's fiber (`runs`), so they never run twice at once and sending them home interrupts it (and
 * with it their Claude Code session). The public methods below each hand over to their part.
 */
export class AgentManager {
  private readonly core: Core;

  constructor(store: Store, hub: Hub, services: Layer.Layer<ManagerServices>, boardChanged: (projectId: string) => void, version?: string) {
    this.core = new Core(store, hub, services, boardChanged, version);
    this.core.comms = new Comms(this.core);
    this.core.conflicts = new Conflicts(this.core);
    this.core.delivery = new Delivery(this.core);
    this.core.goalTools = new GoalTools(this.core);
    this.core.leads = new Leads(this.core);
    this.core.ledger = new Ledger(this.core);
    this.core.merges = new Merges(this.core);
    this.core.planLimit = new PlanLimit(this.core);
    this.core.reviews = new Reviews(this.core);
    this.core.seating = new Seating(this.core);
    this.core.sessions = new AgentSessions(this.core);
    this.core.checkouts = new Checkouts(this.core);
    this.core.goalPrs = new GoalPrs(this.core);
    this.core.stacks = new Stacks(this.core);
    this.core.triages = new Triages(this.core);
  }

  /** Reads an agent session's Claude Code transcript by its id (missing in the demo, which has none). */
  get readTranscript(): Ledger['readTranscript'] {
    return this.core.ledger.readTranscript;
  }

  set readTranscript(read: Ledger['readTranscript']) {
    this.core.ledger.readTranscript = read;
  }


  /** Titles a new goal from the captain's first words (missing in the demo, whose goals keep them). */
  set titleGoal(titler: Leads['titleGoal']) {
    this.core.leads.titleGoal = titler;
  }

  /** The agents' transcripts on this machine, for digesting the ones from before digests began. */
  get transcripts(): Ledger['transcripts'] {
    return this.core.ledger.transcripts;
  }

  set transcripts(transcripts: Ledger['transcripts']) {
    this.core.ledger.transcripts = transcripts;
  }

  hire(projectId: string, repo: string, issue: { number: number; title?: string; url?: string }, how: { effort?: Effort; agent?: CodingAgent } = {}): Agent {
    return this.core.seating.hire(projectId, repo, issue, how);
  }

  /** Merges a pull request once its merge check passes, or the captain merges past it (`Merges.merge`): the commit merged. */
  merge(projectId: string, pr: MergeTarget, how: MergeHow): Promise<string> {
    return this.core.merges.merge(projectId, pr, how);
  }

  /** Where a PR's merge check on its head stands, for its card. */
  mergeCheck(pr: Pick<PullRequest, 'repo' | 'number' | 'headSha'>): MergeCheck | undefined {
    return this.core.merges.checkOf(pr);
  }

  resolveConflicts(projectId: string, pr: PullRequest): Promise<ConflictsOutcome> {
    return this.core.conflicts.resolveConflicts(projectId, pr);
  }

  openedByOffice(repo: string, number: number): boolean {
    return this.core.seating.openedByOffice(repo, number);
  }

  /** Ops opened the PR: one of its developers', a plugin's brief, or a goal's slice. */
  opsPr(repo: string, number: number): boolean {
    return this.core.seating.openedByOffice(repo, number) || !!this.core.goalPrs.ownerOf(repo, number);
  }

  busyOn(repo: string, number: number): boolean {
    return this.core.seating.busyOn(repo, number);
  }

  /**
   * After a restart: each QA review, each goal that was closing, each question a turn was waiting on, then each agent's
   * run picks up from its journal (`Reviews.recover`, `Leads.recoverCloses`, `GoalTools.recover`, `AgentSessions.recover`).
   */
  recover(): void {
    const rooms = this.core.reviews.recover(keyFallback.onKey());
    const closing = this.core.leads.recoverCloses(keyFallback.onKey());
    this.core.goalTools.recover();
    this.core.sessions.recover(keyFallback.onKey(), new Set(closing));
    for (const room of rooms) this.core.reviews.nextReview(room);
  }

  /** A lead's extras for a session the host resumes after a restart (`AgentSessions.sessionExtras`). */
  sessionExtras(agentId: string): SessionExtras | undefined {
    return this.core.sessions.sessionExtras(agentId);
  }

  /** Focus is shutting down (`AgentSessions.shutDown`). */
  shutDown(): void {
    this.core.sessions.shutDown();
  }

  schedule(): void {
    this.core.seating.schedule();
  }

  compactNow(id: string): Promise<Agent> {
    return this.core.sessions.compactNow(id);
  }

  startGoal(projectId: string, text: string, how: { effort?: Effort; from?: string; shaping?: boolean } = {}): { agent: Agent } {
    return this.core.leads.startGoal(projectId, text, how);
  }

  reopenGoal(projectId: string, goalId: string): Agent {
    return this.core.leads.reopenGoal(projectId, goalId);
  }

  /** Puts a goal in line without starting it: the user starts it. */
  queueGoal(projectId: string, text: string, how: { effort?: Effort; from?: string; shaping?: boolean } = {}): QueuedGoal {
    return this.core.leads.queueGoal(projectId, text, how);
  }

  startQueued(projectId: string, queueId: string, edits: { text?: string; effort?: Effort; shaping?: boolean } = {}): Agent {
    return this.core.leads.startQueued(projectId, queueId, edits);
  }

  dropQueued(projectId: string, queueId: string): void {
    this.core.leads.dropQueued(projectId, queueId);
  }

  moveQueued(projectId: string, queueId: string, by: number): void {
    this.core.leads.moveQueued(projectId, queueId, by);
  }

  answer(id: string, questionId: string, option: string, note?: string, how?: ResumeHow): Agent | MessageReply {
    return this.core.goalTools.answer(id, questionId, option, note, how);
  }

  closeGoal(id: string, force = false): Promise<{ closed: true } | { warn: string[] }> {
    return this.core.leads.closeGoal(id, force);
  }

  /** The script behind one of a lead's workflows, with what it has logged and returned so far. */
  workflowScript(id: string, workflowId: string): WorkflowScript {
    return workflowScript(this.core.runtimes.get(id), workflowId);
  }

  /** What one of a lead's workflow agents has done so far, from the transcript Claude Code writes as it works. */
  workflowAgentLines(id: string, workflowId: string, agentId: string): TermEntry[] {
    return workflowAgentLines(this.core.runtimes.get(id), workflowId, agentId);
  }

  /** The end of one of a lead's background commands' output, from the file it writes to. */
  backgroundOutput(id: string, taskId: string): TextLine[] {
    return backgroundOutputLines(this.core.runtimes.get(id), taskId);
  }

  /** Stops one of a lead's background commands or monitors, and tells the lead (`Comms.stopBackground`). */
  stopBackground(id: string, taskId: string): Promise<{ stopped: boolean }> {
    return this.core.comms.stopBackground(id, taskId);
  }

  setEffort(id: string, effort: Effort): Agent {
    return this.core.comms.setEffort(id, effort);
  }

  setAutonomy(id: string, autonomy: Autonomy): Agent {
    return this.core.comms.setAutonomy(id, autonomy);
  }

  /**
   * A project's board refreshed: its goals claim the pull requests their leads opened, those ready go to QA, and their
   * stacked waypoints move onto the branches below them.
   */
  async boardRefreshed(projectId: string, prs: readonly PullRequest[]): Promise<void> {
    await this.core.goalPrs.boardRefreshed(projectId, prs);
    await this.core.stacks.boardRefreshed(projectId, prs);
  }

  /** Why the merge gate holds a goal's pull request, if it does: its waypoint is stacked on one that hasn't landed. */
  landingHold(repo: string, number: number): string | undefined {
    return this.core.goalPrs.landingHold(repo, number);
  }

  leadPrs(projectId: string): Pick<LeadPr, 'repo' | 'number' | 'lane'>[] {
    return this.core.goalPrs.open(projectId);
  }

  requestReview(projectId: string, repo: string, number: number, title: string, retryNote?: string, asked = false, shippedHead?: string): QaReview {
    return this.core.reviews.requestReview(projectId, repo, number, title, retryNote, asked, shippedHead);
  }

  qaPlaybook(projectId: string): Promise<QaPlaybook> {
    return this.core.reviews.playbook(projectId);
  }

  qaChat(projectId: string, messages: unknown): Promise<QaChatReply> {
    return this.core.reviews.chat(projectId, messages);
  }

  requestMerge(repo: string, number: number, on: boolean): QaReview {
    return this.core.reviews.requestMerge(repo, number, on);
  }

  sendBackChecks(repo: string, number: number, checks: FailedCheck[]): Promise<void> {
    return this.core.reviews.sendBackChecks(repo, number, checks);
  }

  reviewGone(repo: string, number: number, merged: boolean): void {
    this.core.reviews.reviewGone(repo, number, merged);
  }

  /** The captain ticks off (or un-ticks) a spot-check on a slice of a goal under way. */
  tickSpotCheck(id: string, slice: number, index: number, checked: boolean): void {
    this.core.leads.tickSpotCheck(id, slice, index, checked);
  }

  /** The captain spins one of a goal's open contacts off as a goal of its own. */
  spinOffContact(id: string, contactId: string, text: string): { agent: Agent } {
    return this.core.leads.spinOffContact(id, contactId, text);
  }

  /** The captain spins one of a goal's ideas for next off as a goal of its own. */
  spinOffIdea(id: string, idea: string, text: string): { agent: Agent } {
    return this.core.leads.spinOffIdea(id, idea, text);
  }

  readTurn(id: string): void {
    this.core.comms.readTurn(id);
  }

  /**
   * The captain answers an agent from its panel (`act`, answered `answer`): once it's gone through (`landed`), the
   * plugins hear of it, with the agent as it stood before it (`PluginParts.captainAnswered`).
   */
  async captainAnswers<T>(id: string, answer: CaptainAnswer, act: () => T | Promise<T>): Promise<T> {
    const agent = this.core.store.agents.get(id);
    const before = agent && structuredClone(agent);
    const reply = await act();
    if (before && landed(reply)) this.core.plugins.captainAnswered(before, answer);
    return reply;
  }

  message(id: string, text: string, from?: string, how?: ResumeHow): MessageReply {
    return from === undefined ? this.core.goalTools.captainMessage(id, text, how) : this.core.comms.message(id, text, from, how);
  }

  resolvePermission(id: string, requestId: string, allow: boolean): void {
    this.core.comms.resolvePermission(id, requestId, allow);
  }

  stop(id: string): void {
    this.core.comms.stop(id);
  }

  dismiss(id: string): Promise<void> {
    return this.core.seating.dismiss(id);
  }

  prClosed(repo: string, number: number, merged: boolean, by: Closer = 'github', headSha?: string): void {
    this.core.seating.prClosed(repo, number, merged, by, headSha);
  }

  recordLanding(repo: string, number: number, merged: boolean, by: Closer = 'github', headSha?: string): void {
    this.core.ledger.recordLanding(repo, number, merged, by, headSha);
  }

  undigested(): Promise<Transcript[]> {
    return this.core.ledger.undigested();
  }

  backfill(): Promise<{ sessions: number }> {
    return this.core.ledger.backfill();
  }

  /** Keeps the captain's replies to leads from spans digested before they were kept (`Ledger.backfillReplies`). */
  backfillReplies(): Promise<{ spans: number }> {
    return this.core.ledger.backfillReplies();
  }

  record(projectId: string, entry: LedgerEntry, at = Date.now()): string | undefined {
    return this.core.ledger.record(projectId, entry, at);
  }

  /** Starts the plugins switched on (docs/plugins.md), lending each the manager's seating and terminals, and what Focus lends. */
  startPlugins(plugins: FocusPlugin[], lent: Lent): void {
    this.core.plugins.start(plugins, (plugin) => pluginHost(this.core, plugin.id, lent));
  }

  /** The plugins switched on: Focus's way to their states, routes and hooks. */
  get plugins(): Plugins {
    return this.core.plugins;
  }

  report(): ReportCard {
    return this.core.ledger.report();
  }

  claimed(repo: string): Set<number> {
    return this.core.seating.claimed(repo);
  }

  freeSlots(projectId: string): number {
    return this.core.seating.freeSlots(projectId);
  }
}
