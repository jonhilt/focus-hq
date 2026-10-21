// A project's settings, as the captain's change to them leaves them.

import { mergeCheckNames } from '../shared/mergeCheck';
import { switchPlugin } from '../shared/projectPlugins';
import { QA_BRIEF_MAX } from '../shared/qa';
import { DESKS_PER_ROOM, EFFORT_LEVELS, MERGE_METHODS, type PreviewConfig, type Project, ROOM_THEMES } from '../shared/types';

/** A JSON object's fields, to check one at a time: anything else has none. */
type Fields = Partial<Record<string, unknown>>;

const fields = (v: unknown): Fields => (v !== null && typeof v === 'object' ? v : {});
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const flag = (v: unknown, was: boolean | undefined) => (typeof v === 'boolean' ? v : was);

/**
 * The project once the captain's change (PATCH /api/projects/:id, any JSON) is applied: each field it gets right is
 * taken, cleaned up (text trimmed, a blank name or colour kept as it was, the limit on agents a whole number from 1 to
 * the room's desks, QA's brief at most 4000 characters), and anything else is ignored. An empty (or unknown) QA effort
 * or merge method goes back to the default. Throws, in words and before anything changes, for an unknown theme, a bad
 * plugin id or a merge method for a repo the project hasn't connected. The project it's given is left as it was.
 */
export function changeProject(project: Project, patch: unknown): Project {
  const p = fields(patch);
  const theme = p.theme === undefined ? project.theme : ROOM_THEMES.find((t) => t === p.theme);
  if (!theme && p.theme !== undefined) throw new Error(`Unknown room theme ${String(p.theme)}`);
  const changed: Project = {
    ...project,
    name: text(p.name) ?? project.name,
    color: text(p.color) ?? project.color,
    theme,
    autoAssign: flag(p.autoAssign, project.autoAssign) ?? false,
    autoLabel: typeof p.autoLabel === 'string' ? p.autoLabel.trim() : project.autoLabel,
    onlyMyPrs: flag(p.onlyMyPrs, project.onlyMyPrs),
    autoQa: flag(p.autoQa, project.autoQa),
    autoSendBack: flag(p.autoSendBack, project.autoSendBack),
    autoMerge: flag(p.autoMerge, project.autoMerge),
    cosAutoSend: flag(p.cosAutoSend, project.cosAutoSend),
    qaProof: flag(p.qaProof, project.qaProof),
    hidden: flag(p.hidden, project.hidden),
  };
  if (typeof p.maxAgents === 'number' && Number.isFinite(p.maxAgents)) changed.maxAgents = Math.max(1, Math.min(DESKS_PER_ROOM, Math.round(p.maxAgents)));
  if (typeof p.qaBrief === 'string') changed.qaBrief = p.qaBrief.slice(0, QA_BRIEF_MAX);
  if (p.qaEffort !== undefined) changed.qaEffort = EFFORT_LEVELS.find((e) => e === p.qaEffort);
  // one plugin at a time, so two windows switching different ones don't undo each other
  if (p.plugin !== undefined) changed.plugins = switchPlugin(project.plugins, String(fields(p.plugin).id ?? ''), fields(p.plugin).on === true);
  if (p.mergeMethod !== undefined) changed.mergeMethods = mergeMethodsAfter(project, fields(p.mergeMethod));
  if (p.preview !== undefined && typeof p.preview === 'object') changed.preview = previewAfter(fields(p.preview));
  if (p.mergeChecks === null || typeof p.mergeChecks === 'string' || Array.isArray(p.mergeChecks)) changed.mergeChecks = mergeCheckNames(p.mergeChecks);
  return changed;
}

/** A repo's merge method set, or (empty or unknown) cleared to follow the office-wide setting. */
function mergeMethodsAfter(project: Project, { repo, method }: Fields): Project['mergeMethods'] {
  if (typeof repo !== 'string' || !project.repos.includes(repo)) throw new Error(`${String(repo)} isn’t connected to ${project.name}`);
  const { [repo]: _, ...rest } = project.mergeMethods ?? {};
  const chosen = MERGE_METHODS.find((m) => m === method);
  return chosen ? { ...rest, [repo]: chosen } : rest;
}

/** The preview's commands, an empty one going back to the default. */
function previewAfter(p: Fields): PreviewConfig {
  return { command: text(p.command), stopCommand: text(p.stopCommand), statusCommand: text(p.statusCommand) };
}

/**
 * What the office does once a change is saved: tell the plugins one was switched, seat agents again, and hold the
 * chief of staff's words that were counting down to go by themselves, once that's switched off.
 */
export function projectChangeFollowUps(patch: unknown): { plugins: boolean; schedule: boolean; holdSends: boolean } {
  const p = fields(patch);
  return {
    plugins: p.plugin !== undefined,
    holdSends: p.cosAutoSend === false,
    schedule: p.autoAssign === true || p.autoMerge === true || typeof p.maxAgents === 'number',
  };
}
