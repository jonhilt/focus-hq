import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ledgerLine } from '../shared/ledger';
import { LedgerLog } from './ledgerLog';

let dir: string;
let file: string;
const entry = (pr: number) => ({ kind: 'conflicts' as const, repo: 'o/r', pr, resolved: 'office' as const, at: pr, projectId: 'p' });
const lines = () => fs.readFileSync(file, 'utf8').trimEnd().split('\n');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  file = path.join(dir, 'ledger.jsonl');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('LedgerLog', () => {
  it('numbers each line on disk, and carries on from the last one next time', () => {
    const first = LedgerLog.open(file);
    expect(first.log.append(entry(1)).seq).toBe(1);
    first.log.append(entry(2));
    fs.rmSync(`${file}.lock`);
    const again = LedgerLog.open(file);
    expect(again.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(again.log.append(entry(3)).seq).toBe(3);
    expect(lines().map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([1, 2, 3]);
    expect(again.health).toEqual({ repaired: [], problems: [], notes: [] });
  });

  it('cuts off a last line written only in part', () => {
    fs.writeFileSync(file, ledgerLine({ ...entry(1), seq: 1 }) + '{"v":2,"seq":2,"at');
    const { log, health } = LedgerLog.open(file);
    expect(health.repaired).toEqual(['Dropped a last line cut short when Focus stopped']);
    log.append(entry(2));
    expect(lines()).toHaveLength(2);
  });

  it('rewrites the first format numbered, keeping the old file', () => {
    fs.writeFileSync(file, `${JSON.stringify(entry(1))}\n${JSON.stringify(entry(2))}\n`);
    const { log, health } = LedgerLog.open(file);
    expect(health.repaired[0]).toMatch(/^Rewrote 2 lines in the numbered format/);
    expect(log.append(entry(3)).seq).toBe(3);
    expect(lines().every((l) => l.startsWith('{"v":2,'))).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('ledger.jsonl.v1-'))).toBe(true);
  });

  it('copies a damaged ledger aside, says what’s wrong, and keeps going', () => {
    fs.writeFileSync(file, ledgerLine({ ...entry(1), seq: 1 }) + ledgerLine({ ...entry(3), seq: 3 }));
    const { log, health, events } = LedgerLog.open(file);
    expect(health.problems[0]).toMatch(/^line 2 is missing \(the ledger as it was is in .*damaged-/);
    expect(events).toHaveLength(2);
    expect(log.append(entry(4)).seq).toBe(4);
  });

  it('keeps one copy of the same damage, however often Focus starts', () => {
    fs.writeFileSync(file, ledgerLine({ ...entry(1), seq: 1 }) + ledgerLine({ ...entry(3), seq: 3 }));
    const copies = () => fs.readdirSync(dir).filter((f) => f.includes('.damaged-'));
    LedgerLog.open(file);
    fs.rmSync(`${file}.lock`);
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, before.split('\n').slice(0, 2).join('\n') + '\n');
    const again = LedgerLog.open(file);
    expect(copies()).toHaveLength(1);
    expect(again.health.problems[0]).toContain(copies()[0]);
  });

  it('doesn’t write while another Focus holds the lock', () => {
    fs.writeFileSync(`${file}.lock`, String(process.ppid));
    const { log, health } = LedgerLog.open(file);
    expect(health.problems).toEqual([]);
    expect(health.notes[0]).toMatch(/^another running Focus \(pid \d+\) is writing it/);
    expect(log.append(entry(1)).seq).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('takes over a lock left by a process that’s gone', () => {
    fs.writeFileSync(`${file}.lock`, '999999');
    const { log, health } = LedgerLog.open(file);
    expect(health.problems).toEqual([]);
    log.append(entry(1));
    expect(lines()).toHaveLength(1);
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe(String(process.pid));
  });
});
