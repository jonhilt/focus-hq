// What both halves of the cartography plugin (README.md) share: a project's architecture model, kept in each repo
// it maps, and the map the office makes of it from the code.
import type { ModelKind } from '../../plugin-api/shared';
import type { KeptDiagram } from './diagrams';
import type { MapHistory } from './history';

export const CARTOGRAPHY = 'cartography';

/** Where a repo keeps its model, from its root. */
export const MODEL_FILE = '.focus/cartography.yaml';

/** One part of the system: the code under its paths, a folder (ending in `/`) or a file, is its. */
export interface MapPart {
  id: string;
  label: string;
  /** Its layer or owner (Client, Server, Shared…): parts in a layer share a colour. */
  layer: string;
  kind: ModelKind;
  paths: string[];
  /** What it does, in a line. */
  does?: string;
}

/**
 * One step of a view's scenario: `from` does something that reaches `to`, said in a few words, and where in the code
 * it does it (`cite`, `path:line` from the repo's root), checked against the code as it stands (steps.ts).
 */
export interface ViewStep {
  from: string;
  to: string;
  says: string;
  cite?: string;
}

/**
 * The lines round a step's cite, as the map read them (map.ts), with the names its file's classes extend or implement
 * (whose members it reaches as `this.`); or why it couldn't: no such file, or no such line.
 */
export type CitedLines = { file: string; line: number; lines: string[]; first: number; inherits: string[] } | { missing: string };

/** Which recorded call chain a view's steps come from: the busiest that sent `message`, going `through` a part if it says. */
export interface ViewTrace {
  message: string;
  through?: string;
}

/**
 * A question the model answers, drawn with only the parts it names. One with `steps` is a scenario, drawn in order as a
 * sequence (steps.ts), with its answer in a line.
 */
export interface MapView {
  id: string;
  question: string;
  parts: string[];
  answer?: string;
  steps?: ViewStep[];
  /** Its steps found in a recorded run instead of written (steps.ts `tracedSteps`), when it has none written. */
  trace?: ViewTrace;
}

/** A repo's model as its file says it: which code belongs to which part, and its views. */
export interface ArchitectureModel {
  parts: MapPart[];
  views: MapView[];
  /** Paths the map leaves out (generated code, fixtures), like a part's. */
  ignore: string[];
}

/** One part importing another: how many imports go across, file to file, and what they bring. */
export interface MapConnection {
  from: string;
  to: string;
  imports: number;
  /** The names `from` takes from `to`, the most imported first (`default`, or `*` for a whole module). */
  names: string[];
}

/** One part sending another messages while it runs, in a recorded run (shared/flows.ts): events over /ws, or /api requests. */
export interface MapFlow {
  from: string;
  to: string;
  via: 'http' | 'ws';
  /** The kinds of message, the most sent first: events' types, or requests' method and route. */
  names: string[];
  /** How many went, in the recorded run. */
  count: number;
}

/**
 * A recorded call chain part to part (graph.ts `partTraces`): the parts it went through in order, each with the first
 * function it was called in there, ending at the part that received the message. How many times it went that way.
 */
export interface PartTrace {
  via: 'http' | 'ws';
  name: string;
  hops: { part: string; fn?: string }[];
  count: number;
}

/** One file importing another, and the names it takes. */
export interface FileEdge {
  from: string;
  to: string;
  names: readonly string[];
}

/** A repo's map, made from its default branch: its model, the connections the code makes, and what doesn't hold. */
export interface RepoMap {
  repo: string;
  /** The commit it was made from. */
  commit?: string;
  model?: ArchitectureModel;
  /** Source files the map looks at, and how many of them a part owns. */
  files: number;
  mapped: number;
  /** Each part's file count, by its id. */
  sizes: Record<string, number>;
  connections: MapConnection[];
  /** What parts send each other at runtime, from the repo's recorded run, if it has one. */
  flows?: MapFlow[];
  /** The lines round each of its scenarios' cites, by the cite (`path:line`). */
  cited?: Record<string, CitedLines>;
  /** The call chains that run sent its messages from, part to part, the busiest first. */
  traces?: PartTrace[];
  /** What that run was, and the commit it was recorded on. */
  flowsRun?: { run: string; commit?: string };
  /** How its parts have changed, from the default branch's git history (history.ts). */
  history?: MapHistory;
  /** Where the model and the code disagree, in words. */
  problems: string[];
  /** Why there's no map: no model file, or one that doesn't read. */
  error?: string;
}

/** What a slice changes in one repo. */
export interface SliceChange {
  repo: string;
  /** The parts its files fall in, the most lines first. */
  touched: { part: string; files: number; lines: number }[];
  /** Source files it changed that no part owns. */
  unowned: string[];
  /** Parts the branch's model has and the default branch's doesn't, and the other way. */
  added: string[];
  removed: string[];
  /** Imports between parts the branch makes and the default branch doesn't, and the other way. */
  gained: MapConnection[];
  lost: MapConnection[];
}

/** A part in one of a project's repos calling routes a part of another declares (routes.ts). */
export interface CrossCall {
  from: { repo: string; part: string };
  to: { repo: string; part: string };
  /** The routes, as the declaring repo has them. */
  routes: string[];
}

/** Two parts in different repos of a project that change together (crossRepo.ts). */
export interface CrossCoupling {
  a: { repo: string; part: string };
  b: { repo: string; part: string };
  /** Change sets that touched both, and that touched either. */
  together: number;
  either: number;
}

/** A goal under way, and what its slice does to the architecture so far, from its lead's checkout (slice.ts). */
export interface GoalSlice {
  leadId: string;
  /** The goal's title, and what its slice is heading for. */
  title: string;
  heading?: string;
  station: number;
  /** When it was worked out: as the lead's last turn ended. */
  at: number;
  /** Each repo the slice changes: what it changes, and the map of the lead's checkout (without its history and flows). */
  repos: { change: SliceChange; branch: RepoMap }[];
}

export interface CartographyState {
  /** Each project's maps, one per repo, by project id. */
  maps: Record<string, RepoMap[]>;
  /** Each project's goals under way, and what their slices change, by project id. */
  slices: Record<string, GoalSlice[]>;
  /** Each project of more than one repo, the parts in different repos that change together, by project id. */
  crossRepo: Record<string, CrossCoupling[]>;
  /** Each project of more than one repo, the parts of one that call routes another declares, by project id. */
  crossCalls: Record<string, CrossCall[]>;
  /** Projects whose maps are being made again. */
  mapping: string[];
  /** The diagrams leads drew of how each project's code works, kept with it (diagrams.ts), by project id. */
  diagrams: Record<string, KeptDiagram[]>;
}
