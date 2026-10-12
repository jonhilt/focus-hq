import type { Effort, Settings, StudioSession, StudioTake } from '../../shared/types';
import type { Hub } from '../hub';
import { freshStudio, type Store, type StoredStudio } from '../store';
import { errorMessage, truncate } from '../util';
import { applyRetime, applyTake, applyVideo, type RetimeInput, type TakeInput, type VideoInput, videoReply } from './studio';

// The studio holodeck's computer: the captain's conversation with a Claude session of its own (not a goal's lead) about
// a video, and the tools it builds with, the video (premise, beats, threads) and takes on the holodeck's floor. One
// conversation, one turn at a time, each resuming the same session, so it survives a restart. Number One's chat is the
// pattern (numberOne.ts).

/** The computer's tools, as its session calls them: each says what happened, in words, or throws why it didn't. */
export interface StudioTools {
  video(input: VideoInput): string;
  /** Stages a take, and waits a moment for the room to say whether it runs. */
  take(input: TakeInput): Promise<string>;
  /** Retimes a take without touching its script, and waits as take does. */
  retime(input: RetimeInput): Promise<string>;
  dropTake(id: string): string;
}

export interface StudioTurn {
  messages: StudioSession['messages'];
  video: StudioSession['video'];
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

/** How long a staged take waits for the room to run it before saying no one's watching. */
const REPORT_WAIT_MS = 5000;

const publicView = ({ sessionId: _, ...session }: StoredStudio): StudioSession => session;
const key = (id: string, version: number) => `${id}@${version}`;

export class StudioComputer {
  private running: AbortController | null = null;
  /** Takes staged and waiting to hear from the room, by id@version. */
  private readonly waiting = new Map<string, (error: string | undefined) => void>();

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

  /** Clears the studio for a new video (stopping the computer mid-thought if need be): the next message starts a fresh session. */
  newVideo(): StudioSession {
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

  /** The room ran a take (or tried to): `error` is what went wrong, if anything. */
  report(id: string, version: number, error?: string): StudioSession {
    const take = this.store.studio.takes.find((t) => t.id === id && t.version === version);
    if (take && (take.error ?? '') !== (error ?? '')) {
      take.error = error ? truncate(error, 400) : undefined;
      this.changed();
    }
    this.waiting.get(key(id, version))?.(error);
    return this.current();
  }

  private changed(): void {
    this.store.save();
    this.hub.send({ type: 'studio', session: this.current() });
  }

  private tools(session: StoredStudio, current: () => boolean): StudioTools {
    const live = () => {
      if (!current()) throw new Error('The studio was cleared for a new video');
    };
    return {
      video: (input) => {
        live();
        const next = applyVideo(session.video, input, Date.now());
        if ('error' in next) throw new Error(next.error);
        const reply = videoReply(session.video, next);
        session.video = next;
        this.changed();
        return reply;
      },
      take: (input) => {
        live();
        return this.stage(session, input.id, applyTake(session.takes, input, session.video?.beats.length ?? 0, Date.now()));
      },
      retime: async (input) => {
        live();
        const said = await this.stage(session, input.id, applyRetime(session.takes, input, Date.now()));
        const take = session.takes.find((t) => t.id === input.id.trim().toLowerCase());
        return `${said} It runs ${take?.seconds}s${take?.phases ? `, phases ${JSON.stringify(take.phases)}` : ''}.`;
      },
      dropTake: (id) => {
        live();
        const found = session.takes.find((t) => t.id === id.trim().toLowerCase());
        if (!found) throw new Error(`There's no take ${id}. On the floor: ${session.takes.map((t) => t.id).join(', ') || 'none'}.`);
        session.takes = session.takes.filter((t) => t !== found);
        this.changed();
        return `Take ${found.id} is off the floor.`;
      },
    };
  }

  /** Puts the takes on the floor after staging (or retiming) take `id`, and says how it ran in the room. */
  private async stage(session: StoredStudio, id: string, next: StudioTake[] | { error: string }): Promise<string> {
    if ('error' in next) throw new Error(next.error);
    session.takes = next;
    const take = next.find((t) => t.id === id.trim().toLowerCase())!;
    const heard = this.heard(take);
    this.changed();
    const error = await heard;
    if (error === null) return `Take ${take.id} (version ${take.version}) is on the holodeck floor, but no one's in the studio to run it yet: it'll play when the captain walks in.`;
    if (error) return `Take ${take.id} (version ${take.version}) is on the floor, but it failed in the room: ${error}. Fix the script and stage it again under the same id.`;
    return `Take ${take.id} (version ${take.version}) is playing on the holodeck floor.`;
  }

  /** What the room says about a take once it's run it: an error, nothing (it ran), or null if no one ran it in time. */
  private heard(take: StudioTake): Promise<string | undefined | null> {
    const k = key(take.id, take.version);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(k);
        resolve(null);
      }, this.reportWaitMs);
      this.waiting.set(k, (error) => {
        clearTimeout(timer);
        this.waiting.delete(k);
        resolve(error);
      });
    });
  }

  /** Runs the computer's turn in the background; a turn superseded by a new video drops its reply. */
  private run(session: StoredStudio): void {
    const abort = new AbortController();
    this.running = abort;
    const current = () => this.store.studio === session && this.running === abort;
    void this.officer
      .turn(
        { messages: [...session.messages], video: session.video, resumeSessionId: session.sessionId, settings: this.store.settings, model: session.model, effort: session.effort, signal: abort.signal, tools: this.tools(session, current) },
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
