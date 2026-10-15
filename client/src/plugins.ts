/// <reference types="vite/client" />
// The plugins' parts in the browser (docs/plugins.md): each plugin folder's client.ts, found as the client's built.
// Only the plugins the office has switched on (`info.plugins`) show.
import { state } from './net/state';
import type { Ui } from './ui/context';
import type { Box } from './world/msd';

export interface ClientPlugin {
  /** The plugin's id, as the server knows it. */
  id: string;
  /** What it adds to the engineering station on deck 5. */
  engineering?: EngineeringPart;
  /** What it draws on main engineering's MSD beside the ship, while it's put up there (`ui.showOnMsd({ plugin })`). */
  msd?: (ctx: CanvasRenderingContext2D, box: Box) => void;
  /**
   * Screens it hangs round the wall of a project's holodeck, each a hologram you walk up to (`world/hallScreens.ts`).
   * Asked again whenever the plugin's state changes; a hall has room for `HALL_SCREENS` in all, given out in the order
   * the plugins switched on list them.
   */
  hall?: (projectId: string) => HallScreen[];
}

/** One of a plugin's screens in a project's holodeck. */
export interface HallScreen {
  /** Which of the plugin's screens it is, the same from one asking to the next. */
  key: string;
  /** What it shows, in a few words: the hint as you aim at it reads `Look at <title>`. */
  title: string;
  /** Changes whenever what it draws would: the screen is drawn again only then. */
  version: string;
  /** Draws it on a `w` × `h` canvas (1280 × 800), cleared first; the screen shows it once it's done. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void | Promise<void>;
  /** E on the screen: what it shows, up close. */
  closeUp?(ui: Ui): void;
}

/** The screens the plugins switched on hang in `projectId`'s holodeck, each with its plugin's id. */
export function hallScreens(projectId: string): { plugin: string; screen: HallScreen }[] {
  return clientPlugins().flatMap((p) => (p.hall?.(projectId) ?? []).map((screen) => ({ plugin: p.id, screen })));
}

/**
 * A plugin's part of the engineering station, drawn again whenever the plugin's state, or an agent on a brief, changes.
 * Every part is optional.
 */
export interface EngineeringPart {
  /** A card on the overview, beside the others (the climber's). */
  card?: (ui: Ui) => HTMLElement | null;
  /** The overview's main block, with every card laid out in it (the scorecard puts them beside what moved). The first plugin's wins. */
  overview?: (ui: Ui, cards: HTMLElement, go: EngineeringGo) => HTMLElement;
  /** What the overview's side-nav button reads (the scorecard's ▲14 ▼1). */
  readout?: () => string;
  /** Views of its own on the side nav, after the overview. */
  views?: EngineeringView[];
}

export interface EngineeringView {
  key: string;
  label: string;
  readout?: () => string;
  /** Dimmed on the side nav: nothing to show yet. */
  standby?: () => boolean;
  /** `open` is what the captain has opened in the station's views, kept across redraws. */
  render: (ui: Ui, go: EngineeringGo, open: Set<string>) => HTMLElement[];
}

/** Opens one of the station's views, scrolled to `at.key` (a `data-key`, opened too) or else to the element `#at.anchor`. */
export type EngineeringGo = (view: string, at?: { anchor?: string; key?: string }) => void;

const found = import.meta.glob<{ default: ClientPlugin }>('../../plugins/*/client.ts', { eager: true });

/** The plugins switched on that have a part in the browser. */
export function clientPlugins(): ClientPlugin[] {
  const on = new Set(state.info?.plugins ?? []);
  return Object.values(found).map((module) => module.default).filter((plugin) => on.has(plugin.id));
}

/**
 * The plugin `id`'s state as the office sent it, in the plugin's own type `S` (its server part's slot): the one place
 * the browser takes a plugin's word for the shape of its state.
 */
export const pluginState = <S>(id: string): S | undefined => state.plugins[id] as S | undefined;

/** The plugin `id`'s part in the browser, while it's switched on. */
export const clientPlugin = (id: string): ClientPlugin | undefined => clientPlugins().find((p) => p.id === id);
