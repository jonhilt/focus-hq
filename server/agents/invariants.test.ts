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

describe('the invariant harness', () => {
  it('passes a part that holds both rules', async () => {
    await checkRestart(toy({}));
    await checkAtOnce(toy({}));
  });

  it('catches a restart that leaves a half-done mark behind', async () => {
    await expect(checkRestart(toy({ leavesMark: true }))).rejects.toThrow(/restarted during "file (a|b)"/);
  });

  it('catches two at once doing what one after the other would refuse', async () => {
    await expect(checkAtOnce(toy({ raceable: true }))).rejects.toThrow(/"file (a|b)" and "file (a|b)" at once/);
  });
});
