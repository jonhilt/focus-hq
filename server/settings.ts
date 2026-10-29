// The captain's settings, as a change to them leaves them.

import { isAutonomy } from '../shared/autonomy';
import { isPluginId } from '../shared/projectPlugins';
import { httpUrl } from './bot';
import { EFFORT_LEVELS, MERGE_METHODS, type PinnedSettings, type Settings, SETTINGS_ENV } from '../shared/types';

/**
 * The settings once the captain's change (PATCH /api/settings, any JSON) is applied: each field it gets right is taken,
 * cleaned up (models trimmed, the limit on agents at once a whole number from 1 to 32), and anything else is ignored.
 * An empty (or unknown) effort for conflict-resolving agents goes back to the model's default. A lead's compaction
 * threshold is 0 (off) or a whole number of tokens from LEAD_COMPACT_MIN to a million. The plugins switched on for the
 * ship keep only what could be plugins' ids, each once. The public address is an http(s) one ('' clears it); the
 * browser and whisper commands and paths are trimmed, empty clearing them. The preview mirrors' hosts are
 * 'off' or a list of addresses (`previewHosts`), empty going back to the Tailscale addresses.
 */
/** Below this, a compacted lead's conversation (some 30–50k tokens) would soon need compacting again. */
export const LEAD_COMPACT_MIN = 80_000;

/** The settings that are a command or a file's path on this machine. */
const PATH_SETTINGS = ['browserPath', 'whisperBin', 'whisperModel'] as const;

export function changeSettings(settings: Settings, patch: unknown): Settings {
  const p: Partial<Record<keyof Settings, unknown>> = patch !== null && typeof patch === 'object' ? patch : {};
  const s = { ...settings };
  if (typeof p.maxConcurrent === 'number' && Number.isFinite(p.maxConcurrent)) s.maxConcurrent = Math.max(1, Math.min(32, Math.round(p.maxConcurrent)));
  if (isAutonomy(p.autonomy)) s.autonomy = p.autonomy;
  if (typeof p.model === 'string') s.model = p.model.trim();
  if (typeof p.conflictsModel === 'string') s.conflictsModel = p.conflictsModel.trim();
  if (p.conflictsEffort !== undefined) s.conflictsEffort = EFFORT_LEVELS.find((e) => e === p.conflictsEffort);
  if (typeof p.qaModel === 'string') s.qaModel = p.qaModel.trim();
  if (typeof p.codexModel === 'string') s.codexModel = p.codexModel.trim();
  s.mergeMethod = MERGE_METHODS.find((m) => m === p.mergeMethod) ?? s.mergeMethod;
  if (typeof p.attribution === 'boolean') s.attribution = p.attribution;
  if (typeof p.userClaudeMd === 'boolean') s.userClaudeMd = p.userClaudeMd;
  s.leadEffort = EFFORT_LEVELS.find((e) => e === p.leadEffort) ?? s.leadEffort;
  if (Array.isArray(p.plugins)) s.plugins = [...new Set(p.plugins.filter(isPluginId))];
  if (typeof p.leadCompactAt === 'number' && Number.isFinite(p.leadCompactAt)) s.leadCompactAt = p.leadCompactAt <= 0 ? 0 : Math.max(LEAD_COMPACT_MIN, Math.min(1_000_000, Math.round(p.leadCompactAt)));
  if (typeof p.autoUpdate === 'boolean') s.autoUpdate = p.autoUpdate;
  if (typeof p.speechGpu === 'boolean') s.speechGpu = p.speechGpu;
  for (const key of PATH_SETTINGS) {
    const value = p[key];
    if (typeof value !== 'string') continue;
    if (value.trim()) s[key] = value.trim();
    else delete s[key];
  }
  if (typeof p.previewHosts === 'string') {
    const hosts = previewHosts(p.previewHosts);
    if (hosts) s.previewHosts = hosts;
    else delete s.previewHosts;
  }
  const publicUrl = typeof p.publicUrl === 'string' ? httpUrl(p.publicUrl) : undefined;
  if (publicUrl) s.publicUrl = publicUrl;
  else if (publicUrl === '') delete s.publicUrl;
  return s;
}

/** Where preview mirrors listen, as typed: 'off', or the addresses listed, tidied ('' when there are none). */
export function previewHosts(typed: string): string {
  if (typed.trim().toLowerCase() === 'off') return 'off';
  return [...new Set(typed.split(/[\s,]+/).filter(Boolean))].join(', ');
}

type Env = Record<string, string | undefined>;

/** The settings an environment variable sets (SETTINGS_ENV), each by its name: set to nothing but spaces is unset. */
export function pinnedSettings(env: Env = process.env): PinnedSettings {
  return Object.fromEntries(Object.entries(SETTINGS_ENV).filter(([, name]) => env[name]?.trim()));
}

/**
 * The settings Focus goes by: the captain's, with each an environment variable sets as it sets it (FOCUS_AUTO_UPDATE=0
 * is off, anything else on; FOCUS_KOKORO_GPU=0 or false is off, anything else on).
 */
export function settingsInForce(settings: Settings, env: Env = process.env): Settings {
  const value = (key: keyof typeof SETTINGS_ENV) => env[SETTINGS_ENV[key]]?.trim() || undefined;
  const [autoUpdate, speechGpu] = [value('autoUpdate'), value('speechGpu')];
  const paths = Object.fromEntries([...PATH_SETTINGS, 'previewHosts' as const].flatMap((key) => (value(key) ? [[key, value(key)]] : [])));
  return { ...settings, ...(autoUpdate && { autoUpdate: autoUpdate !== '0' }), ...(speechGpu && { speechGpu: speechGpu !== '0' && speechGpu !== 'false' }), ...paths };
}
