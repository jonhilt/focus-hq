// What the cartography plugin's views show and say (README.md), decided apart from drawing them: each project's map
// card on the engineering station (client.ts), and what the architecture space puts up and in what
// order (space.ts). Those draw what these decide.
import { type Marks, TIES_KEY, tiesDrawing } from './draw';
import { type CartographyState, type MapView, MODEL_FILE, type RepoMap } from './shared';
import { sliceViews } from './slice';
import { MAX_PANELS } from './spaceLayout';
import { CHANGES, screenVersion, spaceViews, WHOLE } from './views';

/** What ties a project's repos together, drawn (draw.ts). */
export type TiesDrawing = NonNullable<ReturnType<typeof tiesDrawing>>;
/** A goal's slice of one repo, as a view (slice.ts). */
export type SliceView = ReturnType<typeof sliceViews>[number];

/** A project's map card: its button, its repos' maps, what ties its repos, and what each goal under way does to them. */
export interface ProjectCard {
  remap: 'Mapping…' | 'Map again';
  /** Its repos' maps, or none while it hasn't been mapped. */
  repos: RepoMap[] | undefined;
  /** Nothing to say of ties (one repo, or not mapped yet), none found, or what ties them. */
  ties: { kind: 'none' } | { kind: 'unfound' } | { kind: 'drawn'; drawing: TiesDrawing };
  slices: SliceView[];
}

export const NOT_MAPPED = `Not mapped yet. Each repo keeps its model in ${MODEL_FILE}.`;
export const NO_TIES = `Nothing ties its repos together yet: neither calls a route the other declares, nor do they change together often enough to say. ${TIES_KEY}`;
export const SLICES_HEAD = 'Goals under way, and what each slice does to the architecture so far:';

/** What `project`'s map card shows, from the plugin's `state`. */
export function projectCard(project: { id: string; repos: readonly string[] }, state: CartographyState | undefined): ProjectCard {
  const repos = state?.maps[project.id];
  const drawing = repos && project.repos.length > 1 ? tiesDrawing(repos, state?.crossRepo[project.id] ?? [], state?.crossCalls[project.id] ?? []) : undefined;
  const ties: ProjectCard['ties'] = drawing ? { kind: 'drawn', drawing } : repos && project.repos.length > 1 ? { kind: 'unfound' } : { kind: 'none' };
  return {
    remap: state?.mapping.includes(project.id) ? 'Mapping…' : 'Map again',
    repos,
    ties,
    slices: sliceViews(state?.slices[project.id] ?? [], repos ?? []),
  };
}

/** The line under the cards for the `off` projects it's switched off for, or none. */
export const offNote = (off: number): string | undefined =>
  off ? `Switched off for ${off} project${off === 1 ? '' : 's'}: switch Architecture map on in a project's settings (the manager's Projects tab) to map it.` : undefined;

/** Something the architecture space puts up: a key that changes when its drawing would, its hint's name, and what it's of. */
export type Shown = { key: string; title: string } & (
  | { kind: 'view'; map: RepoMap; view: MapView }
  | { kind: 'slice'; caption: string; map: RepoMap; view: MapView; marks: Marks }
  | { kind: 'ties'; ties: TiesDrawing }
);

/** A hint's name for a view. */
const titleOf = (map: RepoMap, view: MapView): string =>
  view.id === WHOLE.id ? `${map.repo}'s whole map` : view.id === CHANGES.id ? `how ${map.repo} changes` : `the map: ${view.question}`;

/** A slice's view as the space puts it up. */
const sliceShown = ({ slice, map, view, marks, key }: SliceView): Shown => ({
  kind: 'slice', key, title: `what ${slice.title} changes`, map, view, marks,
  caption: `${slice.title}${slice.station === undefined ? '' : ` · TS-${slice.station + 1}`} · ${map.repo}, its lead's checkout against the default branch`,
});

/**
 * What the space puts up for project `projectId` from its `repos`' maps, in the order of its spots and no more than
 * fit: each repo's whole map, then what ties its repos together
 * (crossRepo.ts), then what each goal under way does to them, then the repos' own views and how each changes.
 */
export function spaceShows(repos: readonly RepoMap[], state: CartographyState | undefined, projectId: string): Shown[] {
  const shown = spaceViews(repos);
  const wholes = shown.filter(({ view }) => view.id === WHOLE.id).length;
  const views = shown.map(({ map, view }): Shown => ({ kind: 'view', key: `${map.repo}#${screenVersion(map, view)}`, title: titleOf(map, view), map, view }));
  const tied = state?.crossRepo[projectId] ?? [];
  const called = state?.crossCalls[projectId] ?? [];
  const ties = tiesDrawing(repos, tied, called);
  const repoTies: Shown[] = ties ? [{ kind: 'ties', key: `ties|${JSON.stringify([tied, called])}`, title: 'how its repos connect', ties }] : [];
  const slices = sliceViews(state?.slices[projectId] ?? [], repos).map(sliceShown);
  return [...views.slice(0, wholes), ...repoTies, ...slices, ...views.slice(wholes)].slice(0, MAX_PANELS);
}

/**
 * How the space stands for project `projectId` called `name`: what it puts up, a key that changes when any of it
 * would be drawn again, and, when there's nothing to put up, the note it shows instead.
 */
export function spaceStands(state: CartographyState | undefined, projectId: string, name: string): { shows: Shown[]; key: string; note?: { title: string; why: string } } {
  const repos = state?.maps[projectId];
  const shows = spaceShows(repos ?? [], state, projectId);
  const key = repos ? shows.map((s) => s.key).join('\n') : 'unmapped';
  if (shows.length) return { shows, key };
  const why = repos ? 'None of its repos has a model yet: each keeps one in .focus/cartography.yaml.' : 'It hasn’t been mapped yet: it will be in a moment.';
  return { shows, key, note: { title: `${name} has no map yet`, why } };
}
