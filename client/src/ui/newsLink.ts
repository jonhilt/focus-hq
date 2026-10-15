import { state } from '../net/state';
import type { Ui } from './context';
import type { ToastAction } from './hud';

/** Where a piece of news points, for its toast's button. */
export type NewsLink =
  /** The agent: teleport to their seat (`talk`: open their panel). */
  | { kind: 'agent'; id: string; talk?: boolean }
  /** The project's preview: its log. */
  | { kind: 'preview'; projectId: string }
  | { kind: 'url'; url: string; label: string };

/** What a piece of news's button does. */
export function linkAction(ui: Ui, link: NewsLink): ToastAction | undefined {
  switch (link.kind) {
    case 'agent':
      // gone home since: nowhere to go
      if (!state.agents.has(link.id)) return undefined;
      return link.talk ? { label: 'Talk', run: () => ui.openAgent(link.id) } : { label: 'Go there', run: () => ui.goToAgent(link.id) };
    case 'preview':
      return { label: 'Log', run: () => ui.openPreview(link.projectId) };
    case 'url':
      return { label: link.label, run: () => window.open(link.url, '_blank', 'noopener') };
  }
}
