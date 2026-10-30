// The plugin API's part for every browser page, the 3D ship's and the phone's (docs/plugins.md): a read-only view of
// Focus's state, and the plugin's own routes. Nothing of three.js or the 3D world, so a plugin's `phone.ts` can use it
// and the Tricorder stays small. The browser's own state and REST client stay the core's: a plugin reads what `focus`
// shows and calls only its own routes.
import type { ReportCard } from '../shared/ledger';
import type { Agent, IssueDraft, Preview, Project, QaReview, TermLine } from '../shared/types';
import { mergeMethodFor } from '../shared/mergeGateRules';
import { api } from '../client/src/net/api';
import { markRead as markTurnRead, shownPrs } from '../client/src/net/attention';
import { state } from '../client/src/net/state';

/** Focus as the browser has it now, read-only: what a plugin's views may show. */
export const focus = {
  get projects(): readonly Project[] {
    return state.projects;
  },
  /** The projects the captain hasn't hidden: what shows aboard. */
  get shown(): readonly Project[] {
    return state.shown;
  },
  /** Whether the captain has hidden project `projectId` (nothing outside the ready room names it). */
  isHidden: (projectId: string): boolean => state.isHidden(projectId),
  /** An agent by id, as the browser has them now. */
  agent: (id: string): Readonly<Agent> | undefined => state.agents.get(id),
  /** Every agent aboard, of every project, as the browser has them now. */
  get agents(): readonly Readonly<Agent>[] {
    return [...state.agents.values()];
  },
  /** Every agent of the shown projects. */
  shownAgents: (): Agent[] => state.shownAgents(),
  /** A project's goals: each one's lead, in `goalOrder` (shared/board.ts). */
  leadsIn: (projectId: string): Agent[] => state.leadsIn(projectId),
  /** The pull requests the shown projects' boards show, each with its project. */
  shownPrs,
  /** QA's reviews, by pull request (`prKey`). */
  get reviews(): ReadonlyMap<string, QaReview> {
    return state.reviews;
  },
  /** An agent's terminal lines, as far as the browser has them. */
  lines: (agentId: string): readonly TermLine[] => state.lines.get(agentId) ?? [],
  /** The pull request running on this machine for project `projectId` (one at a time), when one is: its links are where it's up. */
  preview: (projectId: string): Readonly<Preview> | undefined => state.previews.get(projectId),
  /** The demo ship: fake GitHub and scripted agents. */
  get demo(): boolean {
    return state.info?.mode === 'demo';
  },
  project: (id: string): Readonly<Project> | undefined => state.project(id),
  /** The issue draft waiting, or being written, at project `projectId`'s Ops station. */
  draft: (projectId: string): Readonly<IssueDraft> | undefined => state.drafts.get(projectId),
  /** Calls `fn` whenever the projects change; returns what stops it. */
  onProjects: (fn: () => void): (() => void) => state.on('projects', fn),
  /** Calls `fn` with each agent as it changes; returns what stops it. */
  onAgent: (fn: (agent: Readonly<Agent>) => void): (() => void) => state.on('agent', fn),
  /** Calls `fn` whenever the ship changes: an agent comes, goes or changes, a board, a QA review, the projects or the ledger's report. */
  onShip: (fn: () => void): (() => void) => {
    const stops = (['agent', 'agent-removed', 'board', 'review', 'projects', 'report'] as const).map((event) => state.on(event, fn));
    return () => stops.forEach((stop) => stop());
  },
  /** Calls `fn` with each agent's new terminal lines as they come; returns what stops it. */
  onLines: (fn: (agentId: string, lines: readonly TermLine[]) => void): (() => void) => state.on('lines', ({ id, lines }) => fn(id, lines)),
  /** Asks project `projectId`'s Ops officer to write `idea` up as an issue (it waits at their station). */
  draftIssue: (projectId: string, idea: string): Promise<unknown> => api.draftIssue(projectId, idea),
  /** How a repo's pull requests merge in a project (squash, merge or rebase): its own choice, or Focus's. */
  mergeMethod: (projectId: string, repo: string): string => mergeMethodFor(state.project(projectId), repo, state.info?.settings.mergeMethod ?? 'squash'),
  /** The ledger's report card as Focus last sent it: none until it has. */
  get report(): Readonly<ReportCard> | null {
    return state.report;
  },
  /** The captain is reading a lead's latest turn here (its panel's open, say): it stops hailing them until their next. */
  markRead: (agent: Agent): void => markTurnRead(agent),
};

/**
 * The plugin `id`'s state as Focus sent it, on any page, the phone's too: unread, for the plugin to read as its own
 * (on the 3D ship, `pluginState` takes the plugin's word for its shape).
 */
export const pluginStateNow = (id: string): unknown => state.plugins[id];

/** Calls `fn` whenever plugin `id`'s state changes in the browser; returns what stops it. */
export const onPluginState = (id: string, fn: () => void): (() => void) => state.on('plugin', (changed) => changed === id && fn());

/** Calls one of plugin `id`'s own routes (`/api/plugins/<id><path>`), POSTing `body`; rejects with Focus's word on why. */
export const callPlugin = <T>(id: string, path: string, body?: unknown): Promise<T> => api.plugin<T>(id, path, body);

/** Reads one of plugin `id`'s own routes (a GET of `/api/plugins/<id><path>`); rejects with Focus's word on why. */
export const readPlugin = <T>(id: string, path: string): Promise<T> => api.pluginGet<T>(id, path);
