// The briefings plugin's parts its server and browser share (README.md): the beats as the screen hears of them from the
// player, what a new version of a briefing changed, and the captain's setting for who writes a lead's brief up.
import { type Effort, EFFORT_LEVELS, type Settings } from '../../plugin-api/shared';

/** The plugin's id, as FOCUS_PLUGINS and a project's settings name it. */
export const BRIEFINGS = 'briefings';

/** A briefing's beats as the screen hears of them from its player: each one's line (its narration) and title. */
export interface BriefingBeats {
  lines: string[];
  titles?: string[];
}

/**
 * The first beat a new version of a briefing changed (its line or title differs, or it's new), counted from 0; -1 when
 * every beat reads as it did (only the stage changed, say), or there was nothing before to compare it with.
 */
export function firstChangedBeat(before: BriefingBeats | undefined, after: BriefingBeats): number {
  if (!before) return -1;
  const differs = (i: number) => before.lines[i] !== after.lines[i] || (before.titles?.[i] ?? '') !== (after.titles?.[i] ?? '');
  for (let i = 0; i < after.lines.length; i++) if (i >= before.lines.length || differs(i)) return i;
  return -1;
}

/** The models the office's writer can write a briefing on; '' is the leads' own (the captain's model setting). */
export const WRITER_MODELS = [
  { id: '', label: 'As the leads' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const;

/** The captain's setting for the writer that turns a lead's brief into an explainer: '' for the leads' own model or effort. */
export interface WriterSetting {
  model: string;
  effort: Effort | '';
  /** Fast mode: quicker, at twice the price; only Opus has it. */
  fast: boolean;
}

/** The plugin's saved state: the writer setting, and what the last brief cost to write up. */
export interface BriefingsState {
  writer: WriterSetting;
  last?: { model: string; effort: Effort; fast: boolean; seconds: number; costUsd?: number; at: number };
}

export const freshBriefings = (): BriefingsState => ({ writer: { model: '', effort: '', fast: false } });

/** Whether a model has fast mode (Opus does). */
export const hasFast = (model: string): boolean => /opus/i.test(model);

/** The writer's model, effort and speed as it runs: the setting, or the leads' where it's left to them. */
export function writerRun(setting: WriterSetting, settings: Pick<Settings, 'model' | 'leadEffort'>): { model: string; effort: Effort; fast: boolean } {
  const model = setting.model || settings.model;
  return { model, effort: setting.effort || settings.leadEffort, fast: setting.fast && hasFast(model) };
}

/** How a brief was written up, in a line: "Opus 5.5 on fast mode at low effort, 70 s, $0.30". */
export function writtenHow(w: { model: string; effort: string; fast: boolean; seconds: number; costUsd?: number }): string {
  const model = WRITER_MODELS.find((m) => m.id === w.model)?.label ?? w.model;
  return `${model}${w.fast ? ' on fast mode' : ''} at ${w.effort} effort, ${Math.round(w.seconds)} s${w.costUsd === undefined ? '' : `, $${w.costUsd.toFixed(2)}`}`;
}

/** A change to the setting as a browser sends it, checked; or why it's refused. */
export function writerPatch(body: unknown): Partial<WriterSetting> | string {
  if (!body || typeof body !== 'object') return 'send the writer setting as an object';
  const [model, effort, fast]: unknown[] = ['model', 'effort', 'fast'].map((key): unknown => Reflect.get(body, key));
  const patch: Partial<WriterSetting> = {};
  if (model !== undefined) {
    const known = WRITER_MODELS.find((m) => m.id === model);
    if (!known) return `there's no writer model ${String(model)}`;
    patch.model = known.id;
  }
  if (effort !== undefined) {
    const level = effort === '' ? '' : EFFORT_LEVELS.find((e) => e === effort);
    if (level === undefined) return `there's no effort ${String(effort)}`;
    patch.effort = level;
  }
  if (fast !== undefined) {
    if (typeof fast !== 'boolean') return 'fast is on or off';
    patch.fast = fast;
  }
  return patch;
}
