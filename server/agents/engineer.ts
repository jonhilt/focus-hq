import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chiefEngineer } from '../../shared/crew';
import { frictionGroups, type LedgerEntry, type LedgerEvent, knownSignatures, unreadDigests } from '../../shared/ledger';
import type { Retro, RetroDraft, Settings } from '../../shared/types';
import type { Hub } from '../hub';
import { freshRetro, type Store } from '../store';
import { errorMessage, newId, sleep, truncate } from '../util';
import { batchesOf, extractionInput, parseRead, readerPrompt } from './frictions';
import { parseDrafts, PATTERN_SESSIONS, renderFrictions, renderGoals, renderLedger, type SessionKind } from './retro';

/** One session's transcript, as the office found it. */
export interface Transcript {
  /** What its digest is called: unique, and readable in a citation. */
  name: string;
  kind: SessionKind;
  sessionId: string;
  /** Its JSONL: read one at a time, since a long session's runs to tens of MB. */
  read(): Promise<string>;
}

export interface RetroRequest {
  /** The folder the office gathered the evidence in: the engineer's current directory. */
  cwd: string;
  days: number;
  /** Friction groups seen in enough sessions to draft from. */
  groups: number;
  settings: Settings;
  signal: AbortSignal;
}

/**
 * Reads the evidence and comes back with findings: `read` finds the frictions in a batch of sessions' spans (frictions.ts),
 * `retro` drafts from the ones that keep coming back. The live one is a read-only Claude Code session; the demo's is
 * scripted.
 */
export interface RetroOfficer {
  read(req: { prompt: string; settings: Settings; signal: AbortSignal }): Promise<{ structured: unknown; costUsd?: number }>;
  retro(req: RetroRequest, activity: (text: string) => void): Promise<{ structured: unknown; text: string; costUsd?: number }>;
}

const DAY = 24 * 60 * 60 * 1000;

/** What reading a session for frictions costs, as the bake-off of 9 Oct measured it (Opus, ~100 sessions a batch). */
export const READ_COST_PER_SESSION = 0.025;

/** Where the engineer's reading and the office meet: the transcripts, and the ledger it writes what it found to. */
export interface RetroSources {
  readTranscript: (sessionId: string) => Promise<string | undefined>;
  record: (projectId: string, entry: LedgerEntry, at?: number) => void;
  /** A breather between batches, so a retro doesn't take all of the office's Claude usage at once. */
  pauseMs: number;
}

/**
 * The chief engineer at the engineering station: on the captain's word, looks back over the ledger's session digests
 * and drafts issues for the frictions that keep coming back. First they read the spans no one has read yet (their
 * trimmed text, a batch at a time, with a pause between), finding and quoting the frictions and reusing the signatures
 * already in the ledger, which goes down as `session-frictions` so no span is read twice. Code then groups the
 * frictions by kind and signature and keeps those in three or more sessions; the office writes them, the ledger and closed goals into a folder of its
 * own; the engineer reads only that, drafts, and changes nothing. The captain accepts (it's filed) or rejects each
 * draft. One retro at a time; the latest is kept in state.json, and each one's folder (with retro.json) under
 * data/retros.
 */
export class ChiefEngineer {
  private running: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly officer: RetroOfficer,
    private readonly retrosDir: string,
    private readonly sources: RetroSources,
  ) {}

  /** What starting a retro over the last `days` would read, and roughly what it would cost to. */
  preview(days: number): { unread: number; costUsd: number } {
    const unread = unreadDigests(this.store.ledger, Date.now(), days).length;
    return { unread, costUsd: unread * READ_COST_PER_SESSION };
  }

  current(): Retro {
    return this.store.retro;
  }

  start(days: number): Retro {
    if (this.running) throw new Error(`${chiefEngineer().name} is already on a retro`);
    const window = Math.max(1, Math.min(60, Math.round(days) || 14));
    this.store.retro = { ...freshRetro(), status: 'gathering', activity: 'Finding the sessions to read', days: window, startedAt: Date.now() };
    this.changed();
    const abort = new AbortController();
    this.running = abort;
    void this.run(window, abort).finally(() => {
      if (this.running === abort) this.running = null;
    });
    return this.current();
  }

  stop(): Retro {
    this.running?.abort();
    this.running = null;
    const retro = this.store.retro;
    if (retro.status === 'gathering' || retro.status === 'thinking') this.store.retro = { ...retro, status: 'failed', activity: 'Stopped', error: 'Stopped by the captain', finishedAt: Date.now() };
    this.changed();
    return this.current();
  }

  private async run(days: number, abort: AbortController): Promise<void> {
    const current = () => this.running === abort && !abort.signal.aborted;
    const update = (patch: Partial<Retro>) => {
      if (!current()) return;
      this.store.retro = { ...this.store.retro, ...patch };
      this.changed();
    };
    try {
      const now = Date.now();
      const readCost = await this.readUnread(days, now, abort, update);
      if (!current()) return;
      const all = frictionGroups(this.store.ledger, now, days);
      const groups = all.filter((g) => g.sessions >= PATTERN_SESSIONS);
      const sessions = this.store.ledger.filter((e) => e.kind === 'session-digest' && e.at > now - days * DAY).length;
      const watch = all.filter((g) => g.sessions === PATTERN_SESSIONS - 1).map((g) => `${g.key} (${g.sessions} sessions)`);
      if (!groups.length) {
        update({ status: 'done', activity: 'Nothing keeps coming back', sessions, watch, costUsd: readCost, summary: sessions ? `No friction came up in ${PATTERN_SESSIONS} or more of the ${sessions} sessions digested in the last ${days} days.` : `No sessions were digested in the last ${days} days.`, finishedAt: Date.now() });
        return;
      }
      const dir = path.join(this.retrosDir, new Date(now).toISOString().replace(/[:.]/g, '-'));
      await fsp.mkdir(dir, { recursive: true });
      const goals = this.store.projects.flatMap((p) => (p.goals ?? []).map((g) => ({ ...g, project: p.name })));
      await fsp.writeFile(path.join(dir, 'frictions.md'), renderFrictions(groups, days));
      await fsp.writeFile(path.join(dir, 'ledger.md'), renderLedger(this.store.ledger, now, days));
      await fsp.writeFile(path.join(dir, 'goals.md'), renderGoals(goals, now, days));
      if (!current()) return;
      update({ status: 'thinking', activity: `Drafting from ${groups.length} frictions`, sessions, watch });
      const result = await this.officer.retro({ cwd: dir, days, groups: groups.length, settings: this.store.settings, signal: abort.signal }, (text) => {
        if (text) update({ activity: truncate(text, 120) });
      });
      if (!current()) return;
      const found = parseDrafts(result.structured, groups, () => newId('draft'));
      if (!found) throw new Error('Finished without drafts');
      update({ status: 'done', activity: found.drafts.length === 1 ? 'A draft for you' : `${found.drafts.length} drafts for you`, ...found, costUsd: readCost + (result.costUsd ?? 0), finishedAt: Date.now() });
      fs.writeFileSync(path.join(dir, 'retro.json'), JSON.stringify(this.store.retro, null, 2));
    } catch (err) {
      update({ status: 'failed', activity: 'Couldn’t finish the retro', error: errorMessage(err), finishedAt: Date.now() });
    }
  }

  /**
   * Reads the window's spans no one has read yet, a batch at a time with a pause between, and writes what was found in
   * each (none included) to the ledger, so no span is read twice. Returns what the reading cost.
   */
  private async readUnread(days: number, now: number, abort: AbortController, update: (patch: Partial<Retro>) => void): Promise<number> {
    const unread = unreadDigests(this.store.ledger, now, days);
    if (!unread.length) return 0;
    update({ activity: `Gathering ${unread.length} sessions to read` });
    const spans: { label: string; input: string; digest: Extract<LedgerEvent, { kind: 'session-digest' }> }[] = [];
    for (const d of unread) {
      if (abort.signal.aborted) return 0;
      const text = await this.sources.readTranscript(d.sessionId);
      if (!text) {
        this.sources.record(d.projectId, { kind: 'session-frictions', key: d.key, sessionId: d.sessionId, frictions: [], reader: 'none', missing: true }, d.at);
        continue;
      }
      const prLines = this.store.ledger.filter((e) => 'repo' in e && 'pr' in e && d.prs.some((p) => p.repo === e.repo && p.pr === e.pr));
      spans.push({ label: `S${spans.length + 1}`, input: extractionInput(text, d.afterUuid, prLines, d.toUuid), digest: d });
    }
    let cost = 0;
    const batches = batchesOf(spans);
    for (const [i, batch] of batches.entries()) {
      if (abort.signal.aborted) return cost;
      if (i) {
        update({ activity: `Pausing between batches (${i} of ${batches.length} read)` });
        await sleep(this.sources.pauseMs);
      }
      update({ activity: `Reading ${batch.length} sessions (batch ${i + 1} of ${batches.length})` });
      const result = await this.officer.read({ prompt: readerPrompt(batch, knownSignatures(this.store.ledger)), settings: this.store.settings, signal: abort.signal });
      if (abort.signal.aborted) return cost;
      cost += result.costUsd ?? 0;
      const found = parseRead(result.structured, batch);
      for (const s of batch) {
        const d = s.digest;
        this.sources.record(d.projectId, { kind: 'session-frictions', key: d.key, sessionId: d.sessionId, frictions: found.get(s.label) ?? [], reader: 'retro' }, d.at);
      }
    }
    return cost;
  }

  /** Notes the captain's decision on a draft (the office files an accepted one and writes the ledger). */
  decided(id: string, decision: NonNullable<RetroDraft['decision']>): RetroDraft {
    const draft = this.store.retro.drafts.find((d) => d.id === id);
    if (!draft) throw new Error('That draft isn’t in the latest retro');
    if (draft.decision) throw new Error(`That draft was already ${draft.decision.accepted ? 'accepted' : 'rejected'}`);
    const done = { ...draft, decision };
    this.store.retro = { ...this.store.retro, drafts: this.store.retro.drafts.map((d) => (d.id === id ? done : d)) };
    this.changed();
    return done;
  }

  private changed(): void {
    this.store.save();
    this.hub.send({ type: 'retro', retro: this.current() });
  }
}

/**
 * Claude Code keeps each session's transcript under <projects>/<its cwd, with every character but letters and digits
 * turned into ->/<session id>.jsonl. The office's agents all work under data/workspaces, so theirs are the folders
 * that start with that path's name; the kind of agent is the next word (agent_…, lead_…, qa_…).
 */
export function transcriptFolders(projectsDir: string, workspacesDir: string): (since: number) => Promise<Transcript[]> {
  const prefix = `${workspacesDir.replace(/[^A-Za-z0-9]/g, '-')}-`;
  return async (since) => {
    const folders = await fsp.readdir(projectsDir).catch(() => [] as string[]);
    const found: Transcript[] = [];
    for (const folder of folders.filter((f) => f.startsWith(prefix))) {
      const rest = folder.slice(prefix.length);
      const kind = (['lead', 'qa', 'agent'] as const).find((k) => rest.startsWith(`${k}-`));
      if (!kind) continue;
      const dir = path.join(projectsDir, folder);
      for (const file of (await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl'))) {
        const full = path.join(dir, file);
        const stat = await fsp.stat(full).catch(() => undefined);
        if (!stat || stat.mtimeMs < since) continue;
        const sessionId = file.slice(0, -'.jsonl'.length);
        found.push({ name: `${rest}__${sessionId.slice(0, 8)}`, kind, sessionId, read: () => fsp.readFile(full, 'utf8') });
      }
    }
    return found;
  };
}

/** Reads an agent session's transcript by its id, wherever under the agents' folders it is; undefined when it isn't on this machine (a cloud session's). */
export function transcriptReader(projectsDir: string, workspacesDir: string): (sessionId: string) => Promise<string | undefined> {
  const prefix = `${workspacesDir.replace(/[^A-Za-z0-9]/g, '-')}-`;
  const found = new Map<string, string>();
  return async (sessionId) => {
    let file = found.get(sessionId);
    if (!file) {
      const folders = (await fsp.readdir(projectsDir).catch(() => [] as string[])).filter((f) => f.startsWith(prefix));
      for (const folder of folders) {
        const candidate = path.join(projectsDir, folder, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) {
          file = candidate;
          found.set(sessionId, file);
          break;
        }
      }
    }
    return file ? fsp.readFile(file, 'utf8').catch(() => undefined) : undefined;
  };
}
