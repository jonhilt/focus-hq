// The ship's log, for a plugin's scripts (its server part reads it through `host.ledger()`): read as the office reads it.
import fs from 'node:fs';
import { paths } from '../server/config';
import { checkLedger, type LedgerEvent } from '../shared/ledger';

/** The office's ledger on this machine: where it is, and what's in it (none when there's no ledger there yet). */
export function officeLedger(file = paths.ledger): { file: string; events?: LedgerEvent[] } {
  return { file, events: fs.existsSync(file) ? checkLedger(fs.readFileSync(file, 'utf8')).events : undefined };
}
