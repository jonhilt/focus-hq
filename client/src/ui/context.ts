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
  openAgent(id: string): void;
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
  /** The ready room's chat with Number One. */
  openNumberOne(): void;
  openManager(tab?: ManagerTab): void;
  openTeleport(): void;
}
