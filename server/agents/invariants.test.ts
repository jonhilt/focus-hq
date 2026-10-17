import { describe, expect, it } from 'vitest';
import { checkAtOnce, checkRestart, type Later, type Running, type Subject } from './invariants';

// The harness itself, on a toy: a store that keeps a list of filed drafts on "disk", with an action that files one.
// Each flaw it should catch is planted on purpose, and the sound version has to pass.

interface Disk {
  filed: string[];
  filing?: string;
}

interface Flaws {
  /** Marks the draft as being filed on disk before the slow work, and never clears that mark on start. */
  leavesMark?: boolean;
  /** Checks "not filed yet" before the slow work and files after it, with nothing in between to stop a second. */
  raceable?: boolean;
}

function toy(flaws: Flaws): Subject<Disk> {
  const life = (disk: Disk, later: Later): Running<Disk> => {
    // a sound start forgets a mark left by an office that went down mid-filing
    if (!flaws.leavesMark) delete disk.filing;
    let busy = false;
    const file = async (draft: string) => {
      if (disk.filed.includes(draft)) throw new Error('filed already');
      if (!flaws.raceable) {
        if (busy) throw new Error('being filed already');
        busy = true;
      }
      if (flaws.leavesMark) disk.filing = draft;
      try {
        await later('github', () => Promise.resolve());
        if (!flaws.raceable && disk.filed.includes(draft)) throw new Error('filed already');
        disk.filed = [...disk.filed, draft];
      } finally {
        busy = false;
        if (flaws.leavesMark) delete disk.filing;
      }
    };
    return {
      actions: () => [{ name: 'file a', run: () => file('a') }, { name: 'file b', run: () => file('b') }],
      durable: () => structuredClone(disk),
      settle: () => Promise.resolve(),
      restart: (l) => life(disk, l),
    };
  };
  return { name: 'toy', start: (later) => life({ filed: [] }, later) };
}

// A second toy, for what a restart can lose without looking any different at the time: an outbox that keeps what it's
// asked to post and posts it to "GitHub", which outlives any office.

interface Outbox {
  /** How many it's been asked for: each request has an id of its own, as a comment can be posted twice on purpose. */
  asked: number;
  queue: string[];
  posting?: string;
  done: string[];
  /** On GitHub: how many times each went up. */
  posted: Record<string, number>;
}

interface OutboxFlaws {
  /** Keeps what it's asked to post in memory only, so a restart forgets it. */
  forgetsQueue?: boolean;
  /** Starting again, posts the one it was posting without looking whether it went up. */
  repostsBlind?: boolean;
}

function outbox(flaws: OutboxFlaws): Subject<Omit<Outbox, 'posting' | 'asked'>> {
  const github: Record<string, number> = {};
  const life = (disk: Omit<Outbox, 'posted'>, later: Later): Running<Omit<Outbox, 'posting' | 'asked'>> => {
    const queue = flaws.forgetsQueue ? [] : disk.queue;
    let busy: Promise<void> | undefined;
    const post = async (item: string) => {
      disk.posting = item;
      await later('github', () => Promise.resolve(void (github[item] = (github[item] ?? 0) + 1)));
      disk.done = [...disk.done, item];
      queue.splice(queue.indexOf(item), 1);
      delete disk.posting;
    };
    const ask = (what: string) => void queue.push(`${what}${(disk.asked += 1)}`);
    // a sound start finishes posting what it was posting, unless that very request went up already
    const posting = disk.posting;
    if (posting) {
      if (!flaws.repostsBlind && github[posting]) {
        disk.done = [...disk.done, posting];
        queue.splice(queue.indexOf(posting), 1);
        delete disk.posting;
      } else busy = post(posting).finally(() => (busy = undefined));
    }
    return {
      actions: () => [
        { name: 'ask for a', run: () => ask('a') },
        { name: 'ask for b', run: () => ask('b') },
        {
          name: 'post the next',
          run: () => {
            const next = queue[0];
            if (!next || busy) throw new Error('nothing to post');
            busy = post(next).finally(() => (busy = undefined));
            return busy;
          },
        },
      ],
      durable: () => ({ queue: [...(flaws.forgetsQueue ? [] : queue)], done: [...disk.done], posted: { ...github } }),
      settle: async () => {
        await busy;
      },
      restart: (l) => life(disk, l),
    };
  };
  return {
    name: 'outbox',
    start: (later) => {
      for (const k of Object.keys(github)) delete github[k];
      return life({ asked: 0, queue: [], done: [] }, later);
    },
  };
}

describe('the invariant harness', () => {
  it('passes a part that holds both rules', async () => {
    await checkRestart(toy({}), { runs: 120 });
    await checkAtOnce(toy({}), { runs: 120 });
  }, 60_000);

  it('catches a restart that leaves a half-done mark behind', async () => {
    await expect(checkRestart(toy({ leavesMark: true }), { runs: 120 })).rejects.toThrow(/restarted during "file (a|b)"/);
  }, 60_000);

  it('catches two at once doing what one after the other would refuse', async () => {
    await expect(checkAtOnce(toy({ raceable: true }), { runs: 120 })).rejects.toThrow(/"file (a|b)" and "file (a|b)" at once/);
  }, 60_000);

  // a request landing just as the office goes down is a rare draw: a toy is cheap, so it takes many
  it('passes an outbox that keeps its queue and looks before posting again', async () => {
    await checkRestart(outbox({}), { runs: 120 });
  }, 60_000);

  it('catches a restart that loses work, seen only in what should have followed', async () => {
    await expect(checkRestart(outbox({ forgetsQueue: true }), { runs: 120 })).rejects.toThrow(/then \[.*post the next/);
  }, 60_000);

  it('catches a restart that posts again what went up as the office went down', async () => {
    await expect(checkRestart(outbox({ repostsBlind: true }), { runs: 120 })).rejects.toThrow(/restarted during "post the next"/);
  }, 60_000);
});

