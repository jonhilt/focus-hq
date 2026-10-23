// The scheduler's schedules and runs, as its server part keeps them and the browser reads them (its state).

/** The plugin's id: in FOCUS_PLUGINS, and its state's key. */
export const SCHEDULER = 'scheduler';

/** A goal's lead asked to be woken: once (`at`), or on a cron pattern until `until`. */
export interface Schedule {
  id: string;
  leadId: string;
  projectId: string;
  /** The lead's name, for the panel and toasts. */
  leadName: string;
  /** What the lead is to do when it's due, said back to them each time. */
  what: string;
  /** A five-part cron pattern (minute hour day month weekday), read in `tz`. */
  cron?: string;
  /** A single run, at this moment (epoch ms). */
  at?: number;
  /** No run at or after this moment (epoch ms). */
  until?: number;
  /** The IANA time zone its times are read in. */
  tz: string;
  createdAt: number;
  /** The latest slot (epoch ms) it has claimed, run or reported missed: none before it's first due. */
  lastSlot?: number;
}

/** How a slot went: run on time, run late (Focus was down or asleep), missed (a later slot ran in its place), or held (the lead's message waits on the API key's cost). */
export type RunOutcome = 'on-time' | 'late' | 'missed' | 'held';

/** One slot of a schedule, as it went. */
export interface RunRecord {
  scheduleId: string;
  leadId: string;
  /** When it was due (epoch ms). */
  slot: number;
  /** When the scheduler dealt with it (epoch ms). */
  at: number;
  outcome: RunOutcome;
  /**
   * When the lead has to have answered it by (a run that woke them): the watchdog's deadline. Runs from before the
   * watchdog have none, so it never alerts on them.
   */
  answerBy?: number;
  /** When a turn of the lead's ended after it was sent: they answered. */
  answeredAt?: number;
  /** When the captain was alerted that the lead hadn't answered it. */
  alertedAt?: number;
}

/** A schedule as the panel shows it: with its next run, or null once it has none left. */
export interface ScheduleView extends Schedule {
  next: number | null;
}

/** The plugin's state, as the browser reads it: every schedule, and the latest runs, newest last. */
export interface SchedulerState {
  schedules: ScheduleView[];
  runs: RunRecord[];
}

export const freshScheduler = (): SchedulerState => ({ schedules: [], runs: [] });
