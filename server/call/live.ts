import { Context, Data, Effect, Layer, Option, Schema } from 'effect';
import { WebSocket } from 'ws';

// OpenAI's gpt-live-1: a full-duplex voice model that holds the conversation and hands work to a backend (here, the
// office: "client delegation"). The browser carries the audio over WebRTC; the office creates the session with the
// browser's offer and attaches a sideband WebSocket of its own to it, which hears what's said and when work is handed
// over, and sends back what the ship should say (docs/calls.md).

export const LIVE_URL = process.env.FOCUS_LIVE_URL || 'https://api.openai.com/v1/live/sessions';
export const LIVE_MODEL = process.env.FOCUS_LIVE_MODEL || 'gpt-live-1';
const VOICE = process.env.FOCUS_LIVE_VOICE || 'cedar';
const TIMEOUT_MS = 15_000;

/** The voice model's own instructions: who it is, and when to hand over to the office. Fixed for the session. */
export const LIVE_INSTRUCTIONS = `You are Number One, first officer of the starship Focus, on a voice call with the captain. The ship's crew are Claude Code agents working on the captain's software projects. Your backend, the office, knows how the ship stands and can act.

Hand over to the office whenever the captain asks about the ship, its projects, crew, goals or pull requests, or asks for anything to be done, and whenever they answer a question the office asked them. Hand over before answering: never guess how the ship stands, and never say something has been done until the office says so. While you wait, say a word or two at most.

Say what the office tells you in your own words: briefly, like a first officer, warm and crisp, without lists or symbols. When the office asks you to put a question to the captain, ask exactly that, and hand their answer over.

When the captain wants to talk something through (a goal, a requirement, how something on the ship is or isn't working), hand that over: the office briefs you on it from the ship's records. Then talk it through with them yourself, from the briefing, without handing each turn over: think with them, ask questions, suggest, push back. The briefing is the record of the work, not the code: when something isn't in it, say so rather than guess. Hand over again when they want something done, such as making it a goal or telling a goal's lead, or want the status or a different topic. When the office asks for the captain's words for a goal or a lead, hand over what they say next as they say it.

Without the office you can greet the captain, chat briefly, and say what you can do by voice: report how things stand, start the next queued goal, and talk a goal or a project through and turn it into a new goal or a word for its lead.`;

/** The events the office sends over the sideband. */
export type LiveClientEvent =
  | { type: 'session.commentary.append'; delegation_id: string | null; content: string }
  | { type: 'session.instructions.append'; delegation_id: string | null; content: string }
  | { type: 'session.thinking.append'; delegation_id: string | null; content: string }
  | { type: 'session.close' };

const LiveEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('session.started') }),
  Schema.Struct({ type: Schema.Literal('session.input_transcript.delta'), delta: Schema.String }),
  Schema.Struct({ type: Schema.Literal('session.output_transcript.delta'), delta: Schema.String }),
  Schema.Struct({ type: Schema.Literal('session.delegation.created'), delegation: Schema.Struct({ id: Schema.String, target: Schema.String }) }),
  Schema.Struct({ type: Schema.Literal('session.closed'), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal('error'), error: Schema.Struct({ message: Schema.String }) }),
]);
/** The events from the session the office acts on; the rest are ignored. */
export type LiveEvent = typeof LiveEventSchema.Type;
const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(LiveEventSchema));

/** A line of the server's JSON, or nothing when it's some other event or not one at all. */
export const readEvent = (data: string): LiveEvent | undefined => Option.getOrUndefined(decodeEvent(data));

const Created = Schema.Struct({ session: Schema.Struct({ id: Schema.String }), transport: Schema.Struct({ sdp: Schema.String }) });
const decodeCreated = Schema.decodeUnknownEffect(Schema.fromJsonString(Created));

/** OpenAI's own words for what went wrong, when the body has them. */
function openAiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // not JSON: the body as it is
  }
  return body.slice(0, 200);
}

export class LiveFailed extends Data.TaggedError('LiveFailed')<{ status: number; body: string }> {
  override get message() {
    const why = this.status === 401 ? 'the OpenAI API key was refused' : `HTTP ${this.status}`;
    const said = openAiMessage(this.body);
    return `The voice call couldn't start: ${why}${said ? ` (${said})` : ''}`;
  }
}

export class LiveUnreachable extends Data.TaggedError('LiveUnreachable')<{ reason: string }> {
  override get message() {
    return `OpenAI couldn't be reached: ${this.reason}`;
  }
}

export class LiveBadReply extends Data.TaggedError('LiveBadReply')<{ reason: string }> {
  override get message() {
    return `OpenAI's reply couldn't be read: ${this.reason}`;
  }
}

export type LiveError = LiveFailed | LiveUnreachable | LiveBadReply;

/** The office's line into a session: what it sends, and hanging up its end. */
export interface Sideband {
  send(event: LiveClientEvent): void;
  close(): void;
}

export interface SidebandListener {
  event(event: LiveEvent): void;
  /** The sideband closed, from either end. */
  closed(why?: string): void;
}

/** A session for the browser: its id, and the WebRTC answer to its offer (null in the demo, which has no audio). */
export interface LiveSession {
  id: string;
  sdp: string | null;
}

/** What the session starts with: the model, its instructions and voice, handing work to the office, and a browser that can only hang up. */
export function sessionConfig(sdp: string): Record<string, unknown> {
  return {
    session: {
      model: LIVE_MODEL,
      instructions: LIVE_INSTRUCTIONS,
      audio: { output: { voice: VOICE } },
      delegation: { type: 'client' },
      client: { data_channel: { allowed_client_events: ['session.close'], allowed_server_events: [{ type: 'session.started' }, { type: 'session.closed' }] } },
    },
    transport: { type: 'webrtc', sdp },
  };
}

export class Live extends Context.Service<Live, {
  /** Creates a session for the browser's WebRTC offer. */
  create(sdp: string): Effect.Effect<LiveSession, LiveError>;
  /** Attaches the office's sideband to a session, once it's open. */
  attach(id: string, listener: SidebandListener): Effect.Effect<Sideband, LiveError>;
}>()('focus/call/Live') {
  static layer(key: string, url = LIVE_URL): Layer.Layer<Live> {
    return Layer.succeed(Live, Live.of({
      create: (sdp) =>
        Effect.gen(function* () {
          const res = yield* Effect.tryPromise({
            try: (signal) =>
              fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sessionConfig(sdp)), signal }),
            catch: (err) => new LiveUnreachable({ reason: err instanceof Error ? err.message : String(err) }),
          });
          const body = yield* Effect.tryPromise({ try: () => res.text(), catch: () => new LiveUnreachable({ reason: 'the reply was cut off' }) });
          if (!res.ok) return yield* new LiveFailed({ status: res.status, body });
          const created = yield* decodeCreated(body).pipe(Effect.mapError((e) => new LiveBadReply({ reason: e.message })));
          return { id: created.session.id, sdp: created.transport.sdp };
        }).pipe(Effect.timeoutOrElse({ duration: TIMEOUT_MS, orElse: () => Effect.fail(new LiveUnreachable({ reason: `no answer within ${TIMEOUT_MS / 1000}s` })) })),
      attach: (id, listener) =>
        Effect.callback<Sideband, LiveError>((resume, signal) => {
          const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/${encodeURIComponent(id)}/attach`, { headers: { Authorization: `Bearer ${key}` } });
          let open = false;
          signal.addEventListener('abort', () => !open && ws.terminate());
          ws.on('unexpected-response', (_req, res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => resume(Effect.fail(new LiveFailed({ status: res.statusCode ?? 0, body }))));
          });
          ws.on('error', (err) => (open ? listener.closed(err.message) : resume(Effect.fail(new LiveUnreachable({ reason: err.message })))));
          ws.on('open', () => {
            open = true;
            resume(
              Effect.succeed({
                send: (event) => {
                  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
                },
                close: () => ws.close(),
              }),
            );
          });
          ws.on('message', (data: Buffer) => {
            const event = readEvent(data.toString());
            if (event) listener.event(event);
          });
          ws.on('close', () => open && listener.closed());
        }).pipe(Effect.timeoutOrElse({ duration: TIMEOUT_MS, orElse: () => Effect.fail(new LiveUnreachable({ reason: `the sideband didn't open within ${TIMEOUT_MS / 1000}s` })) })),
    }));
  }
}
