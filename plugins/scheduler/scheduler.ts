// The scheduler at work: keeps the book, wakes as each schedule falls due (croner's timers, which look at the wall
// clock at least every 30 seconds, so a machine waking from sleep is noticed), and runs what `due` says. A slot is
// claimed in the book before its lead hears of it, so no slot ever runs twice, a restart included; what fell due
// while Focus was down runs as it starts again.
import { Cron } from 'croner';
import type { Kept } from './book';
import { type Due, due, finished, MOST_PER_LEAD, nextSlot, ranOutcome, runMessage, type ScheduleAsk, scheduleTimes } from './rules';
import type { RunOutcome, RunRecord, Schedule, SchedulerState } from './shared';

/** How the lead's message went: sent (or waiting to be heard), held on the API key's cost, or there's no such lead any more. */
export type Delivery = 'sent' | 'held' | 'gone';

/** Who asked: the goal's lead calling the tool. */
export interface Asker {
  leadId: string;
  projectId: string;
  leadName: string;
}

export interface SchedulerDeps {
  book: { read(): Kept; write(kept: Kept): void };
  now(): number;
  /** The time zone a schedule's times are read in when the lead names none: this machine's. */
  tz: string;
  /** Wakes the lead with `text`. */
  deliver(s: Schedule, text: string): Delivery;
  /** A slot went other than on time (late, missed, held): for the captain to hear. */
  heard(s: Schedule, run: RunRecord): void;
  /** The schedules and runs, as the browser shows them. */
  publish(state: SchedulerState): void;
  /** Calls `fire` at `at` (epoch ms); returns how to call it off. croner's by default. */
  wake?: (at: number, fire: () => void) => () => void;
}

const cronerWake = (at: number, fire: () => void) => {
  const job = new Cron(new Date(at), { unref: true }, fire);
  return () => job.stop();
};

/** A safety net under the timers: a tick at least this often, whatever they do. */
export const TICK_MS = 60_000;

export class Scheduler {
  private kept: Kept;
  private readonly wake: (at: number, fire: () => void) => () => void;
  private timer: (() => void) | undefined;
  private net: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: SchedulerDeps) {
    this.kept = deps.book.read();
    this.wake = deps.wake ?? cronerWake;
  }

  /** Runs what fell due while Focus was down, and from then on each slot as it falls due. */
  start(): void {
    this.publish();
    this.tick();
    this.net = setInterval(() => this.tick(), TICK_MS);
    this.net.unref();
  }

  stop(): void {
    this.timer?.();
    this.timer = undefined;
    if (this.net) clearInterval(this.net);
  }

  /** A lead's new schedule, checked (a throw says what's wrong), kept and timed. */
  add(asker: Asker, ask: ScheduleAsk): Schedule {
    const now = this.deps.now();
    const times = scheduleTimes(ask, now, this.deps.tz);
    if (this.of(asker.leadId).length >= MOST_PER_LEAD) throw new Error(`You have ${MOST_PER_LEAD} schedules already: unschedule one first.`);
    const made = this.kept.made + 1;
    const s: Schedule = { id: `sch-${made}`, ...asker, what: ask.what.trim(), ...times, createdAt: now };
    this.save({ ...this.kept, made, schedules: [...this.kept.schedules, s] });
    return s;
  }

  /** Takes a lead's schedule away (anyone's, for the captain, without `leadId`): false when there's none by that id. */
  remove(leadId: string | undefined, id: string): boolean {
    if (!this.kept.schedules.some((s) => s.id === id && (leadId === undefined || s.leadId === leadId))) return false;
    this.save({ ...this.kept, schedules: this.kept.schedules.filter((s) => s.id !== id) });
    return true;
  }

  /** Every schedule a lead has, oldest first. */
  of(leadId: string): Schedule[] {
    return this.kept.schedules.filter((s) => s.leadId === leadId);
  }

  /** A schedule's next slot from now, or null once it has none left. */
  next(s: Schedule): number | null {
    return nextSlot(s, Math.max(this.deps.now(), s.lastSlot ?? 0));
  }

  /** The runs kept, newest last. */
  runs(): readonly RunRecord[] {
    return this.kept.runs;
  }

  /** Runs every schedule's due slot, claiming each in the book before its lead hears of it; finished schedules go. */
  tick(): void {
    const now = this.deps.now();
    for (const s of this.kept.schedules) {
      const d = due(s, now);
      if (d) this.run(s, d, now);
    }
    const left = this.kept.schedules.filter((s) => !finished(s, now));
    if (left.length !== this.kept.schedules.length) this.save({ ...this.kept, schedules: left });
    else this.arm();
  }

  /** Claims a schedule's due slot (and reports those it missed) in the book, then wakes its lead. */
  private run(s: Schedule, d: Due, now: number): void {
    const record = (slot: number, outcome: RunOutcome): RunRecord => ({ scheduleId: s.id, leadId: s.leadId, slot, at: now, outcome });
    const missed = d.missed.map((slot) => record(slot, 'missed'));
    const claimed = { ...s, lastSlot: d.run };
    this.save({ ...this.kept, schedules: this.kept.schedules.map((x) => (x.id === s.id ? claimed : x)), runs: [...this.kept.runs, ...missed, record(d.run, ranOutcome(d))] });
    const delivery = this.deps.deliver(claimed, runMessage(claimed, d, now));
    if (delivery === 'gone') this.save({ ...this.kept, schedules: this.kept.schedules.filter((x) => x.id !== s.id) });
    if (delivery === 'held') this.save({ ...this.kept, runs: this.kept.runs.map((r) => (r.scheduleId === s.id && r.slot === d.run ? { ...r, outcome: 'held' } : r)) });
    const ran = record(d.run, delivery === 'held' ? 'held' : ranOutcome(d));
    for (const r of [...missed, ran]) if (r.outcome !== 'on-time') this.deps.heard(claimed, r);
  }

  /** Keeps the book (on disk before anything else hears of it), tells the browser, and times the next slot. */
  private save(kept: Kept): void {
    this.deps.book.write(kept);
    this.kept = kept;
    this.publish();
    this.arm();
  }

  private publish(): void {
    this.deps.publish({ schedules: this.kept.schedules.map((s) => ({ ...s, next: this.next(s) })), runs: this.kept.runs.slice(-50) });
  }

  /** One timer, for the soonest slot of any schedule. */
  private arm(): void {
    this.timer?.();
    this.timer = undefined;
    const soonest = Math.min(...this.kept.schedules.map((s) => this.next(s) ?? Infinity));
    if (soonest !== Infinity) this.timer = this.wake(soonest, () => this.tick());
  }
}
