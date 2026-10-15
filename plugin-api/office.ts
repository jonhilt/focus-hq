// The office on this machine, for a plugin's scripts, which run in the terminal without a host (its server part has
// `host.ledger()` and `host.transcript()`): its ledger, its agents' transcripts and its clones of the projects' repos.
import fs from 'node:fs';
import { paths } from '../server/config';
import { transcriptReader } from '../server/agents/transcript';
import { mirrorDir } from '../server/agents/workspace';
import { checkLedger, type LedgerEvent } from '../shared/ledger';

/** The office's ledger on this machine: where it is, and what's in it (none when there's no ledger there yet). */
export function officeLedger(file = paths.ledger): { file: string; events?: LedgerEvent[] } {
  return { file, events: fs.existsSync(file) ? checkLedger(fs.readFileSync(file, 'utf8')).events : undefined };
}

/** An office agent's Claude Code transcript (its JSONL) by session id: undefined when it isn't on this machine. */
export const officeTranscript = transcriptReader(paths.transcripts, paths.workspaces);

/** Where the office keeps its clone of `repo` on this machine (there only once an agent has worked in it). */
export const officeMirror = (repo: string): string => mirrorDir(repo);
