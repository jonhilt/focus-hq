// The captain's settings, as a change to them leaves them.

import { isAutonomy } from '../shared/autonomy';
import { EFFORT_LEVELS, MERGE_METHODS, type Settings } from '../shared/types';

/**
 * The settings once the captain's change (PATCH /api/settings, any JSON) is applied: each field it gets right is taken,
 * cleaned up (models trimmed, the limit on agents at once a whole number from 1 to 32), and anything else is ignored.
 * An empty (or unknown) effort for conflict-resolving agents goes back to the model's default.
 */
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
  return s;
}
