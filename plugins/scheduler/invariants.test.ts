import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAtOnce, checkRestart, type Running, type Subject } from '../../plugin-api/testing';
import { Book, type Kept } from './book';
import { Scheduler } from './scheduler';

// The scheduler's book (plugins/scheduler/book.ts) under Focus's two rules (docs/invariants.md): a restart ends as if
// an action had never started, or had finished, and two at once as one after the other would. Its promises are its
// README's. It waits on nothing outside: a lead's message is handed over at once (`host.goals.message` answers then),
// and each change is written whole and flushed before it's done, so a restart only ever falls between actions.

/** What survives: each schedule's last claimed slot, the runs as the book has them, and what the leads heard (out in the world). */
interface Durable {
  schedules: { id: string; lastSlot?: number }[];
  runs: string[];
  heard: string[];
}

type Keeper = (dir: string) => { read(): Kept; write(kept: Kept): void };

const LEAD = { leadId: 'lead-1', projectId: 'p', leadName: 'Novak' };
const MINUTE = 60_000;

function schedulerSubject(keep: Keeper): Subject<Durable> {
  return {
    name: 'scheduler',
    start: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-'));
      // the world outside Focus: the clock, and what the leads have heard, carry on through a restart
      const world = { clock: Date.parse('2026-10-23T11:00:00Z'), heard: [] as string[] };
      const life = (): Running<Durable> => {
        const sched = new Scheduler({
          book: keep(dir),
          now: () => world.clock,
          tz: 'Europe/London',
          deliver: (s) => {
            world.heard.push(`${s.id}@${new Date(s.lastSlot ?? 0).toISOString()}`);
            return 'sent';
          },
          heard: () => undefined,
          publish: () => undefined,
          wake: () => () => undefined,
        });
        sched.start();
        const pass = (ms: number) => {
          world.clock += ms;
          sched.tick();
        };
        return {
          actions: () => [
            { name: 'schedule every ten minutes', run: () => sched.add(LEAD, { what: 'look', cron: '*/10 * * * *' }) },
            { name: 'schedule once, in a quarter of an hour', run: () => sched.add(LEAD, { what: 'once', at: new Date(world.clock + 15 * MINUTE).toISOString() }) },
            { name: 'unschedule the first', run: () => sched.remove(LEAD.leadId, sched.of(LEAD.leadId)[0]?.id ?? 'none') },
            { name: 'six minutes pass', run: () => pass(6 * MINUTE) },
            { name: 'an hour passes', run: () => pass(60 * MINUTE) },
          ],
          durable: () => ({
            schedules: sched.of(LEAD.leadId).map((s) => ({ id: s.id, ...(s.lastSlot !== undefined && { lastSlot: s.lastSlot }) })),
            runs: sched.runs().map((r) => `${r.scheduleId}@${r.slot}:${r.outcome}`),
            heard: [...world.heard],
          }),
          settle: () => Promise.resolve(),
          restart: () => {
            sched.stop();
            return life();
          },
          close: () => sched.stop(),
        };
      };
      return life();
    },
  };
}

const scheduler = schedulerSubject((dir) => new Book(dir));

describe('the scheduler’s book, under Focus’s two rules', () => {
  it('ends a restart as if an action had never started, or had finished', async () => {
    await checkRestart(scheduler, { runs: 30 });
  }, 30_000);

  it('ends two actions at once as one after the other would', async () => {
    await checkAtOnce(scheduler, { runs: 30 });
  }, 30_000);

  // README: "A schedule holds through Focus restarting, and each slot wakes the lead once"
  it('wakes the lead once a slot, a restart straight after it included', async () => {
    const r = await scheduler.start((_l, work) => work());
    const take = (name: string) => r.actions().find((a) => a.name === name)?.run();
    take('schedule every ten minutes');
    take('six minutes pass');
    take('six minutes pass');
    const again = await r.restart((_l, work) => work());
    expect(again.durable().heard).toEqual(['sch-1@2026-10-23T11:10:00.000Z']);
    again.close?.();
  });

  // README: "What fell due while Focus was down: the latest slot runs once, marked late, and those before it are missed"
  it('runs the latest slot once as it starts again after being down, and reports the others missed', async () => {
    const r = await scheduler.start((_l, work) => work());
    const take = (name: string) => r.actions().find((a) => a.name === name)?.run();
    take('schedule every ten minutes');
    take('six minutes pass');
    take('an hour passes');
    const slot = (hhmm: string) => Date.parse(`2026-10-23T${hhmm}:00Z`);
    expect(r.durable().runs).toEqual([
      ...['11:10', '11:20', '11:30', '11:40', '11:50'].map((t) => `sch-1@${slot(t)}:missed`),
      `sch-1@${slot('12:00')}:late`,
    ]);
    expect(r.durable().heard).toEqual(['sch-1@2026-10-23T12:00:00.000Z']);
    r.close?.();
  });

  it('reaches a schedule claimed, run late, and finished', async () => {
    const r = await scheduler.start((_l, work) => work());
    const take = (name: string) => r.actions().find((a) => a.name === name)?.run();
    take('schedule once, in a quarter of an hour');
    take('an hour passes');
    expect(r.durable()).toMatchObject({ schedules: [], runs: [expect.stringMatching(/^sch-1@\d+:late$/)] });
    r.close?.();
  });

  it('reaches a damaged book, kept aside, and starts again empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-'));
    fs.writeFileSync(path.join(dir, 'schedules.json'), '{"made": 2, "sched');
    const book = new Book(dir);
    expect(book.read()).toEqual({ made: 0, schedules: [], runs: [] });
    expect(book.setAside && fs.readFileSync(book.setAside, 'utf8')).toBe('{"made": 2, "sched');
  });

  it('catches a break: a book kept in memory, never written', async () => {
    const forgetful: Keeper = () => {
      let held: Kept = { made: 0, schedules: [], runs: [] };
      return { read: () => held, write: (k) => void (held = k) };
    };
    await expect(checkRestart(schedulerSubject(forgetful), { runs: 30 })).rejects.toThrow('restarted during');
  }, 30_000);
});
