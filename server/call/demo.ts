import { Effect, Layer } from 'effect';
import { Jev, type JevAnswer, type JevAnswers, type JevQuestion } from './jev';
import { Live, type LiveEvent, type Sideband, type SidebandListener } from './live';

// The demo's calls: no OpenAI, no Jev. The captain's side is scripted, each line said once the ship has answered the
// one before, and Jev's answers come from keywords, so the call's machine runs for real against the demo office.

/** A line of the demo's captain: handed over to the office, or answered by the ship itself from its briefing. */
export interface DemoLine {
  said: string;
  /** What the ship says back without the office, while talking something through. */
  ship?: string;
}

/** What the demo's captain says, in order: the status, then a project talked through and made into a goal. */
export const DEMO_SCRIPT: DemoLine[] = [
  { said: "What's the crew doing?" },
  { said: "Let's talk about Sock Shop as a whole." },
  { said: 'Why do pull requests keep failing QA?', ship: "The log shows failed QA rounds, but the briefing doesn't say why each one failed, so I'd want someone to look before guessing." },
  { said: 'Make that a goal.' },
  { said: 'Find out why pull requests fail QA in Sock Shop, and stop it happening.' },
  { said: 'Yes, make it so.' },
];
const PAUSE_MS = 1_200;

const ACTION_WORDS: [string, RegExp][] = [
  ['capture_goal', /\bmake (that|it|this) (into )?a goal\b/i],
  ['tell_lead', /\b(tell|pass (that|it) on to)\b/i],
  ['talk', /\b(talk|think through|discuss)\b/i],
  ['start_next_goal', /\b(start|kick off|begin)\b.*\bgoal\b|\bnext goal\b/i],
  ['status', /\b(status|doing|how are things|what's going on|what's happening|stand)\b/i],
];
const YES = /\b(yes|yeah|yep|go ahead|do it|make it so|affirmative|engage|send it)\b/i;
const CANCEL = /\b(never mind|forget it|cancel|not now)\b/i;

/** What the captain just said, out of the state Jev is given (`routingState` quotes it last). */
const lastWords = (state: string) => /What the captain just said: "([^]*)"$/.exec(state)?.[1] ?? state;

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** The option whose description shares the most words with what was said: a project or goal named. */
function named(criteria: Record<string, string>, said: string): string | undefined {
  const heard = words(said);
  const scored = Object.entries(criteria)
    .filter(([option]) => option !== 'none')
    .map(([option, label]) => ({ option, score: [...words(label)].filter((w) => heard.has(w)).length }))
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.option;
}

function answer(key: string, question: JevQuestion, said: string): JevAnswer {
  if (question.type === 'noul') return { type: 'noul', noul: (key === 'cancel' ? CANCEL : YES).test(said) ? 0.97 : 0.04 };
  const options = Object.keys(question.criteria);
  const keyword = ACTION_WORDS.find(([option, words]) => options.includes(option) && words.test(said))?.[0];
  const choice = keyword ?? named(question.criteria, said) ?? (options.includes('other') ? 'other' : 'none');
  return { type: 'choice', choice, confidence: 0.95 };
}

export const DemoJev = {
  layer: Layer.succeed(Jev, Jev.of({
    ask: (state, questions) => Effect.sync((): JevAnswers => Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, answer(key, q, lastWords(state))]))),
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
    for (const word of line.said.split(/(?=\s)/)) emit({ type: 'session.input_transcript.delta', delta: word });
    if (line.ship === undefined) return later(200, () => emit({ type: 'session.delegation.created', delegation: { id: `demo_delegation_${next}`, target: 'client' } }));
    // talking it through: the ship answers from its briefing, without the office
    const reply = line.ship;
    later(PAUSE_MS, () => emit({ type: 'session.output_transcript.delta', delta: reply }));
    later(PAUSE_MS * 2, say);
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
