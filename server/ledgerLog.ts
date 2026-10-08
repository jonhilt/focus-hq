import fs from 'node:fs';
import path from 'node:path';
import { checkLedger, type LedgerEntry, type LedgerEvent, ledgerLine } from '../shared/ledger';

/** What opening the ledger found and did: shown on the report card, so damage never goes unnoticed. */
export interface LedgerHealth {
  /** Repairs that went as expected: a line cut short dropped, the first format rewritten in this one. */
  repaired: string[];
  /** Damage that needs a look: where the file was copied aside, and what's wrong. */
  problems: string[];
  /** Not damage, but worth knowing: another office holds the lock, so this one isn't writing. */
  notes: string[];
}

/**
 * The ledger's one writer: appends each event as a numbered line and flushes it to disk (fsync) before carrying on, so
 * a line the office has acted on is a line that's kept. A lock file next to it keeps a second office on the same data
 * folder from writing too: that one reads the ledger but keeps its new lines to itself, and says so.
 */
export class LedgerLog {
  private constructor(
    private readonly fd: number | null,
    private next: number,
  ) {}

  static open(file: string): { log: LedgerLog; events: LedgerEvent[]; health: LedgerHealth } {
    const health: LedgerHealth = { repaired: [], problems: [], notes: [] };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const check = checkLedger(text);
    const holder = lock(`${file}.lock`);
    if (holder) {
      health.notes.push(`another Focus office (pid ${holder}) is writing it, so this one isn’t`);
      return { log: new LedgerLog(null, check.nextSeq), events: check.events, health };
    }
    if (check.problems.length) {
      // the same damage found again on the next start keeps the copy made the first time
      const copy = sameCopy(file, text) ?? `${file}.damaged-${stamp}`;
      if (!fs.existsSync(copy)) fs.copyFileSync(file, copy);
      health.problems.push(`${check.problems.join('; ')} (the ledger as it was is in ${copy})`);
    }
    if (check.migrated) {
      fs.copyFileSync(file, `${file}.v1-${stamp}`);
      writeWhole(file, check.events.map(ledgerLine).join(''));
      health.repaired.push(`Rewrote ${check.events.length} lines in the numbered format (the old file is in ${file}.v1-${stamp})`);
    } else if (check.tornTail) {
      fs.truncateSync(file, check.goodBytes);
      health.repaired.push('Dropped a last line cut short when Focus stopped');
    } else if (text && !text.endsWith('\n')) {
      fs.appendFileSync(file, '\n');
    }
    const fd = fs.openSync(file, 'a');
    fs.fsyncSync(fd);
    return { log: new LedgerLog(fd, check.nextSeq), events: check.events, health };
  }

  /** Numbers the event, writes it and flushes it to disk. */
  append(entry: LedgerEntry & { at: number; projectId: string }): LedgerEvent {
    const event = { ...entry, seq: this.next++ };
    if (this.fd !== null) {
      fs.writeSync(this.fd, ledgerLine(event));
      fs.fsyncSync(this.fd);
    }
    return event;
  }
}

/** A copy of the damaged ledger made on an earlier start, if one holds exactly this text. */
function sameCopy(file: string, text: string): string | undefined {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.damaged-`;
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .map((f) => path.join(dir, f))
    .find((f) => fs.statSync(f).size === Buffer.byteLength(text) && fs.readFileSync(f, 'utf8') === text);
}

/** Writes a whole file so a crash leaves the old one or the new one, never half of each. */
function writeWhole(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, content);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
}

/** Takes the lock, or says which live process holds it. A lock left by a process that's gone is taken over. */
function lock(path: string): number | undefined {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(path, String(process.pid), { flag: 'wx' });
      process.once('exit', () => fs.rmSync(path, { force: true }));
      return undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number(fs.readFileSync(path, 'utf8'));
      if (pid && pid !== process.pid && alive(pid)) return pid;
      fs.rmSync(path, { force: true });
    }
  }
  return undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
