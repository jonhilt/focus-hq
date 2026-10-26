// What the scheduler's panel shows, pure: each lead's schedules with their next run and how their latest runs went.
import { describeTimes, lateBy, slotTime } from './schedulerRules';
import type { RunOutcome, RunRecord, SchedulerState } from './shared';

export interface RunChip {
  label: string;
  outcome: RunOutcome;
  /** The captain was alerted that the lead hadn't answered it, and they still haven't. */
  unanswered: boolean;
}

export interface ScheduleRow {
  id: string;
  times: string;
  next: string;
  what: string;
  runs: RunChip[];
}

export interface LeadGroup {
  leadId: string;
  leadName: string;
  rows: ScheduleRow[];
}

/** How many of a schedule's runs the panel shows, newest. */
const RUNS_SHOWN = 6;

/** How a run went, after its time: nothing on time. */
const runNote = (r: RunRecord) => (r.outcome === 'late' ? ` · ${lateBy(r.at - r.slot)} late` : r.outcome === 'on-time' ? '' : ` · ${r.outcome}`);

/** Each lead's schedules, in the order they were made, with their latest runs (newest last). */
export function panelGroups(state: SchedulerState, now: number): LeadGroup[] {
  const groups = new Map<string, LeadGroup>();
  for (const s of state.schedules) {
    const group = groups.get(s.leadId) ?? { leadId: s.leadId, leadName: s.leadName, rows: [] };
    groups.set(s.leadId, group);
    const runs = state.runs.filter((r) => r.scheduleId === s.id).slice(-RUNS_SHOWN).map((r): RunChip => {
      const unanswered = r.alertedAt !== undefined && r.answeredAt === undefined;
      return { outcome: r.outcome, unanswered, label: `${slotTime(r.slot, s.tz, now)}${runNote(r)}${unanswered ? ' · unanswered' : ''}` };
    });
    group.rows.push({ id: s.id, times: describeTimes(s, now), next: s.next === null ? 'none left' : slotTime(s.next, s.tz, now), what: s.what, runs });
  }
  return [...groups.values()];
}
