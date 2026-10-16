import fs from 'node:fs';
import path from 'node:path';
import { journalLine, readJournal } from './agents/runJournal';

// Append-only journals of one kind (agents' runs, QA reviews, leads' slices), a file each in one folder: each fact is
// numbered, written and flushed to disk (fsync) before `append` returns, and never rewritten. What a journal adds up to
// is kept in memory, folded from its file the first time it's asked for, dropping a last line Focus stopped part way
// through writing. Without saving to disk (the demo) each journal keeps its last `memory` facts in memory instead.

/** How a fact is stamped in its journal: its number from 1, and when (`t`). */
export type Stamped<F> = F & { v: 1; seq: number; t: number };

export class Journals<F extends { kind: string }, S extends { seq: number }> {
  private states = new Map<string, S>();
  private kept = new Map<string, Stamped<F>[]>();

  constructor(
    private readonly persist: boolean,
    /** Where the journals are: their folder, and each one's file name (without `.jsonl`) by its key, and back. */
    private readonly folder: { dir: string; name: (key: string) => string; key: (name: string) => string },
    /** A journal with nothing in it. */
    private readonly empty: S,
    /** What a journal adds up to with one more fact. */
    private readonly evolve: (state: S, entry: Stamped<F>) => S,
    private readonly memory = 2000,
  ) {}

  /** Records `fact` in the journal, on disk before this returns, and what it adds up to with it. */
  append(key: string, fact: F): S {
    const before = this.state(key);
    const entry = { v: 1, seq: before.seq + 1, t: Date.now(), ...fact } as Stamped<F>;
    if (this.persist) appendFlushed(this.file(key), journalLine(entry));
    else this.keep(key, entry);
    const after = this.evolve(before, entry);
    this.states.set(key, after);
    return after;
  }

  /** What the journal adds up to. */
  state(key: string): S {
    let state = this.states.get(key);
    if (!state) {
      state = this.persist ? this.read(key, true).reduce(this.evolve, this.empty) : this.empty;
      this.states.set(key, state);
    }
    return state;
  }

  /** The journal, oldest first. */
  entries(key: string): Stamped<F>[] {
    return this.persist ? this.read(key, false) : [...(this.kept.get(key) ?? [])];
  }

  /** The journals written to since `since`: by their files' times, or their last fact's when kept in memory. */
  written(since: number): string[] {
    if (!this.persist) return [...this.kept].filter(([, kept]) => (kept.at(-1)?.t ?? 0) > since).map(([key]) => key);
    let names: string[];
    try {
      names = fs.readdirSync(this.folder.dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return [];
    }
    return names.filter((f) => fs.statSync(path.join(this.folder.dir, f)).mtimeMs > since).map((f) => this.folder.key(f.slice(0, -'.jsonl'.length)));
  }

  private file(key: string): string {
    return path.join(this.folder.dir, `${this.folder.name(key)}.jsonl`);
  }

  private keep(key: string, entry: Stamped<F>): void {
    const kept = this.kept.get(key) ?? [];
    kept.push(entry);
    if (kept.length > this.memory) kept.splice(0, kept.length - this.memory);
    this.kept.set(key, kept);
  }

  /** The journal's entries from its file (none without one). `repair` cuts off a last line Focus stopped part way through writing. */
  private read(key: string, repair: boolean): Stamped<F>[] {
    const file = this.file(key);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const { entries, goodBytes } = readJournal<Stamped<F>>(text);
    if (repair && goodBytes < Buffer.byteLength(text)) fs.truncateSync(file, goodBytes);
    return entries;
  }
}

/** Appends a journal's line to its file and flushes it to disk (fsync) before returning. */
function appendFlushed(file: string, line: string): void {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
