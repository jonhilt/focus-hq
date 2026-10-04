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
  openNewIssue(projectId?: string): void;
  openManager(tab?: ManagerTab): void;
  openTeleport(): void;
}
