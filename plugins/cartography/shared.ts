// What both halves of the cartography plugin (README.md) share: a project's architecture model, kept in each repo
// it maps, and the map the office makes of it from the code.
import type { ModelKind } from '../../shared/types';

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

/** A question the model answers, drawn with only the parts it names. */
export interface MapView {
  id: string;
  question: string;
  parts: string[];
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
  /** Where the model and the code disagree, in words. */
  problems: string[];
  /** Why there's no map: no model file, or one that doesn't read. */
  error?: string;
}

export interface CartographyState {
  /** Each project's maps, one per repo, by project id. */
  maps: Record<string, RepoMap[]>;
  /** Projects whose maps are being made again. */
  mapping: string[];
}
