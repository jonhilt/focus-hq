import { describe, expect, it } from 'vitest';
import type { Kept } from './book';
import { type Delivery, Scheduler } from './scheduler';
import type { RunRecord, Schedule, SchedulerState } from './shared';

const at = (iso: string) => Date.parse(iso);
const LEAD = { leadId: 'lead-1', projectId: 'p', leadName: 'Novak' };

/** A scheduler on a book in memory and a clock the test moves, waking only when the test says (`fire`). */
function aboard(start = at('2026-10-23T11:00:00Z'), book: { kept?: Kept } = {}) {
  let clock = start;
  const delivered: { id: string; text: string }[] = [];
  const heard: RunRecord[] = [];
  let published: SchedulerState | undefined;
  let alarm: { at: number; fire: () => void } | undefined;
  let reply: Delivery = 'sent';
  const sched = new Scheduler({
    book: { read: () => book.kept ?? { made: 0, schedules: [], runs: [] }, write: (k) => void (book.kept = structuredClone(k)) },
    now: () => clock,
    tz: 'Europe/London',
    deliver: (s: Schedule, text: string) => {
      if (reply !== 'gone') delivered.push({ id: s.id, text });
      return reply;
    },
    heard: (_s, run) => void heard.push(run),
    publish: (state) => void (published = state),
    wake: (when, fire) => {
      alarm = { at: when, fire };
      return () => void (alarm = undefined);
    },
  });
  return {
    sched, book, delivered, heard,
    published: () => published,
    alarm: () => alarm?.at,
    replies: (d: Delivery) => void (reply = d),
    /** The clock moves to `iso` and the alarm goes off, as croner's timer would. */
    fire: (iso: string) => {
      clock = at(iso);
      alarm?.fire();
    },
  };
}

describe('the scheduler', () => {
  it('wakes the lead once at each slot, and times the next', () => {
    const o = aboard();
    o.sched.start();
    const s = o.sched.add(LEAD, { what: 'Check the rollout.', cron: '7 9,15,21 * * *', until: '2026-10-26' });
    expect(o.alarm()).toBe(at('2026-10-23T14:07:00Z'));
    o.fire('2026-10-23T14:07:00.003Z');
    expect(o.delivered).toEqual([{ id: s.id, text: 'Your schedule sch-1 is due (15:07).\n\nCheck the rollout.' }]);
    expect(o.alarm()).toBe(at('2026-10-23T20:07:00Z'));
    // a second tick in the same slot runs nothing
    o.sched.tick();
    expect(o.delivered).toHaveLength(1);
    expect(o.heard).toEqual([]);
    expect(o.published()?.schedules[0]).toMatchObject({ id: 'sch-1', lastSlot: at('2026-10-23T14:07:00Z'), next: at('2026-10-23T20:07:00Z') });
  });

  // the captain's call: after Focus was down, the latest slot runs once, late; those before are missed, and both are told
  it('catches up as it starts again: the latest slot late, the ones before missed, the captain told of each', () => {
    const first = aboard();
    first.sched.add(LEAD, { what: 'Check the rollout.', cron: '7 9,15,21 * * *', until: '2026-10-26' });
    // Focus is down from 11:00 until 11:00 the next day, then starts on what the book kept
    const again = aboard(at('2026-10-24T11:00:00Z'), first.book);
    again.sched.start();
    expect(again.delivered.map((d) => d.text.split('\n')[0])).toEqual([
      'Your schedule sch-1 was due at 09:07; it\'s running 2 h 53 min late, because Focus was down or the machine asleep. Missed and not run: Fri 23 Oct 15:07, Fri 23 Oct 21:07.',
    ]);
    expect(again.heard.map((r) => r.outcome)).toEqual(['missed', 'missed', 'late']);
    expect(again.book.kept?.runs.map((r) => r.outcome)).toEqual(['missed', 'missed', 'late']);
  });

  it('never runs a slot twice across a restart straight after it ran', () => {
    const first = aboard();
    // noon in London is 11:00 UTC: Focus stops a second after it ran, and starts again
    first.sched.add(LEAD, { what: 'x', cron: '0 13 * * *' });
    first.fire('2026-10-23T12:00:00Z');
    const again = aboard(at('2026-10-23T12:00:01Z'), first.book);
    again.sched.start();
    expect([...first.delivered, ...again.delivered]).toHaveLength(1);
  });

  it('marks a run held when the lead’s message waits on the API key, and tells the captain', () => {
    const o = aboard();
    o.sched.add(LEAD, { what: 'x', at: '2026-10-23T12:30' });
    o.replies('held');
    o.fire('2026-10-23T11:30:00Z');
    expect(o.book.kept?.runs).toMatchObject([{ outcome: 'held' }]);
    expect(o.heard).toMatchObject([{ outcome: 'held' }]);
  });

  it('drops a schedule whose lead is gone, and one that’s finished', () => {
    const o = aboard();
    o.sched.add(LEAD, { what: 'gone', cron: '0 * * * *' });
    o.sched.add(LEAD, { what: 'once', at: '2026-10-23T13:30' });
    o.replies('gone');
    o.fire('2026-10-23T12:00:00Z');
    expect(o.sched.of(LEAD.leadId).map((s) => s.what)).toEqual(['once']);
    o.replies('sent');
    o.fire('2026-10-23T12:30:00Z');
    expect(o.sched.of(LEAD.leadId)).toEqual([]);
    expect(o.alarm()).toBeUndefined();
  });

  it('keeps each lead to their own schedules, and no more than ten', () => {
    const o = aboard();
    for (let i = 0; i < 10; i++) o.sched.add(LEAD, { what: `${i}`, cron: '0 9 * * *' });
    expect(() => o.sched.add(LEAD, { what: 'one more', cron: '0 9 * * *' })).toThrow('10 schedules already');
    expect(o.sched.remove('someone-else', 'sch-1')).toBe(false);
    expect(o.sched.remove(LEAD.leadId, 'sch-1')).toBe(true);
    expect(o.sched.add(LEAD, { what: 'new', cron: '0 9 * * *' }).id).toBe('sch-11');
  });
});
