import { Effect, Layer } from 'effect';
import { Jev, type JevAnswer, type JevAnswers, type JevQuestion } from './jev';
import { Live, type LiveEvent, type Sideband, type SidebandListener } from './live';

// The demo's calls: no OpenAI, no Jev. The captain's side is scripted, each line said once the ship has answered the
// one before, and Jev's answers come from keywords, so the call's machine runs for real against the demo office.

/** What the demo's captain says, in order. */
export const DEMO_SCRIPT = ["What's the crew doing?", 'Start the next queued goal.', 'Make it so.'];
const PAUSE_MS = 1_200;

const ACTION_WORDS: [string, RegExp][] = [
  ['start_next_goal', /\b(start|kick off|begin)\b.*\bgoal\b|\bnext goal\b/i],
  ['status', /\b(status|doing|how are things|what's going on|what's happening|stand)\b/i],
];
const YES = /\b(yes|yeah|yep|go ahead|do it|make it so|affirmative|engage)\b/i;

/** What the captain just said, out of the state Jev is given (`routingState` quotes it last). */
const lastWords = (state: string) => /What the captain just said: "([^]*)"$/.exec(state)?.[1] ?? state;

function answer(question: JevQuestion, said: string): JevAnswer {
  if (question.type === 'noul') return { type: 'noul', noul: YES.test(said) ? 0.97 : 0.04 };
  const options = Object.keys(question.criteria);
  const named = options.find((o) => o !== 'none' && said.toLowerCase().includes(question.criteria[o].toLowerCase()));
  const keyword = ACTION_WORDS.find(([option, words]) => options.includes(option) && words.test(said))?.[0];
  const choice = keyword ?? named ?? (options.includes('other') ? 'other' : options.includes('none') ? 'none' : options[0]);
  return { type: 'choice', choice, confidence: 0.95 };
}

export const DemoJev = {
  layer: Layer.succeed(Jev, Jev.of({
    ask: (state, questions) => Effect.sync((): JevAnswers => Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, answer(q, lastWords(state))]))),
  })),
};

/** Plays the captain's side of a demo call: says a line, hands it over, and waits for the ship's answer. */
function scriptedCaptain(listener: SidebandListener): Sideband {
  let next = 0;
  let closed = false;
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!closed) fn();
    }, ms);
    timers.add(timer);
  };
  const emit = (event: LiveEvent) => listener.event(event);
  const say = () => {
    const line = DEMO_SCRIPT[next++];
    if (line === undefined) return;
    for (const word of line.split(/(?=\s)/)) emit({ type: 'session.input_transcript.delta', delta: word });
    later(200, () => emit({ type: 'session.delegation.created', delegation: { id: `demo_delegation_${next}`, target: 'client' } }));
  };
  later(PAUSE_MS, () => {
    emit({ type: 'session.started' });
    say();
  });
  return {
    send: (event) => {
      if (event.type === 'session.close') {
        later(0, () => emit({ type: 'session.closed', reason: 'close_requested' }));
        return;
      }
      if (event.type !== 'session.commentary.append') return;
      // the ship says what the office gave it, then the captain answers
      later(300, () => emit({ type: 'session.output_transcript.delta', delta: event.content.replace(/^Ask the captain: /, '') }));
      later(PAUSE_MS, say);
    },
    close: () => {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      listener.closed();
    },
  };
}

export const DemoLive = {
  layer: Layer.succeed(Live, Live.of({
    create: () => Effect.sync(() => ({ id: `demo_call_${Date.now().toString(36)}`, sdp: null })),
    attach: (_id, listener) => Effect.sync(() => scriptedCaptain(listener)),
  })),
};
