import type { Layer } from 'effect';
import type { Closer, LedgerEntry, ReportCard } from '../../shared/ledger';
import type { Agent, Autonomy, ConflictsOutcome, Effort, FailedCheck, MessageReply, PullRequest, QaReview, QueuedGoal, ResumeHow, TermLine, WorkflowScript } from '../../shared/types';
import type { Hub } from '../hub';
import type { FocusPlugin } from '../plugins/contract';
import type { Plugins } from '../plugins/registry';
import type { Store } from '../store';
import type { Transcript } from './engineer';
import { CloudMoves } from './manager/cloudMoves';
import { Comms } from './manager/comms';
import { Conflicts } from './manager/conflicts';
import { Delivery } from './manager/delivery';
import { GoalTools } from './manager/goalTools';
import { Leads } from './manager/leads';
import { Ledger } from './manager/ledger';
import { PlanLimit } from './manager/planLimit';
import { type Lent, pluginHost } from './manager/pluginHost';
import { Reviews } from './manager/reviews';
import { Seating } from './manager/seating';
import { AgentSessions, backgroundOutputLines, workflowAgentLines, workflowScript } from './manager/sessions';
import { Slices } from './manager/slices';
import { Triages } from './manager/triages';
import { Core, type ManagerServices } from './manager/core';

/**
 * Hires agents, seats them at desks, runs them, and turns their work into pull requests: the office's one way in to its
 * agents, for the routes and the office's loops.
 *
 * Each concern is a part of its own in `manager/` (seating, sessions, delivery, conflicts, leads, slices, goal tools,
 * comms, reviews, triages, cloud moves, the ledger, the plan's usage limit), sharing the `Core` (`manager/core.ts`): the store and hub, the one
 * runtime, and each agent's fiber (`runs`), so they never run twice at once and sending them home interrupts it (and
 * with it their Claude Code session). The public methods below each hand over to their part.
 */
export class AgentManager {
  private readonly core: Core;

  constructor(store: Store, hub: Hub, services: Layer.Layer<ManagerServices>, boardChanged: (projectId: string) => void) {
    this.core = new Core(store, hub, services, boardChanged);
    this.core.cloud = new CloudMoves(this.core);
    this.core.comms = new Comms(this.core);
    this.core.conflicts = new Conflicts(this.core);
    this.core.delivery = new Delivery(this.core);
    this.core.goalTools = new GoalTools(this.core);
    this.core.leads = new Leads(this.core);
    this.core.ledger = new Ledger(this.core);
    this.core.planLimit = new PlanLimit(this.core);
    this.core.reviews = new Reviews(this.core);
    this.core.seating = new Seating(this.core);
    this.core.sessions = new AgentSessions(this.core);
    this.core.slices = new Slices(this.core);
    this.core.triages = new Triages(this.core);
  }

  /** Reads an agent session's Claude Code transcript by its id (missing in the demo, which has none). */
  get readTranscript(): Ledger['readTranscript'] {
    return this.core.ledger.readTranscript;
  }

  set readTranscript(read: Ledger['readTranscript']) {
    this.core.ledger.readTranscript = read;
  }

  /** Reads a lead's transcript for its goal's flow, when that isn't `readTranscript` (the demo's stand-in). */
  set flowTranscript(read: Ledger['flowTranscript']) {
    this.core.ledger.flowTranscript = read;
  }


  /** The agents' transcripts on this machine, for digesting the ones from before digests began. */
  get transcripts(): Ledger['transcripts'] {
    return this.core.ledger.transcripts;
  }

  set transcripts(transcripts: Ledger['transcripts']) {
    this.core.ledger.transcripts = transcripts;
  }

  hire(projectId: string, repo: string, issue: { number: number; title?: string; url?: string }, how: { effort?: Effort; cloud?: boolean } = {}): Agent {
    return this.core.seating.hire(projectId, repo, issue, how);
  }

  resolveConflicts(projectId: string, pr: PullRequest): Promise<ConflictsOutcome> {
    return this.core.conflicts.resolveConflicts(projectId, pr);
  }

  openedByOffice(repo: string, number: number): boolean {
    return this.core.seating.openedByOffice(repo, number);
  }

  busyOn(repo: string, number: number): boolean {
    return this.core.seating.busyOn(repo, number);
  }

  schedule(): void {
    this.core.seating.schedule();
  }

  compactNow(id: string): Promise<Agent> {
    return this.core.sessions.compactNow(id);
  }

  startGoal(projectId: string, text: string, how: { station?: number; effort?: Effort; from?: string } = {}): { agent: Agent } | { queued: QueuedGoal } {
    return this.core.leads.startGoal(projectId, text, how);
  }

  reopenGoal(projectId: string, goalId: string, station?: number): Agent {
    return this.core.leads.reopenGoal(projectId, goalId, station);
  }

  /** Puts a goal in line at the project's team stations without starting it, even with a station free: the captain starts it. */
  queueGoal(projectId: string, text: string, how: { effort?: Effort; from?: string } = {}): QueuedGoal {
    return this.core.leads.queueGoal(projectId, text, how);
  }

  startQueued(projectId: string, queueId: string, edits: { text?: string; effort?: Effort; station?: number } = {}): Agent {
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
  workflowAgentLines(id: string, workflowId: string, agentId: string): Omit<TermLine, 't'>[] {
    return workflowAgentLines(this.core.runtimes.get(id), workflowId, agentId);
  }

  /** The end of one of a lead's background commands' output, from the file it writes to. */
  backgroundOutput(id: string, taskId: string): Omit<TermLine, 't'>[] {
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

  leadPrs(projectId: string): { repo: string; number: number }[] {
    return this.core.leads.leadPrs(projectId);
  }

  requestReview(projectId: string, repo: string, number: number, title: string, retryNote?: string, asked = false): QaReview {
    return this.core.reviews.requestReview(projectId, repo, number, title, retryNote, asked);
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

  moveToCloud(id: string): Promise<Agent> {
    return this.core.cloud.moveToCloud(id);
  }

  openCloudTerminal(id: string): Promise<Agent> {
    return this.core.cloud.openCloudTerminal(id);
  }

  attachCloud(id: string, link: string): Promise<Agent> {
    return this.core.cloud.attachCloud(id, link);
  }

  stayLocal(id: string, start = true): Promise<Agent> {
    return this.core.cloud.stayLocal(id, start);
  }

  /** The captain ticks off (or un-ticks) a spot-check on a slice of a goal under way. */
  tickSpotCheck(id: string, slice: number, index: number, checked: boolean): void {
    this.core.leads.tickSpotCheck(id, slice, index, checked);
  }

  readTurn(id: string): void {
    this.core.comms.readTurn(id);
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

  record(projectId: string, entry: LedgerEntry, at = Date.now()): void {
    this.core.ledger.record(projectId, entry, at);
  }

  /** Starts the plugins switched on (docs/plugins.md), lending each the manager's seating and terminals, and what the office lends. */
  startPlugins(plugins: FocusPlugin[], lent: Lent): void {
    this.core.plugins.start(plugins, (plugin) => pluginHost(this.core, plugin.id, lent));
  }

  /** The plugins switched on: the office's way to their states, routes and hooks. */
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
