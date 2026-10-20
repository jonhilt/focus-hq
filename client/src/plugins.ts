/// <reference types="vite/client" />
// The plugins' parts in the browser (docs/plugins.md): each plugin folder's client.ts, found as the client's built.
// Only the plugins the office has switched on (`info.plugins`) show.
import type * as THREE from 'three';
import { pluginOn } from '../../shared/projectPlugins';
import type { Agent, AgentStatus, GoalArtifact } from '../../shared/types';
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
   * A stat it adds to the HUD's top row, beside the office's own counts, wherever the captain is on the ship; or null
   * for none just now. Asked again as the plugin's state changes.
   */
  hud?: () => HudStat | null;
  /**
   * Screens it hangs round the wall of a project's holodeck, each a hologram you walk up to (`world/hallScreens.ts`).
   * Asked again whenever the plugin's state changes; a hall has room for `HALL_SCREENS` in all, given out in the order
   * the plugins switched on list them.
   */
  hall?: (projectId: string) => HallScreen[];
  /** What it says about a goal under way, on the goal's own surfaces. */
  goal?: GoalPart;
  /**
   * It works per project: a switch for it in each project's settings (the manager's Projects tab), off until it's
   * switched on there (`Project.plugins`). Its holodeck screens and its lead tools come only to projects it's on for.
   */
  project?: { label: string; about: string };
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
  /**
   * Its part around a page a goal's lead put on their station's screen, while it's open up close (the briefings
   * plugin's narrator and ask bar round an explainer), or nothing to add to that page.
   */
  screen?(view: ScreenView): ScreenPart | undefined;
}

/** A page a goal's lead put on their station's screen, open up close, as a plugin's `screen` sees it. */
export interface ScreenView {
  ui: Ui;
  leadId: string;
  artifact: GoalArtifact;
  /** The live page's frame (its own origin: what its scripts post to the screen comes to `heard`). */
  frame: HTMLIFrameElement;
  /** The goal's still open; otherwise it's a closed goal's page, to look back at. */
  live: boolean;
  /**
   * The plugin's own part for the version of this page it replaces (the lead showed it again under its id), to carry
   * over what should outlast it: the screen doesn't end it, so the plugin ends what it doesn't keep.
   */
  before?: ScreenPart;
}

/** What a plugin adds round a page up close; the screen ends it as the page leaves it, or the panel closes. */
export interface ScreenPart {
  /** Shown in the page's head, beside its title. */
  head?: HTMLElement;
  /** Shown under the page. */
  foot?: HTMLElement;
  /** A message posted to the window while it's open (any page's: check it's from `frame`). */
  heard?(e: MessageEvent): void;
  end(): void;
}

/**
 * Each plugin's part round a page up close, by plugin, given its parts for the version it replaces (`before`, none for
 * a page newly opened). A plugin whose `screen` throws is logged and left out.
 */
export function screenParts(view: Omit<ScreenView, 'before'>, before?: ReadonlyMap<string, ScreenPart>): Map<string, ScreenPart> {
  const parts = new Map<string, ScreenPart>();
  for (const plugin of clientPlugins()) {
    try {
      const part = plugin.screen?.({ ...view, before: before?.get(plugin.id) });
      if (part) parts.set(plugin.id, part);
    } catch (err) {
      console.error(`The ${plugin.id} plugin's part of the screen failed`, err);
    }
  }
  return parts;
}

/** A plugin's stat on the HUD: its text, and a tone when it needs the captain's eye (`warn` gold, `bad` red). */
export interface HudStat {
  text: string;
  tone?: 'warn' | 'bad';
  /** What it is, on hover. */
  title?: string;
}

/** The stats the plugins switched on add to the HUD, in the order they're switched on. A plugin whose `hud` throws is left out. */
export function hudStats(): HudStat[] {
  return clientPlugins().flatMap((plugin) => {
    try {
      return plugin.hud?.() ?? [];
    } catch (err) {
      console.error(`The ${plugin.id} plugin's HUD stat failed`, err);
      return [];
    }
  });
}

/** A plugin's parts that run once it has started. */
export interface ClientParts {
  /**
   * A key pressed while the captain walks the ship (not typing, nor in a panel that hides the view), before the core's
   * own keys: true when the plugin used it. Use only keys of its own (its legend's), and check `ui.panels.isOpen`.
   */
  keydown?(e: KeyboardEvent): boolean;
  /**
   * The captain answered a goal's lead from Comms (approved or declined a tool, picked an option, replied, closed the
   * goal), as it stood when they did: after they've decided, never before.
   */
  answered?(lead: Agent): void;
}

/** The parts of each plugin switched on, as its `start` returned them, by id. */
export const startedParts = new Map<string, ClientParts>();

/** Tells every plugin started that the captain answered `lead` from Comms. One that throws is logged and skipped. */
export function answeredLead(lead: Agent): void {
  for (const [id, parts] of startedParts) {
    try {
      parts.answered?.(lead);
    } catch (err) {
      console.error(`The ${id} plugin's word on an answer failed`, err);
    }
  }
}

/** What the World lends a plugin as it builds the ship. */
export interface ShipHost {
  /** Where a seat marker baked into a deck stands (`blender/kit.py`), or undefined when the deck has none of that name. */
  seat(deck: 'command' | 'engineering', name: Crew): Seat | undefined;
  /** Puts `object`, in world coordinates, on the deck: drawn and culled with it, and taken off before the ship is built again. */
  mount(deck: 'command' | 'engineering', object: THREE.Object3D): void;
  /** A box on the floor the player can't walk into, in world coordinates. */
  collide(box: Box2): void;
  /**
   * Makes `object` something the captain uses with E: `label` is the hint, `use` what it does, from as far as `reach`
   * metres (4.5 unless it says).
   */
  interactive(object: THREE.Object3D, label: () => string, use: (ui: Ui) => void, reach?: number): void;
  /** The training hall of `projectId`'s holodeck, to stand things in; undefined when it has none (it's hidden). */
  hall(projectId: string): HallHost | undefined;
  /**
   * A space of the plugin's own, far out beyond the rest of the ship and drawn only while the camera's in it, like a
   * transporter room: nothing leads there, so the captain's sent there (`ui.dive`, `ui.goTo`) and back. Its floor is
   * at y 0 round its middle, and it should stay within `SPACE.radius` of that; it starts empty, under the ship's sky
   * and lights, so it brings its own sky. `label` names where you are while you're in it (the HUD's place). Each call
   * gives another.
   */
  space(label: () => string): PluginSpace;
}

/** A project's training hall, lent to a plugin as the ship's built. */
export interface HallHost {
  /**
   * Stands `object` in the hall, placed in the hall's own frame (`world/hallLayout.ts`: +X from the entrance to the
   * board, the middle of its floor at the origin): drawn and culled with it, and taken off before the ship is built again.
   */
  mount(object: THREE.Object3D): void;
  /** A point in the hall's frame, in world coordinates (for `collide`, and for sending the captain there). */
  toWorld(local: THREE.Vector3): THREE.Vector3;
}

/** A plugin's own space (`ShipHost.space`). */
export interface PluginSpace {
  /** Its group, at its middle: what the plugin adds to it is placed round that. */
  root: THREE.Group;
  /** A point round its middle, in world coordinates. */
  toWorld(local: THREE.Vector3): THREE.Vector3;
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

/** The screens the plugins switched on for `projectId` hang in its holodeck, each with its plugin's id. */
export function hallScreens(projectId: string): { plugin: string; screen: HallScreen }[] {
  const project = state.project(projectId);
  return clientPlugins()
    .filter((p) => pluginOn(project, p.id))
    .flatMap((p) => (p.hall?.(projectId) ?? []).map((screen) => ({ plugin: p.id, screen })));
}

/** The plugins switched on in the office that work per project, for a project's settings to switch on and off. */
export const projectPlugins = (): (ClientPlugin & Required<Pick<ClientPlugin, 'project'>>)[] =>
  clientPlugins().filter((p): p is ClientPlugin & Required<Pick<ClientPlugin, 'project'>> => !!p.project);

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
  /** A block across the top of the overview, above its main block and in the order the plugins are switched on, or null for none. */
  top?: (ui: Ui) => HTMLElement | null;
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
