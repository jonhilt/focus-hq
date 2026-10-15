import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { checkoutHead, measureNewCommit, readScorecard, SavedScorecards, ScorecardDesk, SHOWN, type ScorecardSource } from './desk';
import type { Scorecard, Scorecards } from './types';

// checkoutHead's test runs real git: a budget fit for a busy machine
vi.setConfig({ testTimeout: 30_000 });

const card = (at: number): Scorecard => ({
  v: 1, at, commit: `c${at}`, branch: 'main', dirty: false, notes: [], frictions: [{ key: 'shell: exit 1', sessions: 3 }],
  metrics: [{ section: 'fence', key: 'fence.nonNull', label: 'Non-null', value: at, better: 'lower', format: 'count' }],
});

describe('readScorecard', () => {
  it('reads a saved scorecard back as it was', () => {
    expect(readScorecard(JSON.stringify(card(5)))).toEqual(card(5));
  });

  it('turns away a file cut short, or one in a format it doesn\'t know', () => {
    expect(readScorecard(JSON.stringify(card(5)).slice(0, 40))).toBeUndefined();
    expect(readScorecard(JSON.stringify({ ...card(5), v: 2 }))).toBeUndefined();
    expect(readScorecard(JSON.stringify({ ...card(5), metrics: [{ ...card(5).metrics[0], format: 'furlongs' }] }))).toBeUndefined();
  });
});

describe('SavedScorecards', () => {
  it('reads the latest few, oldest first, skipping files that aren\'t scorecards', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-scorecards-'));
    for (let i = 1; i <= SHOWN + 2; i++) fs.writeFileSync(path.join(dir, `2026-10-${String(i).padStart(2, '0')}.json`), JSON.stringify(card(i)));
    fs.writeFileSync(path.join(dir, '2026-10-99.json'), '{"v":1');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a scorecard');
    const history = new SavedScorecards(dir, dir).history(SHOWN);
    expect(history.map((c) => c.at)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('has none before the first is saved', () => {
    expect(new SavedScorecards(path.join(os.tmpdir(), 'focus-no-such-folder'), '.').history(SHOWN)).toEqual([]);
  });
});

function desk(measure: () => Promise<void>) {
  const cards = [card(1)];
  const sent: Scorecards[] = [];
  const source: ScorecardSource = { history: () => [...cards], noise: () => undefined, measure: () => measure().then(() => void cards.push(card(2))) };
  return { desk: new ScorecardDesk((s) => sent.push(s), source), sent };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ScorecardDesk', () => {
  it('starts with the saved history, and adds the new one once it\'s measured', async () => {
    const { desk: d, sent } = desk(() => Promise.resolve());
    expect(d.current()).toMatchObject({ status: 'idle', history: [card(1)] });
    expect(d.measure().status).toBe('measuring');
    await settle();
    expect(d.current()).toMatchObject({ status: 'idle', history: [card(1), card(2)] });
    expect(sent.map((s) => s.status)).toEqual(['measuring', 'idle']);
  });

  it('measures one at a time', () => {
    const { desk: d } = desk(() => new Promise(() => undefined));
    d.measure();
    expect(() => d.measure()).toThrow(/already/);
  });

  it('says why a measurement failed and keeps the history it had', async () => {
    const { desk: d } = desk(() => Promise.reject(new Error('pnpm: not found')));
    d.measure();
    await settle();
    expect(d.current()).toMatchObject({ status: 'failed', error: 'pnpm: not found', history: [card(1)] });
    expect(d.measure().status).toBe('measuring');
  });
});

describe('measureNewCommit', () => {
  it('measures a clean commit with no scorecard yet, the first one included', () => {
    expect(measureNewCommit([card(1)], { commit: 'c2', dirty: false })).toBe(true);
    expect(measureNewCommit([], { commit: 'c2', dirty: false })).toBe(true);
  });

  it('leaves a commit it measured already, and uncommitted work, alone', () => {
    expect(measureNewCommit([card(1), card(2)], { commit: 'c2', dirty: false })).toBe(false);
    expect(measureNewCommit([card(1)], { commit: 'c2', dirty: true })).toBe(false);
  });
});

describe('ScorecardDesk.measureIfNew', () => {
  it('measures the commit the office started on once, saying why', async () => {
    const { desk: d, sent } = desk(() => Promise.resolve());
    d.measureIfNew({ commit: 'c2', dirty: false });
    expect(d.current()).toMatchObject({ status: 'measuring', trigger: 'new-commit' });
    await settle();
    // card(2) is the one it measured, at commit c2
    d.measureIfNew({ commit: 'c2', dirty: false });
    expect(d.current().status).toBe('idle');
    expect(sent).toHaveLength(2);
  });
});

describe('checkoutHead', () => {
  it('calls a checkout dirty for a change to a tracked file, not for an untracked one like an editor’s folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-head-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir });
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'one');
    git('add', '.');
    git('commit', '-qm', 'one');
    fs.mkdirSync(path.join(dir, '.idea'));
    fs.writeFileSync(path.join(dir, '.idea', 'workspace.xml'), '<x/>');
    expect((await checkoutHead(dir)).dirty).toBe(false);
    fs.writeFileSync(path.join(dir, 'a.ts'), 'two');
    expect((await checkoutHead(dir)).dirty).toBe(true);
  });
});

describe('SavedScorecards.noise', () => {
  it('reads the latest noise floor saved by --repeat, and skips a file that isn’t one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-noise-'));
    const saved = new SavedScorecards(dir, dir);
    expect(saved.noise()).toBeUndefined();
    fs.mkdirSync(path.join(dir, 'noise'));
    const noise = { v: 1, at: 5, commit: 'abc', runs: 5, spread: { 'gate.seconds': { min: 60, max: 70 } } };
    fs.writeFileSync(path.join(dir, 'noise', '2026-01-01-abc.json'), JSON.stringify(noise));
    expect(saved.noise()).toEqual(noise);
    fs.writeFileSync(path.join(dir, 'noise', '2026-01-02-def.json'), '{"v":1,"at":');
    expect(saved.noise()).toBeUndefined();
  });
});
