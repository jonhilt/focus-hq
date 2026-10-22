// Focus on this machine, for a plugin's scripts, which run in the terminal without a host (its server part has
// `host.ledger()` and `host.transcript()`): its ledger, its agents' run journals and transcripts, its saved state and
// its clones of the projects' repos. Read only.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../server/config';
import { type JournalEntry, readJournal } from '../server/agents/runJournal';
import { transcriptReader } from '../server/agents/transcript';
import { mirrorDir } from '../server/agents/workspace';
import { checkLedger, type LedgerEvent } from '../shared/ledger';

/** Focus's ledger on this machine: where it is, and what's in it (none when there's no ledger there yet). */
export function focusLedger(file = paths.ledger): { file: string; events?: LedgerEvent[] } {
  return { file, events: fs.existsSync(file) ? checkLedger(fs.readFileSync(file, 'utf8')).events : undefined };
}

/** A Focus agent's Claude Code transcript (its JSONL) by session id: undefined when it isn't on this machine. */
export const focusTranscript = transcriptReader(paths.transcripts, paths.workspaces);

/** Where Focus keeps its clone of `repo` on this machine (there only once an agent has worked in it). */
export const focusMirror = (repo: string): string => mirrorDir(repo);

/** The run journals of Focus's agents on this machine whose id is `wanted`, each read: its facts, oldest first. */
export function focusRunJournals(wanted: (agentId: string) => boolean = () => true): { agentId: string; entries: JournalEntry[] }[] {
  if (!fs.existsSync(paths.runs)) return [];
  return fs.readdirSync(paths.runs).flatMap((file) => {
    const agentId = /^(.+)\.jsonl$/.exec(file)?.[1];
    if (agentId === undefined || !wanted(agentId)) return [];
    return [{ agentId, entries: readJournal(fs.readFileSync(path.join(paths.runs, file), 'utf8')).entries }];
  });
}

/** Focus's saved state on this machine (`state.json`) as it's written, unchecked: nothing when it's missing or mid-write. */
export function focusSavedState(): unknown {
  try {
    return JSON.parse(fs.readFileSync(paths.state, 'utf8'));
  } catch {
    return undefined;
  }
}
