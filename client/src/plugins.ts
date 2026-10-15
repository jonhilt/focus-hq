/// <reference types="vite/client" />
// The plugins' parts in the browser (docs/plugins.md): each plugin folder's client.ts, found as the client's built.
// Only the plugins the office has switched on (`info.plugins`) show.
import type * as THREE from 'three';
import type { Agent, AgentStatus } from '../../shared/types';
import { state } from './net/state';
import type { Ui } from './ui/context';
import type { Crew } from './world/deckExtras';
import type { Box2, Seat } from './world/layout';
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
  /** What it says about a goal under way, on the goal's own surfaces. */
  goal?: GoalPart;
  /** Keys it adds to the lists of controls, on the splash screen and the HUD: `{ key: 'G', label: 'the gallery' }`, say. */
  legend?: { key: string; label: string }[];
  /**
   * Called once, when the office first says the plugin is on (its first snapshot), with the app: what the plugin does
   * outside any panel (its toasts, say) starts here, never as its module loads, since every plugin's `client.ts` is
   * loaded whether it's on or not. Returns its parts that run from then on.
   */
  start?(host: { ui: Ui }): ClientParts | void;
  /**
   * Its part of the ship, built with the rest each time the World builds it (when projects come and go), and disposed
   * before the next: a figure in a seat, say. One that throws is logged and left out: what it mounted, walled off or
   * made usable before it threw is dropped with it, and the ship is built without it.
   */
  ship?(host: ShipHost): ShipPart | null;
}

/** A plugin's parts that run once it has started. */
export interface ClientParts {
  /**
   * A key pressed while the captain walks the ship (not typing, nor in a panel that hides the view), before the core's
   * own keys: true when the plugin used it. Use only keys of its own (its legend's), and check `ui.panels.isOpen`.
   */
  keydown?(e: KeyboardEvent): boolean;
}

/** What the World lends a plugin as it builds the ship. */
export interface ShipHost {
  /** Where a seat marker baked into a deck stands (`blender/kit.py`), or undefined when the deck has none of that name. */
  seat(deck: 'command' | 'engineering', name: Crew): Seat | undefined;
  /** Puts `object`, in world coordinates, on the deck: drawn and culled with it, and taken off before the ship is built again. */
  mount(deck: 'command' | 'engineering', object: THREE.Object3D): void;
  /** A box on the floor the player can't walk into. */
  collide(box: Box2): void;
  /** Makes `object` something the captain uses with E: `label` is the hint, `use` what it does. */
  interactive(object: THREE.Object3D, label: () => string, use: (ui: Ui) => void): void;
}

/** A plugin's part of the ship, while it stands. */
export interface ShipPart {
  /** Each frame, with the time (s) and where the camera is. */
  update?(t: number, camera: THREE.Vector3): void;
  /** The ship is being built again: let go of what it holds (its listeners, its GPU memory). */
  dispose(): void;
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
 * A plugin's word on a goal under way, which the core places on the goal's surfaces: its card in the goals list and
 * its lines in Comms, drawn again as the plugin's state changes, and the goal board in its briefing room. Every part is
 * optional.
 */
export interface GoalPart {
  /**
   * A word on the goal by its lead: a readout under `label` on its card in the goals list (`card`), or a tag on its
   * line in Comms (`line`); null for nothing. The core gives the element its look (`goal-readout`, `goal-tag`), in
   * the colour of its `--tone`. Comms keeps a line from render to render, so a line's element should keep itself up
   * to date.
   */
  tag?: (lead: Agent, where: GoalTagPlace) => { label: string; el: HTMLElement } | null;
  /** A strip along the bottom of the goal board, or null for none. */
  board?: (lead: Agent) => GoalStrip | null;
}

export type GoalTagPlace = 'card' | 'line';

/**
 * A strip along the bottom of a goal board: the board makes room for it and draws it again whenever its `key` changes,
 * and each minute while it's shown, so a time in it can count up.
 */
export interface GoalStrip {
  height: number;
  key: unknown;
  draw: (ctx: CanvasRenderingContext2D, box: Box) => void;
}

/**
 * A plugin's part of the engineering station, drawn again whenever the plugin's state, or an agent on a brief, changes.
 * Every part is optional.
 */
export interface EngineeringPart {
  /** A card on the overview, beside the others (the climber's); `go` opens one of the station's views from it. */
  card?: (ui: Ui, go: EngineeringGo) => HTMLElement | null;
  /** The overview's main block, with every card laid out in it (the scorecard puts them beside what moved). The first plugin's wins. */
  overview?: (ui: Ui, cards: HTMLElement, go: EngineeringGo) => HTMLElement;
  /** What the overview's side-nav button reads (the scorecard's ▲14 ▼1). */
  readout?: () => string;
  /** Views of its own on the side nav, after the overview. */
  views?: EngineeringView[];
  /**
   * What the chief engineer is busy with at the station in main engineering, when it's the plugin's work: their
   * status and a line, which their bubble says and the station's screen shows under the report card. Null when they
   * aren't; the first plugin with something to say is heard.
   */
  station?: () => StationSays | null;
}

/** What the engineer at the engineering station says they're doing. */
export interface StationSays {
  status: AgentStatus;
  line: string;
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

/** The plugins' words on a goal under way, by its lead, for one of its surfaces, each element given its look. */
export function goalTags(lead: Agent, where: GoalTagPlace): { label: string; el: HTMLElement }[] {
  return clientPlugins().flatMap((plugin) => {
    const tag = plugin.goal?.tag?.(lead, where);
    tag?.el.classList.add(where === 'card' ? 'goal-readout' : 'goal-tag');
    return tag ? [tag] : [];
  });
}

/** The plugins' strips along the bottom of a goal board, by its lead. */
export const goalStrips = (lead: Agent): GoalStrip[] => clientPlugins().flatMap((plugin) => plugin.goal?.board?.(lead) ?? []);

/** What the engineer at the engineering station says: the first plugin's with something to say, or null. */
export const stationSays = (): StationSays | null => clientPlugins().map((plugin) => plugin.engineering?.station?.() ?? null).find((says) => says !== null) ?? null;

/** The plugin `id`'s part in the browser, while it's switched on. */
export const clientPlugin = (id: string): ClientPlugin | undefined => clientPlugins().find((p) => p.id === id);
