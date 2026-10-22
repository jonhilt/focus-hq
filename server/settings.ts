// The captain's settings, as a change to them leaves them.

import { isAutonomy } from '../shared/autonomy';
import { isPluginId } from '../shared/projectPlugins';
import { httpUrl } from './bot';
import { EFFORT_LEVELS, MERGE_METHODS, type Settings } from '../shared/types';

/**
 * The settings once the captain's change (PATCH /api/settings, any JSON) is applied: each field it gets right is taken,
 * cleaned up (models trimmed, the limit on agents at once a whole number from 1 to 32), and anything else is ignored.
 * An empty (or unknown) effort for conflict-resolving agents goes back to the model's default. A lead's compaction
 * threshold is 0 (off) or a whole number of tokens from LEAD_COMPACT_MIN to a million. The plugins switched on for the
 * ship keep only what could be plugins' ids, each once. The public address is an http(s) one ('' clears it).
 */
/** Below this, a compacted lead's conversation (some 30–50k tokens) would soon need compacting again. */
export const LEAD_COMPACT_MIN = 80_000;

export function changeSettings(settings: Settings, patch: unknown): Settings {
  const p: Partial<Record<keyof Settings, unknown>> = patch !== null && typeof patch === 'object' ? patch : {};
  const s = { ...settings };
  if (typeof p.maxConcurrent === 'number' && Number.isFinite(p.maxConcurrent)) s.maxConcurrent = Math.max(1, Math.min(32, Math.round(p.maxConcurrent)));
  if (isAutonomy(p.autonomy)) s.autonomy = p.autonomy;
  if (typeof p.model === 'string') s.model = p.model.trim();
  if (typeof p.conflictsModel === 'string') s.conflictsModel = p.conflictsModel.trim();
  if (p.conflictsEffort !== undefined) s.conflictsEffort = EFFORT_LEVELS.find((e) => e === p.conflictsEffort);
  if (typeof p.qaModel === 'string') s.qaModel = p.qaModel.trim();
  s.mergeMethod = MERGE_METHODS.find((m) => m === p.mergeMethod) ?? s.mergeMethod;
  if (typeof p.attribution === 'boolean') s.attribution = p.attribution;
  if (typeof p.userClaudeMd === 'boolean') s.userClaudeMd = p.userClaudeMd;
  s.leadEffort = EFFORT_LEVELS.find((e) => e === p.leadEffort) ?? s.leadEffort;
  if (Array.isArray(p.plugins)) s.plugins = [...new Set(p.plugins.filter(isPluginId))];
  if (typeof p.leadCompactAt === 'number' && Number.isFinite(p.leadCompactAt)) s.leadCompactAt = p.leadCompactAt <= 0 ? 0 : Math.max(LEAD_COMPACT_MIN, Math.min(1_000_000, Math.round(p.leadCompactAt)));
  const publicUrl = typeof p.publicUrl === 'string' ? httpUrl(p.publicUrl) : undefined;
  if (publicUrl) s.publicUrl = publicUrl;
  else if (publicUrl === '') delete s.publicUrl;
  return s;
}
