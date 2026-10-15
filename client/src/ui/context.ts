import type { Trace, TraceSubject } from '../../../shared/ledgerReview';
import type { AgentView } from './agentPanel';
import type { Place } from '../world/office';
import type { Hud } from './hud';
import type { TrainingStep } from '../../../shared/trainingSteps';
import type { Panels } from './panels';

export type ManagerTab = 'projects' | 'new-project' | 'issue' | 'settings';
export type BoardTab = 'todo' | 'doing' | 'prs';

/** What panels can ask of the app. */
export interface Ui {
  panels: Panels;
  hud: Hud;
  error: (message: string) => void;
  places(): Place[];
  goTo(place: Place): void;
  goToAgent(id: string): void;
  /** An agent's panel, on one of its views if given (a lead's goal, say). */
  openAgent(id: string, view?: AgentView): void;
  /** One of a lead's helpers: its own transcript. */
  openHelper(leadId: string, id: string): void;
  /** One of lead `leadId`'s workflow agents (by its place in workflow `workflowId`): its own screen. */
  openWorkflowAgent(leadId: string, workflowId: string, index: number): void;
  /** The script behind one of a lead's workflows, from its transporter room's console. */
  openWorkflowScript(leadId: string, workflowId: string): void;
  /** One of lead `leadId`'s background commands or monitors: its output, and a way to stop it. */
  openBackground(leadId: string, taskId: string): void;
  openBoard(projectId: string, tab?: BoardTab): void;
  /** Starts a preview of the PR unless it's already the one running, then shows its panel. */
  previewPr(projectId: string, repo: string, number: number): void;
  openPreview(projectId: string): void;
  openNewIssue(projectId?: string): void;
  /** The room's QA station: the QA officer, their reports and the project's QA brief. */
  openQa(projectId: string): void;
  /** The room's goals: each one's lead, and a box to start another. */
  /** `station`: the free team station the captain walked up to, where a goal they start goes. */
  openGoals(projectId: string, station?: number): void;
  /** Comms: whatever waits on the captain across the ship, and every goal under way. */
  openComms(): void;
  /** The studio holodeck's chat with its computer, docked so the room stays in view. */
  openStudio(): void;
  /** The system model standing in the studio, up close (modelPanel.ts). */
  openModel(): void;
  /** The engineering station: the chief engineer's panel, with the ledger's report card and the plugins' parts. */
  openEngineering(): void;
  /** Main engineering's master systems table: the ledger's log, and a trace of a pull request or goal. */
  /** The ledger review, tracing `subject` when given (a friction from the engineering panel, say). */
  openLedger(subject?: TraceSubject): void;
  /** Puts a trace, a plugin's board (the scorecard's) or your plan's usage up on main engineering's MSD, or with null, the ledger's report card back. */
  showOnMsd(what: Trace | { plugin: string } | 'usage' | null): void;
  openManager(tab?: ManagerTab): void;
  openTeleport(): void;
  /** A team station's screen up close: what lead `leadId` has shown, and switches for what station screens show. */
  openScreen(leadId?: string): void;
  /** The star chart of lead `leadId`'s goal (stellar cartography). */
  openChart(leadId: string): void;
  /** The demo ship's training console: pick a scenario to reset the ship for. */
  openTraining(): void;
  /** After the training console's reset: beams the captain to `projectId`'s team station 1, with `steps` for ] and [ to run, at the demo's pace `speed`. */
  train(projectId: string, steps: TrainingStep[], speed: number): void;
  /** The turbolift's controls, for whichever stop you're at. */
  openTurbolift(): void;
  /** Takes the turbolift to `stop`. */
  ride(stop: Place): void;
  /** Beams the captain into transporter room `room` of `projectId`'s team station `station`, to watch its workflow. */
  beamTo(projectId: string, station: number, room: number): void;
  /** Beams the captain back to the briefing room of `projectId`'s team station `station`. */
  beamBack(projectId: string, station: number): void;
}
