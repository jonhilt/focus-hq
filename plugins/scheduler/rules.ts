// The scheduler's decisions, pure: what a lead may schedule, which slots have fallen due, and what to do with them.
// croner does the calendar (cron patterns, time zones, the clocks changing); nothing here reads the clock or a file.
import { Cron } from 'croner';
import type { RunOutcome, RunRecord, Schedule } from './shared';

/** A run this long after its slot is late: Focus was down, or the machine asleep, as it fell due. */
export const LATE_MS = 60_000;
/** How long a lead has to answer a run (a turn of theirs ending after it) before the captain is alerted. */
export const ANSWER_MS = 20 * 60_000;
/** The closest two runs of one schedule may be: every run is a lead turn, so none more often than this. */
export const MIN_GAP_MS = 5 * 60_000;
/** The most schedules one lead may keep at once. */
export const MOST_PER_LEAD = 10;
/** The most slots looked at in one go, so a schedule left a long time can't run away with a tick. */
const MOST_SLOTS = 1000;

/** A cron pattern read in `tz`, for its runs (never started: it times nothing itself). */
const pattern = (cron: string, tz: string) => new Cron(cron, { timezone: tz, mode: '5-part' });

/** A moment written in `tz`'s local time (`2026-10-26T09:07`, or a day alone, `2026-10-26`, meaning its last second), or with an offset. */
export function moment(text: string, tz: string, dayEnds = false): number {
  const local = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T${dayEnds ? '23:59:59' : '00:00:00'}` : text;
  const unreadable = new Error(`“${text}” isn’t a time I can read: write it like 2026-10-26T09:07.`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) throw unreadable;
  let at: Date | null;
  try {
    at = new Cron(local, { timezone: tz }).getOnce();
  } catch {
    throw unreadable;
  }
  if (!at || isNaN(at.getTime())) throw unreadable;
  return at.getTime();
}

/** A schedule's next slot after `after` (epoch ms), or null when it has none left. */
export function nextSlot(s: Pick<Schedule, 'cron' | 'at' | 'until' | 'tz'>, after: number): number | null {
  if (s.at !== undefined) return s.at > after ? s.at : null;
  if (!s.cron) return null;
  const next = pattern(s.cron, s.tz).nextRun(new Date(after))?.getTime() ?? null;
  return next === null || (s.until !== undefined && next >= s.until) ? null : next;
}

/** The slots that fell due since the schedule last claimed one, up to `now`, oldest first. */
export function slotsDue(s: Schedule, now: number): number[] {
  const slots: number[] = [];
  for (let t = nextSlot(s, s.lastSlot ?? s.createdAt); t !== null && t <= now && slots.length < MOST_SLOTS; t = nextSlot(s, t)) slots.push(t);
  return slots;
}

/** What a tick does with a schedule: run its latest slot (late, if it is), and report those before it missed. */
export interface Due {
  run: number;
  late: boolean;
  missed: number[];
}

/**
 * What's due of a schedule at `now`, if anything. Only the latest slot runs, however many fell due while Focus was
 * down or asleep: it runs once, marked late if it is, and the ones before it are reported missed, never run.
 */
export function due(s: Schedule, now: number): Due | null {
  const slots = slotsDue(s, now);
  const run = slots.at(-1);
  if (run === undefined) return null;
  return { run, late: now - run > LATE_MS, missed: slots.slice(0, -1) };
}

/** Whether a schedule has nothing left to run, so it can go. */
export const finished = (s: Schedule, now: number) => !due(s, now) && nextSlot(s, Math.max(now, s.lastSlot ?? 0)) === null;

/** What a lead asks for (the schedule tool's input), checked. */
export interface ScheduleAsk {
  what: string;
  cron?: string;
  at?: string;
  until?: string;
  timezone?: string;
}

/** A lead's ask made into a schedule's times, or a throw saying, in words, what's wrong with it. */
export function scheduleTimes(ask: ScheduleAsk, now: number, defaultTz: string): Pick<Schedule, 'cron' | 'at' | 'until' | 'tz'> {
  const tz = ask.timezone?.trim() || defaultTz;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw new Error(`“${tz}” isn’t a time zone: give an IANA name, like Europe/London.`);
  }
  if (!ask.what.trim()) throw new Error('Say what to do when it’s due (`what`).');
  if (!!ask.cron === !!ask.at) throw new Error('Give either `cron` (repeating) or `at` (once), not both or neither.');
  if (ask.at) {
    const at = moment(ask.at, tz);
    if (at <= now) throw new Error(`${ask.at} has passed already.`);
    return { at, tz };
  }
  const cron = ask.cron?.trim() ?? '';
  try {
    pattern(cron, tz);
  } catch (err) {
    throw new Error(`“${cron}” isn’t a five-part cron pattern (minute hour day month weekday): ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  const until = ask.until ? moment(ask.until, tz, true) : undefined;
  const times = { cron, tz, ...(until !== undefined && { until }) };
  const first = nextSlot(times, now);
  if (first === null) throw new Error('That never comes round before `until`.');
  const second = nextSlot(times, first);
  if (second !== null && second - first < MIN_GAP_MS) throw new Error(`That runs more often than every ${MIN_GAP_MS / 60_000} minutes: each run is a turn of yours.`);
  return times;
}

/** A slot as the lead and the captain read it: its time of day in the schedule's zone, and the day if it isn't `today`'s. */
export function slotTime(slot: number, tz: string, today = slot): string {
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { timeZone: tz });
  const time = new Date(slot).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return day(slot) === day(today) ? time : `${new Date(slot).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** How late a run is, in words: minutes, or hours and minutes. */
export function lateBy(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** What the lead hears when a slot of theirs runs: what they asked to do, and whether it's late and what was missed. */
export function runMessage(s: Schedule, d: Due, now: number): string {
  const when = slotTime(d.run, s.tz, now);
  const head = d.late
    ? `Your schedule ${s.id} was due at ${when}; it's running ${lateBy(now - d.run)} late, because Focus was down or the machine asleep.`
    : `Your schedule ${s.id} is due (${when}).`;
  const missed = d.missed.length ? ` Missed and not run: ${d.missed.map((m) => slotTime(m, s.tz, now)).join(', ')}.` : '';
  return `${head}${missed}\n\n${s.what}`;
}

/** The outcome of the slot that ran, before the message's reply says whether it's held. */
export const ranOutcome = (d: Due): RunOutcome => (d.late ? 'late' : 'on-time');

/** Whether the watchdog waits on a run's answer: one that woke its lead (not missed or held) with a deadline to answer by. */
const watched = (r: RunRecord): r is RunRecord & { answerBy: number } => (r.outcome === 'on-time' || r.outcome === 'late') && r.answerBy !== undefined;

/** Runs a lead hasn't answered whose time to answer is up, and the captain hasn't been alerted of yet. */
export const overdue = (runs: readonly RunRecord[], now: number): RunRecord[] =>
  runs.filter((r) => watched(r) && r.answeredAt === undefined && r.alertedAt === undefined && now >= r.answerBy);

/** When the soonest run still waiting on its lead's answer falls overdue, or null when none is waiting. */
export function nextDeadline(runs: readonly RunRecord[]): number | null {
  const waiting = runs.filter(watched).filter((r) => r.answeredAt === undefined && r.alertedAt === undefined).map((r) => r.answerBy);
  return waiting.length ? Math.min(...waiting) : null;
}

/** A lead's turn ended at `now`: every run of theirs sent by then and not yet answered is answered. */
export const answering = (runs: readonly RunRecord[], leadId: string, now: number): RunRecord[] =>
  runs.filter((r) => r.leadId === leadId && watched(r) && r.answeredAt === undefined && r.at <= now);

/** What the captain is told when a lead hasn't answered a run, and when they answer after all. */
export function unansweredText(s: Pick<Schedule, 'id' | 'leadName' | 'tz'>, run: RunRecord, now: number): string {
  return `${s.leadName} hasn’t answered the ${slotTime(run.slot, s.tz, now)} check (${s.id}) after ${lateBy(now - run.at)}.`;
}

export function answeredLateText(s: Pick<Schedule, 'id' | 'leadName' | 'tz'>, run: RunRecord, now: number): string {
  return `${s.leadName} answered the ${slotTime(run.slot, s.tz, now)} check (${s.id}) after all, ${lateBy(now - run.at)} after it was sent.`;
}

/** A schedule's times in words, for the lead and the panel. */
export function describeTimes(s: Pick<Schedule, 'cron' | 'at' | 'until' | 'tz'>, now: number): string {
  if (s.at !== undefined) return `once at ${slotTime(s.at, s.tz, now)} (${s.tz})`;
  return `cron “${s.cron}” (${s.tz})${s.until !== undefined ? ` until ${slotTime(s.until, s.tz, now)}` : ''}`;
}
