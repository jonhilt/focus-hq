import type { Effort, Settings, StudioSession, StudioTake } from '../../shared/types';
import type { Hub } from '../hub';
import { freshStudio, type Store, type StoredStudio } from '../store';
import { errorMessage, truncate } from '../util';
import { applyRetime, applyTake, type RetimeInput, type TakeInput } from './studio';

// The studio holodeck's computer: the captain's conversation with a Claude session of its own (not a goal's lead), and
// the tools it builds with: scenes (takes, in the code) that stand in the middle of the hall. One conversation, one turn
// at a time, each resuming the same session, so it survives a restart. Number One's chat is the pattern (numberOne.ts).

/** What staging a scene says back: how it ran in the room, and the room's contact sheet of it, if it made one. */
export interface Staged {
  text: string;
  /** A JPEG of the scene at a few moments, from round where the captain stands, base64 (no data: prefix). */
  sheet?: string;
}

/** The computer's tools, as its session calls them: each says what happened, in words, or throws why it didn't. */
export interface StudioTools {
  /** Stages a scene, and waits a moment for the room to say whether it runs, and to send its contact sheet. */
  take(input: TakeInput): Promise<Staged>;
  /** Retimes a scene without touching its script, and waits as take does. */
  retime(input: RetimeInput): Promise<Staged>;
  dropTake(id: string): string;
}

/** What the room says about a take it's run: what went wrong, if anything, and its contact sheet. */
export interface RoomReport {
  error?: string;
  sheet?: string;
}

export interface StudioTurn {
  messages: StudioSession['messages'];
  /** The scenes it's built, for a session that starts afresh. */
  takes: StudioTake[];
  /** The session so far; missing on the first turn of a conversation. */
  resumeSessionId?: string;
  settings: Settings;
  /** The captain's picks for it: missing, the office's model and the model's default effort. */
  model?: string;
  effort?: Effort;
  signal: AbortSignal;
  tools: StudioTools;
}

export interface StudioReply {
  text: string;
  sessionId?: string;
  costUsd?: number;
  /** The model it ran on. */
  model?: string;
}

/** Takes one turn of the conversation. The live one resumes a Claude Code session; the demo one is scripted. */
export interface StudioOfficer {
  turn(req: StudioTurn, activity: (text: string) => void): Promise<StudioReply>;
}

/** How long a staged scene waits for the room to run it, and draw its contact sheet, before saying no one's watching. */
const REPORT_WAIT_MS = 8000;
/** A contact sheet is a JPEG, base64, of at most this many characters (about 1.5 MB). */
const SHEET_MAX = 2_000_000;

/** A contact sheet as the room sent it (a JPEG data URL), as the computer's tool hands it on: base64, or nothing if it isn't one. */
export function sheetData(sheet: unknown): string | undefined {
  if (typeof sheet !== 'string' || sheet.length > SHEET_MAX) return undefined;
  const found = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/.exec(sheet);
  return found?.[1];
}

const publicView = ({ sessionId: _, ...session }: StoredStudio): StudioSession => session;
const key = (id: string, version: number) => `${id}@${version}`;

export class StudioComputer {
  private running: AbortController | null = null;
  /** Takes staged and waiting to hear from the room, by id@version. */
  private readonly waiting = new Map<string, (report: RoomReport) => void>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly officer: StudioOfficer,
    private readonly reportWaitMs = REPORT_WAIT_MS,
  ) {}

  current(): StudioSession {
    return publicView(this.store.studio);
  }

  say(text: string): StudioSession {
    const session = this.store.studio;
    if (session.status === 'thinking') throw new Error('The computer is still working on the last thing you said');
    if (!text.trim()) throw new Error('Say something first');
    session.messages.push({ from: 'captain', text: text.trim(), at: Date.now() });
    Object.assign(session, { status: 'thinking', activity: 'Thinking it over', error: undefined, updatedAt: Date.now() });
    this.changed();
    this.run(session);
    return publicView(session);
  }

  /** Clears the studio, its conversation and scenes (stopping the computer mid-thought if need be): the next message starts a fresh session. */
  startOver(): StudioSession {
    this.running?.abort();
    this.running = null;
    const { model, effort } = this.store.studio;
    this.store.studio = { ...freshStudio(), model, effort };
    this.changed();
    return this.current();
  }

  /** The model and effort the computer runs at, from its next turn (empty = the office's model, the model's default effort). */
  tune(model: string, effort: Effort | undefined): StudioSession {
    const session = this.store.studio;
    session.model = model.trim() || undefined;
    session.effort = effort;
    this.changed();
    return this.current();
  }

  /** The room ran a take (or tried to): `error` is what went wrong, if anything; `sheet` its contact sheet (sheetData). */
  report(id: string, version: number, error?: string, sheet?: string): StudioSession {
    const take = this.store.studio.takes.find((t) => t.id === id && t.version === version);
    if (take && (take.error ?? '') !== (error ?? '')) {
      take.error = error ? truncate(error, 400) : undefined;
      this.changed();
    }
    this.waiting.get(key(id, version))?.({ error, sheet });
    return this.current();
  }

  private changed(): void {
    this.store.save();
    this.hub.send({ type: 'studio', session: this.current() });
  }

  private tools(session: StoredStudio, current: () => boolean): StudioTools {
    const live = () => {
      if (!current()) throw new Error('The studio was cleared');
    };
    return {
      take: (input) => {
        live();
        return this.stage(session, input.id, applyTake(session.takes, input, Date.now()));
      },
      retime: async (input) => {
        live();
        const staged = await this.stage(session, input.id, applyRetime(session.takes, input, Date.now()));
        const take = session.takes.find((t) => t.id === input.id.trim().toLowerCase());
        return { ...staged, text: `${staged.text} It runs ${take?.seconds}s${take?.phases ? `, phases ${JSON.stringify(take.phases)}` : ''}.` };
      },
      dropTake: (id) => {
        live();
        const found = session.takes.find((t) => t.id === id.trim().toLowerCase());
        if (!found) throw new Error(`There's no scene ${id}. Kept: ${session.takes.map((t) => t.id).join(', ') || 'none'}.`);
        session.takes = session.takes.filter((t) => t !== found);
        this.changed();
        return `Scene ${found.id} is gone.`;
      },
    };
  }

  /** Keeps the scenes after staging (or retiming) scene `id`, which stands in the hall, and says how it ran there, with its contact sheet. */
  private async stage(session: StoredStudio, id: string, next: StudioTake[] | { error: string }): Promise<Staged> {
    if ('error' in next) throw new Error(next.error);
    session.takes = next;
    const take = next.find((t) => t.id === id.trim().toLowerCase());
    if (!take) throw new Error(`There's no scene ${id}`);
    const heard = this.heard(take);
    this.changed();
    const report = await heard;
    const name = `Scene ${take.id} (version ${take.version})`;
    if (!report) return { text: `${name} stands in the hall, but no one's in the studio to run it yet: it'll play when the captain walks in.` };
    if (report.error) return { text: `${name} stands in the hall, but it failed there: ${report.error}. Fix the script and stage it again under the same id.` };
    const sheet = sheetData(report.sheet);
    if (!sheet) return { text: `${name} is playing in the middle of the hall (the room sent no contact sheet this time).` };
    return { text: `${name} is playing in the middle of the hall. Here's its contact sheet, walking round it from where the captain stands, at the moments marked: look hard at it before you tell the captain it's ready.`, sheet };
  }

  /** What the room says about a scene once it's run it, or null if no one ran it in time. */
  private heard(take: StudioTake): Promise<RoomReport | null> {
    const k = key(take.id, take.version);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(k);
        resolve(null);
      }, this.reportWaitMs);
      this.waiting.set(k, (report) => {
        clearTimeout(timer);
        this.waiting.delete(k);
        resolve(report);
      });
    });
  }

  /** Runs the computer's turn in the background; a turn superseded by starting over drops its reply. */
  private run(session: StoredStudio): void {
    const abort = new AbortController();
    this.running = abort;
    const current = () => this.store.studio === session && this.running === abort;
    void this.officer
      .turn(
        { messages: [...session.messages], takes: [...session.takes], resumeSessionId: session.sessionId, settings: this.store.settings, model: session.model, effort: session.effort, signal: abort.signal, tools: this.tools(session, current) },
        (text) => {
          if (!current() || !text) return;
          session.activity = truncate(text, 120);
          this.hub.send({ type: 'studio', session: this.current() });
        },
      )
      .then((reply) => {
        if (!current()) return;
        session.messages.push({ from: 'computer', text: reply.text.trim() || '…', at: Date.now() });
        Object.assign(session, {
          sessionId: reply.sessionId ?? session.sessionId,
          costUsd: session.costUsd + (reply.costUsd ?? 0),
          ranOn: reply.model ?? session.ranOn,
          status: 'waiting',
          activity: 'Waiting for you',
          updatedAt: Date.now(),
        });
        this.changed();
      })
      .catch((err: unknown) => {
        if (!current()) return;
        Object.assign(session, { status: 'failed', activity: 'Lost the thread', error: errorMessage(err), updatedAt: Date.now() });
        this.changed();
      })
      .finally(() => {
        if (this.running === abort) this.running = null;
      });
  }
}
