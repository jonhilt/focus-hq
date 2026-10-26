import { describe, expect, it } from 'vitest';
import { heldFile, keepsState, lowered, percent, ratchetVerdict, reachDrift, reachMessage, reachTable, rulesMode } from './reachRules';

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
  const at = (total: number, covered: number) => ({ total, covered });

  it('counts whole percent, rounded down', () => {
    expect([percent(199, 200), percent(1, 3), percent(0, 0)]).toEqual([99, 33, 0]);
  });

  it('holds when every file leaves as many lines unreached as its baseline', () => {
    expect(reachMessage(reachDrift({ 'a.ts': 60, 'b.ts': 10 }, { 'a.ts': at(100, 40), 'b.ts': at(10, 0) }))).toBeUndefined();
  });

  it('fails a file with more lines the rules don’t reach, naming it', () => {
    const drift = reachDrift({ 'a.ts': 60 }, { 'a.ts': at(105, 40) });
    expect(drift.down).toEqual([{ file: 'a.ts', baseline: 60, now: 65 }]);
    expect(reachMessage(drift)).toContain('a.ts: 65 lines unreached, baseline 60');
  });

  // the reason it counts lines, not a share: a decision moved to a *Rules.ts file takes reached lines with it
  it('holds when reached lines leave the file, though the share it reaches drops', () => {
    expect(percent(132, 186)).toBeLessThan(percent(142, 199));
    expect(reachDrift({ 'store.ts': 57 }, { 'store.ts': at(186, 132) })).toEqual({ down: [], unheld: [], up: [{ file: 'store.ts', baseline: 57, now: 54 }] });
  });

  it('fails a new file that keeps state and that no description reaches, but not one that’s reached', () => {
    const drift = reachDrift({}, { 'new.ts': at(30, 0), 'described.ts': at(30, 12) });
    expect(drift.unheld).toEqual(['new.ts']);
    expect(drift.up).toEqual([{ file: 'described.ts', baseline: undefined, now: 18 }]);
  });

  it('asks for the baseline to be lowered when the rules reach more, so the gain can’t be spent again', () => {
    expect(reachMessage(reachDrift({ 'a.ts': 60 }, { 'a.ts': at(100, 55) }))).toContain('pnpm run rules --lower');
  });

  it('lowers a baseline, never raises one, and forgets files that no longer keep state', () => {
    expect(lowered({ 'a.ts': 60, 'b.ts': 30, 'gone.ts': 10 }, { 'a.ts': at(100, 55), 'b.ts': at(50, 10), 'c.ts': at(20, 5) })).toEqual({ 'a.ts': 45, 'b.ts': 30, 'c.ts': 15 });
  });

  // otherwise `--lower` would wave through the very file the ratchet is there to send back
  it('never takes in a new file no description reaches, so lowering can’t skip describing it', () => {
    const baseline = lowered({ 'old.ts': 10 }, { 'old.ts': at(10, 0), 'new.ts': at(8, 0) });
    expect(baseline).toEqual({ 'old.ts': 10 });
    expect(ratchetVerdict(baseline, { 'old.ts': at(10, 0), 'new.ts': at(8, 0) })).toMatchObject({ holds: false, text: expect.stringContaining('new.ts') });
  });

  it('holds, saying how many files keep state, when nothing drifted', () => {
    expect(ratchetVerdict({ 'a.ts': 60 }, { 'a.ts': at(100, 40) })).toEqual({ holds: true, text: 'Ratchet holds: 1 files keep state, none with more lines unreached than its baseline.' });
  });
});

describe('pnpm run rules', () => {
  it('reports, holds the ratchet, or lowers the baseline', () => {
    expect([rulesMode([]), rulesMode(['--ratchet']), rulesMode(['--lower']), rulesMode(['--ratchet', '--lower'])]).toEqual(['report', 'ratchet', 'lower', 'lower']);
  });

  it('lists each file with its reach and the lines it leaves, lined up', () => {
    expect(reachTable({ 'server/store.ts': { total: 200, covered: 86 }, 'a.ts': { total: 7, covered: 0 } })).toBe('  server/store.ts   43%   114 unreached\n  a.ts               0%     7 unreached');
  });
});
