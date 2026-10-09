import type { Trace } from '../../../shared/ledgerReview';
import type { AgentView } from './agentPanel';
import type { Place } from '../world/office';
import type { Hud } from './hud';
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
  /** The ready room's chat with Number One. */
  openNumberOne(): void;
  /** The engineering station: the ledger's report card and the chief engineer's retro. */
  openEngineering(): void;
  /** Main engineering's master systems table: the ledger's log, and a trace of a pull request or goal. */
  openLedger(): void;
  /** Puts a trace up on main engineering's MSD, or with null, the ledger's report card back. */
  showOnMsd(trace: Trace | null): void;
  openManager(tab?: ManagerTab): void;
  openTeleport(): void;
  /** A team station's screen up close: what lead `leadId` has shown, and switches for what station screens show. */
  openScreen(leadId?: string): void;
  /** The turbolift's controls, for whichever stop you're at. */
  openTurbolift(): void;
  /** Takes the turbolift to `stop`. */
  ride(stop: Place): void;
}
