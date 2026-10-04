import type { Place } from '../world/office';
import type { Hud } from './hud';
import type { Panels } from './panels';

export type ManagerTab = 'projects' | 'new-project' | 'issue' | 'settings';
export type BoardTab = 'todo' | 'doing' | 'prs';

/** What panels can ask of the app. */
export interface Ui {
  panels: Panels;
  hud: Hud;
  error(message: string): void;
  places(): Place[];
  goTo(place: Place): void;
  goToAgent(id: string): void;
  openAgent(id: string): void;
  openBoard(projectId: string, tab?: BoardTab): void;
  /** Starts a preview of the PR unless it's already the one running, then shows its panel. */
  previewPr(projectId: string, repo: string, number: number): void;
  openPreview(projectId: string): void;
  openNewIssue(projectId?: string): void;
  /** The observation lounge's briefing, or a form to call one (for `projectId`, if given). */
  openBriefing(projectId?: string): void;
  /** Beams you to the observation lounge and opens the briefing. */
  goToLounge(): void;
  openManager(tab?: ManagerTab): void;
  openTeleport(): void;
}
