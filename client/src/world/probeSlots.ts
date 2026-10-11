import type { BackgroundTask } from '../../../shared/types';

/** How many probes float by a lead's chair; any more show as '+N'. */
export const MAX_PROBES = 4;

/**
 * Which of a lead's background tasks get a probe, up to `max`: the running ones before the ones that just ended, then
 * in the order they started, so a probe keeps its place as the others come and go; `more` is how many don't.
 */
export function probeSlots(tasks: readonly BackgroundTask[], max = MAX_PROBES): { shown: BackgroundTask[]; more: number } {
  const byStart = [...tasks].sort((a, b) => a.startedAt - b.startedAt);
  const picked = new Set([...byStart.filter((t) => t.status === 'running'), ...byStart.filter((t) => t.status !== 'running')].slice(0, max));
  const shown = byStart.filter((t) => picked.has(t));
  return { shown, more: tasks.length - shown.length };
}

/** `text` on one line, cut to `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** What a probe's label says: the command (or what the monitor watches), cut short, and how it stands. */
export function probeCaption(task: BackgroundTask): { command: string; status: string } {
  return { command: clip(task.description, 30), status: `${task.kind === 'monitor' ? 'Monitor' : 'Shell'} · ${task.status}` };
}

/** How long it's run, or ran for: "42s", "3m", "1h 5m". */
export function runningFor(task: BackgroundTask, now: number): string {
  const s = Math.max(0, Math.round(((task.endedAt ?? now) - task.startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
