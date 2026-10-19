import { describe, expect, it } from 'vitest';
import { heldFile, keepsState, percent, raised, ratchetVerdict, reachDrift, reachMessage, reachTable, rulesMode } from './rulesCoverage';

describe('which files keep state', () => {
  it('is those that write to disk, rename into place, fsync, or write a journal or the ledger', () => {
    for (const line of ['fs.writeFileSync(file, text)', 'await appendFile(log, line)', 'renameSync(tmp, file)', 'fsyncSync(fd)', 'this.store.journal(id, fact)', 'store.record(entry)']) {
      expect(keepsState(`const a = 1;\n${line};`)).toBe(true);
    }
  });

  it('is not one that only reads, or names a write without making it', () => {
    expect(keepsState('readFileSync(file); const writeFileSyncCount = 0;')).toBe(false);
  });

  it('leaves out tests, scripts and the demo’s stand-ins', () => {
    expect(['server/store.ts', 'plugins/retro/engineer.ts'].every(heldFile)).toBe(true);
    expect(['server/store.test.ts', 'plugins/climber/scripts/climbReplay.ts', 'server/agents/demoRunner.ts', 'server/github/demo.ts'].some(heldFile)).toBe(false);
  });
});

describe('the rules’ reach, held against its baseline', () => {
  it('counts whole percent, rounded down', () => {
    expect([percent(199, 200), percent(1, 3), percent(0, 0)]).toEqual([99, 33, 0]);
  });

  it('holds when every file is where its baseline is', () => {
    expect(reachMessage(reachDrift({ 'a.ts': 40, 'b.ts': 0 }, { 'a.ts': 40, 'b.ts': 0 }))).toBeUndefined();
  });

  it('fails a file the rules reach less of, naming it', () => {
    const drift = reachDrift({ 'a.ts': 40 }, { 'a.ts': 38 });
    expect(drift.down).toEqual([{ file: 'a.ts', baseline: 40, now: 38 }]);
    expect(reachMessage(drift)).toContain('a.ts: 38%, baseline 40%');
  });

  it('fails a new file that keeps state and that no description reaches, but not one that’s reached', () => {
    const drift = reachDrift({}, { 'new.ts': 0, 'described.ts': 12 });
    expect(drift.unheld).toEqual(['new.ts']);
    expect(drift.up).toEqual([{ file: 'described.ts', baseline: undefined, now: 12 }]);
  });

  it('asks for the baseline to be raised when the rules reach more, so the gain can’t be spent again', () => {
    expect(reachMessage(reachDrift({ 'a.ts': 40 }, { 'a.ts': 55 }))).toContain('pnpm run rules --raise');
  });

  it('raises a baseline, never lowers one, and forgets files that no longer keep state', () => {
    expect(raised({ 'a.ts': 40, 'b.ts': 30, 'gone.ts': 10 }, { 'a.ts': 55, 'b.ts': 20, 'c.ts': 5 })).toEqual({ 'a.ts': 55, 'b.ts': 30, 'c.ts': 5 });
  });

  // otherwise `--raise` would wave through the very file the ratchet is there to send back
  it('never takes in a new file no description reaches, so raising can’t skip describing it', () => {
    const baseline = raised({ 'old.ts': 0 }, { 'old.ts': 0, 'new.ts': 0 });
    expect(baseline).toEqual({ 'old.ts': 0 });
    expect(ratchetVerdict(baseline, { 'old.ts': 0, 'new.ts': 0 })).toMatchObject({ holds: false, text: expect.stringContaining('new.ts') });
  });

  it('holds, saying how many files keep state, when nothing drifted', () => {
    expect(ratchetVerdict({ 'a.ts': 40 }, { 'a.ts': 40 })).toEqual({ holds: true, text: 'Ratchet holds: 1 files keep state, none reached less than its baseline.' });
  });
});

describe('pnpm run rules', () => {
  it('reports, holds the ratchet, or raises the baseline', () => {
    expect([rulesMode([]), rulesMode(['--ratchet']), rulesMode(['--raise']), rulesMode(['--ratchet', '--raise'])]).toEqual(['report', 'ratchet', 'raise', 'raise']);
  });

  it('lists each file with its reach, lined up', () => {
    expect(reachTable({ 'server/store.ts': 43, 'a.ts': 0 })).toBe('  server/store.ts   43%\n  a.ts               0%');
  });
});
