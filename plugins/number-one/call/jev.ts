import { Context, Data, Effect, Layer, Schema } from 'effect';

// Jev, TypeSafe's "System One" model: given some state and a few typed questions, it answers each in one pass with a
// calibrated probability rather than text, fast (70-500 ms). The call asks it what the captain wants.

export const JEV_URL = process.env.FOCUS_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = process.env.FOCUS_JEV_MODEL || 'jev-latest';
const TIMEOUT_MS = 5_000;

/** A question for Jev: yes or no (`noul`, a probability of yes), or one of a few named options (`choice`). */
export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

const Answer = Schema.Struct({
  type: Schema.optional(Schema.String),
  noul: Schema.optional(Schema.Number),
  choice: Schema.optional(Schema.String),
  probabilities: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  confidence: Schema.optional(Schema.Number),
});
export type JevAnswer = typeof Answer.Type;
export type JevAnswers = Readonly<Record<string, JevAnswer>>;

const Reply = Schema.Struct({ answers: Schema.Record(Schema.String, Answer) });
const decodeReply = Schema.decodeUnknownEffect(Reply);

export class JevFailed extends Data.TaggedError('JevFailed')<{ status: number; body: string }> {
  override get message() {
    const why = this.status === 401 ? 'the TypeSafe API key was refused' : this.status === 429 || this.status === 529 ? 'it is busy' : `HTTP ${this.status}`;
    return `Jev couldn't answer: ${why}${this.body ? ` (${this.body.slice(0, 200)})` : ''}`;
  }
}

export class JevUnreachable extends Data.TaggedError('JevUnreachable')<{ reason: string }> {
  override get message() {
    return `Jev couldn't be reached: ${this.reason}`;
  }
}

export class JevTimedOut extends Data.TaggedError('JevTimedOut') {
  override get message() {
    return `Jev didn't answer within ${TIMEOUT_MS / 1000}s`;
  }
}

export class JevBadReply extends Data.TaggedError('JevBadReply')<{ reason: string }> {
  override get message() {
    return `Jev's reply couldn't be read: ${this.reason}`;
  }
}

export type JevError = JevFailed | JevUnreachable | JevTimedOut | JevBadReply;

/** Asks Jev the questions about `state`; the answers come back under the questions' keys. */
export class Jev extends Context.Service<Jev, {
  ask(state: string, questions: Record<string, JevQuestion>): Effect.Effect<JevAnswers, JevError>;
}>()('focus/call/Jev') {
  static layer(key: string, url = JEV_URL): Layer.Layer<Jev> {
    return Layer.succeed(Jev, Jev.of({
      ask: (state, questions) =>
        Effect.gen(function* () {
          const res = yield* Effect.tryPromise({
            try: (signal) =>
              fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: JEV_MODEL, state, questions }),
                signal,
              }),
            catch: (err) => new JevUnreachable({ reason: err instanceof Error ? err.message : String(err) }),
          });
          const body = yield* Effect.tryPromise({ try: () => res.text(), catch: () => new JevUnreachable({ reason: 'the reply was cut off' }) });
          if (!res.ok) return yield* new JevFailed({ status: res.status, body });
          const json = yield* Effect.try({ try: (): unknown => JSON.parse(body), catch: () => new JevBadReply({ reason: 'not JSON' }) });
          const reply = yield* decodeReply(json).pipe(Effect.mapError((e) => new JevBadReply({ reason: e.message })));
          return reply.answers;
        }).pipe(Effect.timeoutOrElse({ duration: TIMEOUT_MS, orElse: () => Effect.fail(new JevTimedOut()) })),
    }));
  }
}
