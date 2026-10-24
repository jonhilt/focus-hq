// What the REST API (routes.ts) makes of a request: the fields it reads from a body or query, and which files it
// serves and how. Pure, so each is tested next to it; the routes only do the I/O.
import { type Board, EFFORT_LEVELS, type Effort, type PreviewSet, type Project, type ResumeHow } from '../shared/types';

export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** A preview's per-repo choices: { "owner/name": 12 } for a PR, null for the default branch. Anything else is dropped. */
export const picks = (v: unknown): PreviewSet | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, number | null] => e[1] === null || Number.isInteger(e[1])));
};

/** The captain's change to a plugin's secret (PATCH /api/settings/plugin-secret): `value` a string to set it, null to clear it. */
export function pluginSecretChange(body: unknown): { plugin: string; name: string; value: string | null } {
  const b: Record<string, unknown> = body !== null && typeof body === 'object' ? { ...body } : {};
  if (b.value !== null && typeof b.value !== 'string') throw new Error('Send the secret as a string, or null to clear it');
  return { plugin: str(b.plugin), name: str(b.name), value: b.value };
}

/** The captain's say on picking a conversation back up on your API key: now, or once your plan's limit resets. */
export const resumeHow = (v: unknown): ResumeHow | undefined => (v === 'key' || v === 'wait' ? v : undefined);

/** Missing or empty = the model's default effort; anything else that isn't a level is refused. */
export const effort = (v: unknown): Effort | undefined => {
  if (v === undefined || v === '') return undefined;
  const level = EFFORT_LEVELS.find((e) => e === v);
  if (!level) throw new Error(`Effort must be one of ${EFFORT_LEVELS.join(', ')}`);
  return level;
};

/** What a demo push (`POST /demo-push/…?kind=`) does to the PR: `change` its own code, or (by default) merge its base in. */
export const pushKind = (v: unknown): 'merge-base' | 'change' => (v === 'change' ? 'change' : 'merge-base');

/** The open PR a demo push is for, and the project whose board it's on: none when no board shows `repo#number`. */
export function pushedPr(projects: readonly Pick<Project, 'id' | 'repos'>[], boards: ReadonlyMap<string, Board>, repo: string, number: number): { projectId: string; title: string } | undefined {
  const project = projects.find((p) => p.repos.includes(repo));
  const pr = project && boards.get(project.id)?.prs.find((p) => p.repo === repo && p.number === number);
  return project && pr ? { projectId: project.id, title: pr.title } : undefined;
}

/** How a file is sent: its type (an extension, for `res.type`) and its headers. */
export interface Serving {
  type: string;
  headers: Record<string, string>;
}

const KEEP = 'max-age=31536000, immutable';
// an SVG is served from Focus's own origin: nothing in it runs or loads
const SVG_SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** A picture, kept for good unless `fresh`: an SVG one sandboxed so nothing in it runs. */
const picture = (ext: string, fresh: boolean): Serving => ({
  type: ext,
  headers: { 'Cache-Control': fresh ? 'no-cache' : KEEP, ...(ext === 'svg' && { 'Content-Security-Policy': SVG_SANDBOX }) },
});

/** A QA screenshot or recording (`GET /api/qa-shots/:file`), or undefined for a name Focus doesn't serve. */
export function qaShotServing(file: string): Serving | undefined {
  const ext = /^[\w-]+\.(jpg|png|svg|gif|mp4)$/.exec(file)?.[1];
  return ext ? picture(ext, false) : undefined;
}

/**
 * What a goal's lead put on their station's screen (`GET /api/artifacts/:lead/:file`), or undefined for a name the
 * Focus doesn't serve: an artifact (data-flow.html) or an option of a question (q1.a.html), and their pictures. The
 * page runs sandboxed in an origin of its own, so its scripts can't reach Focus. A picture's URL changes with
 * each version (?v=), so it's kept; a waypoint's evidence (shot-…) keeps its name from one QA round to the next.
 */
export function artifactServing(lead: string, file: string): Serving | undefined {
  if (!/^lead_\w+$/.test(lead)) return undefined;
  const ext = /^[a-z0-9][a-z0-9-]*(?:\.[a-d])?\.(html|jpg)$/.exec(file)?.[1] ?? /^shot-[a-z0-9-]+\.(jpg|png|svg)$/.exec(file)?.[1];
  if (ext === 'html') return { type: 'html', headers: { 'Content-Security-Policy': 'sandbox allow-scripts allow-popups', 'Cache-Control': 'no-cache' } };
  return ext ? picture(ext, file.startsWith('shot-')) : undefined;
}
