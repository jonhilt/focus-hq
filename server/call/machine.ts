import { assign, fromPromise, setup } from 'xstate';
import type { Routing, StartGoal } from './route';

// A call's rails: what the ship can do at each point of the conversation, and nothing else. gpt-live-1 decides when to
// hand the captain's words over (a delegation); the machine routes them (Jev, through `route`), asks before starting a
// goal, and starts it only from `confirming`, on a yes `route` judged clear. Its actors and replies are provided by the
// call (calls.ts), so tests drive it with stand-ins (machine.test.ts).

/** How long after a delegation the machine waits for the end of what the captain said to come in. */
export const SETTLE_MS = 300;
/** How long a start waits for the captain's yes before it's dropped. */
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
  /** The start waiting on the captain's yes. */
  pending: StartGoal | null;
}

export type CallEvent = { type: 'heard'; text: string } | { type: 'delegated'; id: string } | { type: 'hang-up' };

export interface RouteInput {
  heard: string;
  pending: StartGoal | null;
}

/** For the ship to say, in answer to a delegation (null: not tied to one). */
export interface Reply {
  delegation: string | null;
  text: string;
}

const notProvided = (what: string) => () => Promise.reject(new Error(`The call's ${what} wasn't provided`));

export const callMachine = setup({
  types: {
    context: {} as CallContext,
    events: {} as CallEvent,
  },
  actors: {
    route: fromPromise<Routing, RouteInput>(notProvided('router')),
    start: fromPromise<string, StartGoal>(notProvided('start')),
  },
  actions: {
    /** Something for the ship to say. */
    reply: (_, _reply: Reply) => undefined,
    /** Standing instructions for the voice model, not said aloud. */
    instruct: (_, _text: string) => undefined,
  },
  guards: {
    deferred: ({ context }) => context.deferred !== null,
  },
  delays: { settle: SETTLE_MS, expiry: EXPIRY_MS },
}).createMachine({
  id: 'call',
  context: { heard: '', request: '', delegation: null, deferred: null, pending: null },
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
            input: ({ context }) => ({ heard: context.request, pending: context.pending }),
            onDone: [
              { guard: ({ event }) => event.output.kind === 'go', target: '#call.acting' },
              {
                guard: ({ event }) => event.output.kind === 'confirm',
                target: '#call.confirming',
                actions: [
                  assign({ pending: ({ event }) => (event.output.kind === 'confirm' ? event.output.start : null) }),
                  { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: event.output.kind === 'confirm' ? `Ask the captain: ${event.output.ask}` : '' }) },
                ],
              },
              {
                target: '#call.listening',
                actions: [assign({ pending: null }), { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: event.output.kind === 'say' ? event.output.text : '' }) }],
              },
            ],
            onError: {
              target: '#call.listening',
              actions: [
                assign({ pending: null }),
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
          `The office is waiting for the captain's yes or no to starting "${context.pending?.title}". Hand their answer to the office as soon as they give it. Never say it has started until the office says so.`,
      },
      always: { guard: 'deferred', target: 'routing', actions: assign({ delegation: ({ context }) => context.deferred, deferred: null }) },
      after: {
        expiry: {
          target: 'listening',
          actions: [
            { type: 'instruct', params: ({ context }) => `The captain didn't answer in time, so "${context.pending?.title}" stays queued and nothing was started.` },
            assign({ pending: null }),
          ],
        },
      },
      on: { delegated: { target: 'routing', actions: assign({ delegation: ({ event }) => event.id }) } },
    },
    acting: {
      invoke: {
        src: 'start',
        input: ({ context }) => context.pending!,
        onDone: {
          target: 'listening',
          actions: [assign({ pending: null }), { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: event.output }) }],
        },
        onError: {
          target: 'listening',
          actions: [
            { type: 'reply', params: ({ context, event }) => ({ delegation: context.delegation, text: `It didn't start: ${errorText(event.error)}` }) },
            assign({ pending: null }),
          ],
        },
      },
    },
    ended: { type: 'final' },
  },
});

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
