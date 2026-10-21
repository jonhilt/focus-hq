import { assign, enqueueActions, fromPromise, setup } from 'xstate';
import type { Topic } from './brief';
import { type Act, askFor, type CallScene, type Capture, type Routing } from './route';

// A call's rails: what the ship can do at each point of the conversation, and nothing else. gpt-live-1 decides when to
// hand the captain's words over (a delegation); the machine routes them (Jev, through `route`), briefs the voice model
// on a topic to talk through, waits for the captain's words for a new goal or a lead (`dictating`), asks before doing
// anything consequential, and does it only from `confirming`, on a yes `route` judged clear. Its actors and replies are
// provided by the call (calls.ts), so tests drive it with stand-ins (machine.test.ts).

/** How long after a delegation the machine waits for the end of what the captain said to come in. */
export const SETTLE_MS = 300;
/** How long an act waits for the captain's yes, or a capture for their words, before it's dropped. */
export const EXPIRY_MS = 60_000;

export interface CallContext {
  /** The captain's words since the last ones routed. */
  heard: string;
  /** What's being routed now. */
  request: string;
  /** The delegation being answered: replies go to it. */
  delegation: string | null;
  /** One that came in while the machine was busy, routed next. */
  deferred: string | null;
  /** The act waiting on the captain's yes. */
  pending: Act | null;
  /** What the call is talking through, once the voice model's been briefed on it. */
  topic: Topic | null;
  /** A new goal or a word for a lead, waiting on what the captain wants in it. */
  capture: Capture | null;
}

export type CallEvent = { type: 'heard'; text: string } | { type: 'delegated'; id: string } | { type: 'hang-up' };

export interface RouteInput {
  heard: string;
  scene: CallScene;
}

/** For the ship to say, in answer to a delegation (null: not tied to one); quiet ones are notes for the voice model. */
export interface Reply {
  delegation: string | null;
  text: string;
  quiet?: boolean;
}

const notProvided = (what: string) => () => Promise.reject(new Error(`The call's ${what} wasn't provided`));

/** The scene `route` decides in, from the context: only what's set. */
const scene = (c: CallContext): CallScene => ({ ...(c.pending && { pending: c.pending }), ...(c.topic && { topic: c.topic }), ...(c.capture && { capture: c.capture }) });

const routed = (kind: Routing['kind']) => ({ event }: { event: { output: Routing } }) => event.output.kind === kind;

export const callMachine = setup({
  types: {
    context: {} as CallContext,
    events: {} as CallEvent,
  },
  actors: {
    route: fromPromise<Routing, RouteInput>(notProvided('router')),
    /** What the captain said yes to: routing only says go while something is pending, so it's never null in practice. */
    act: fromPromise<string, Act | null>(notProvided('act')),
  },
  actions: {
    /** Something for the ship to say. */
    reply: (_, _reply: Reply) => undefined,
    /** Standing instructions for the voice model, not said aloud. */
    instruct: (_, _text: string) => undefined,
    /** Background for the voice model to talk from, not said aloud: a piece of a briefing. */
    inform: (_, _text: string) => undefined,
  },
  guards: {
    deferred: ({ context }) => context.deferred !== null,
  },
  delays: { settle: SETTLE_MS, expiry: EXPIRY_MS },
}).createMachine({
  id: 'call',
  context: { heard: '', request: '', delegation: null, deferred: null, pending: null, topic: null, capture: null },
  initial: 'listening',
  on: {
    // transcript fragments carry their own spacing: appended as they come
    heard: { actions: assign({ heard: ({ context, event }) => context.heard + event.text }) },
    // while busy: routed once the machine's free
    delegated: { actions: assign({ deferred: ({ event }) => event.id }) },
    'hang-up': '.ended',
  },
  states: {
    listening: {
      always: { guard: 'deferred', target: 'routing', actions: assign({ delegation: ({ context }) => context.deferred, deferred: null }) },
      on: { delegated: { target: 'routing', actions: assign({ delegation: ({ event }) => event.id }) } },
    },
    routing: {
      initial: 'settling',
      states: {
        settling: { after: { settle: 'asking' } },
        asking: {
          entry: assign({ request: ({ context }) => context.heard.replace(/\s+/g, ' ').trim(), heard: '' }),
          invoke: {
            src: 'route',
            input: ({ context }) => ({ heard: context.request, scene: scene(context) }),
            onDone: [
              { guard: routed('go'), target: '#call.acting' },
              {
                guard: routed('confirm'),
                target: '#call.confirming',
                actions: [
                  assign({ pending: ({ event }) => (event.output.kind === 'confirm' ? event.output.act : null), capture: null }),
                  { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: event.output.kind === 'confirm' ? `Ask the captain: ${event.output.ask}` : '' }) },
                ],
              },
              {
                guard: routed('dictate'),
                target: '#call.dictating',
                actions: [
                  assign({ capture: ({ event }) => (event.output.kind === 'dictate' ? event.output.capture : null), pending: null }),
                  { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: event.output.kind === 'dictate' ? event.output.ask : '' }) },
                ],
              },
              {
                guard: routed('brief'),
                target: '#call.listening',
                actions: [
                  assign({ topic: ({ event }) => (event.output.kind === 'brief' ? event.output.topic : null), pending: null, capture: null }),
                  // the briefing as background, the voice model told to talk it through, and the captain told it's ready
                  enqueueActions(({ context, event, enqueue }) => {
                    if (event.output.kind !== 'brief') return;
                    for (const piece of event.output.pieces) enqueue({ type: 'inform', params: piece });
                    enqueue({ type: 'instruct', params: talkThrough(event.output.topic) });
                    enqueue({ type: 'reply', params: { delegation: context.delegation, text: `I have the notes on ${event.output.topic.title} in front of me. Where would you like to start?` } });
                  }),
                ],
              },
              {
                target: '#call.listening',
                actions: [
                  assign({ pending: null, capture: null }),
                  { type: 'reply', params: ({ context, event }) => (event.output.kind === 'say' ? { delegation: context.delegation, text: event.output.text, quiet: event.output.quiet } : { delegation: null, text: '' }) },
                ],
              },
            ],
            onError: {
              target: '#call.listening',
              actions: [
                assign({ pending: null, capture: null }),
                { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: `Sorry, I couldn't work that out: ${errorText(event.error)}` }) },
              ],
            },
          },
        },
      },
    },
    confirming: {
      entry: {
        type: 'instruct',
        params: ({ context }) =>
          `Ops is waiting for the captain's yes or no to: ${context.pending ? askFor(context.pending) : ''} Hand their answer to Ops as soon as they give it. Never say it's done until Ops says so.`,
      },
      always: { guard: 'deferred', target: 'routing', actions: assign({ delegation: ({ context }) => context.deferred, deferred: null }) },
      after: {
        expiry: {
          target: 'listening',
          actions: [{ type: 'instruct', params: () => "The captain didn't answer in time, so nothing was done." }, assign({ pending: null })],
        },
      },
      on: { delegated: { target: 'routing', actions: assign({ delegation: ({ event }) => event.id }) } },
    },
    dictating: {
      entry: { type: 'instruct', params: () => 'Ops is waiting for what the captain wants passed on. Hand over what they say next, as they say it.' },
      always: { guard: 'deferred', target: 'routing', actions: assign({ delegation: ({ context }) => context.deferred, deferred: null }) },
      after: {
        expiry: {
          target: 'listening',
          actions: [{ type: 'instruct', params: () => "The captain didn't say what to pass on, so nothing was." }, assign({ capture: null })],
        },
      },
      on: { delegated: { target: 'routing', actions: assign({ delegation: ({ event }) => event.id }) } },
    },
    acting: {
      invoke: {
        src: 'act',
        input: ({ context }) => context.pending,
        onDone: {
          target: 'listening',
          actions: [assign({ pending: null }), { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: event.output }) }],
        },
        onError: {
          target: 'listening',
          actions: [
            { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: `That didn't work: ${errorText(event.error)}` }) },
            assign({ pending: null }),
          ],
        },
      },
    },
    ended: { type: 'final' },
  },
});

/** How the voice model talks a topic through: from the briefing, with the captain, owning up to what it doesn't hold. */
export const talkThrough = (topic: Topic) =>
  `You're talking through ${topic.title} with the captain. Think it through with them yourself, from the briefing Ops just gave you: ask questions, suggest, push back. It's the record of the work, not the code: when something isn't in it, say so rather than guess. Hand over to Ops only when the captain wants something done (make it a goal, tell the lead), the status, or a different topic.`;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
