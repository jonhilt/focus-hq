import { describe, expect, it } from 'vitest';
import { due, finished, LATE_MS, moment, nextSlot, runMessage, scheduleTimes, slotsDue } from './rules';
import type { Schedule } from './shared';

const TZ = 'Europe/London';
const at = (iso: string) => Date.parse(iso);

/** The Jev rollout watch: 09:07, 15:07 and 21:07 London time until the end of the 26th, made on the 23rd at noon. */
const watch = (lastSlot?: number): Schedule => ({
  id: 'sch-1', leadId: 'lead-1', projectId: 'p', leadName: 'Novak', what: 'Check the rollout.',
  cron: '7 9,15,21 * * *', until: moment('2026-10-26', TZ, true), tz: TZ, createdAt: at('2026-10-23T11:00:00Z'),
  ...(lastSlot !== undefined && { lastSlot }),
});

describe('the scheduler’s rules', () => {
  it('keeps local times across the clocks going back on the 25th, and stops after the 26th', () => {
    const slots: number[] = [];
    for (let t = nextSlot(watch(), at('2026-10-23T11:00:00Z')); t !== null; t = nextSlot(watch(), t)) slots.push(t);
    expect(slots.map((t) => new Date(t).toISOString())).toEqual([
      '2026-10-23T14:07:00.000Z', '2026-10-23T20:07:00.000Z',
      '2026-10-24T08:07:00.000Z', '2026-10-24T14:07:00.000Z', '2026-10-24T20:07:00.000Z',
      '2026-10-25T09:07:00.000Z', '2026-10-25T15:07:00.000Z', '2026-10-25T21:07:00.000Z',
      '2026-10-26T09:07:00.000Z', '2026-10-26T15:07:00.000Z', '2026-10-26T21:07:00.000Z',
    ]);
  });

  it('runs a slot on time once it falls due, and nothing before', () => {
    expect(due(watch(), at('2026-10-23T14:06:59Z'))).toBeNull();
    expect(due(watch(), at('2026-10-23T14:07:00.004Z'))).toEqual({ run: at('2026-10-23T14:07:00Z'), late: false, missed: [] });
  });

  it('never runs a slot it has claimed again', () => {
    expect(due(watch(at('2026-10-23T14:07:00Z')), at('2026-10-23T14:07:30Z'))).toBeNull();
  });

  // the captain's call: the latest slot runs once, marked late; those before it are reported missed, not run
  it('after Focus was down overnight, runs the latest slot once, late, and reports the others missed', () => {
    const d = due(watch(at('2026-10-23T14:07:00Z')), at('2026-10-24T11:00:00Z'));
    expect(d).toEqual({ run: at('2026-10-24T08:07:00Z'), late: true, missed: [at('2026-10-23T20:07:00Z')] });
    expect(runMessage(watch(), d!, at('2026-10-24T11:00:00Z'))).toBe(
      'Your schedule sch-1 was due at 09:07; it\'s running 2 h 53 min late, because Focus was down or the machine asleep. Missed and not run: Fri 23 Oct 21:07.\n\nCheck the rollout.');
  });

  it('calls a run late only past the grace', () => {
    expect(due(watch(), at('2026-10-23T14:07:00Z') + LATE_MS)?.late).toBe(false);
    expect(due(watch(), at('2026-10-23T14:07:00Z') + LATE_MS + 1)?.late).toBe(true);
  });

  it('runs a one-off once, and is finished after', () => {
    const once: Schedule = { ...watch(), cron: undefined, until: undefined, at: at('2026-10-23T13:00:00Z') };
    expect(slotsDue(once, at('2026-10-23T12:59:00Z'))).toEqual([]);
    expect(slotsDue(once, at('2026-10-23T13:00:00Z'))).toEqual([at('2026-10-23T13:00:00Z')]);
    expect(finished(once, at('2026-10-23T13:00:00Z'))).toBe(false);
    expect(finished({ ...once, lastSlot: once.at }, at('2026-10-23T13:00:01Z'))).toBe(true);
  });

  it('finishes a watch once its last slot is claimed', () => {
    expect(finished(watch(at('2026-10-26T15:07:00Z')), at('2026-10-26T16:00:00Z'))).toBe(false);
    expect(finished(watch(at('2026-10-26T21:07:00Z')), at('2026-10-26T21:08:00Z'))).toBe(true);
  });

  it('reads what a lead asks for, in their time zone', () => {
    const now = at('2026-10-23T11:00:00Z');
    expect(scheduleTimes({ what: 'x', cron: '7 9,15,21 * * *', until: '2026-10-26' }, now, TZ)).toEqual({ cron: '7 9,15,21 * * *', tz: TZ, until: at('2026-10-26T23:59:59Z') });
    expect(scheduleTimes({ what: 'x', at: '2026-10-23T15:30' }, now, TZ)).toEqual({ at: at('2026-10-23T14:30:00Z'), tz: TZ });
    expect(scheduleTimes({ what: 'x', at: '2026-10-23T15:30', timezone: 'UTC' }, now, TZ)).toEqual({ at: at('2026-10-23T15:30:00Z'), tz: 'UTC' });
  });

  it('refuses what it can’t keep, saying why', () => {
    const now = at('2026-10-23T11:00:00Z');
    expect(() => scheduleTimes({ what: 'x' }, now, TZ)).toThrow('either `cron`');
    expect(() => scheduleTimes({ what: 'x', cron: '0 9 * * *', at: '2026-10-24T09:00' }, now, TZ)).toThrow('either `cron`');
    expect(() => scheduleTimes({ what: ' ', cron: '0 9 * * *' }, now, TZ)).toThrow('what to do');
    expect(() => scheduleTimes({ what: 'x', cron: 'every morning' }, now, TZ)).toThrow('five-part cron');
    expect(() => scheduleTimes({ what: 'x', cron: '* * * * *' }, now, TZ)).toThrow('every 5 minutes');
    expect(() => scheduleTimes({ what: 'x', at: '2026-10-23T09:00' }, now, TZ)).toThrow('passed already');
    expect(() => scheduleTimes({ what: 'x', cron: '0 9 * * *', until: '2026-10-22' }, now, TZ)).toThrow('never comes round');
    expect(() => scheduleTimes({ what: 'x', cron: '0 9 * * *', timezone: 'Mars/Olympus' }, now, TZ)).toThrow('isn’t a time zone');
    expect(() => scheduleTimes({ what: 'x', at: 'tomorrow' }, now, TZ)).toThrow('isn’t a time I can read');
  });
});
