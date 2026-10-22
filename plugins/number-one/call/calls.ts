import { Effect, Layer, ManagedRuntime } from 'effect';
import { type Actor, createActor, fromPromise } from 'xstate';
import type { CallLine, CallState, CallStatus, CallStep } from '../shared';
import { addCaption } from './captions';
import { DemoJev, DemoLive } from './demo';
import { Jev } from './jev';
import { Live, type LiveEvent, type LiveSession, type Sideband } from './live';
import { callMachine, type Reply, type RouteInput } from './machine';
import { topics } from './brief';
import { type Act, askFor, type Capture, callNotes, decide, dictated, type Routing, routingQuestions, routingState } from './route';
import { type Agent, errorMessage, type LedgerEvent, type MessageReply, type QueuedGoal, shownProjects, type Snapshot } from '../../../plugin-api/server';

// Calls to Number One: one at a time, each a gpt-live-1 session Ops is the backend of. The
// session's events drive the call's machine; what the machine says goes back over the sideband.
// Why three parts (the stack JFDI's voice mode ended up with): a realtime voice model holds the conversation, a fast
// "System One" model (Jev) decides what was asked with calibrated confidence, and a state machine keeps each task on
// rails, so anything consequential (a goal started, a word to a lead) happens only from confirming, on a clear yes in
// the captain's own words.

/** What a call needs from Ops: how the ship stands, its log, and the acts the captain says yes to. */
export interface CallHost {
  snapshot(): Promise<Snapshot>;
  ledger(): LedgerEvent[];
  startQueued(projectId: string, queueId: string, station: number): Agent;
  startGoal(projectId: string, text: string): { agent: Agent } | { queued: QueuedGoal };
  message(agentId: string, text: string): MessageReply;
}

export interface CallKeys {
  openai?: string;
  typesafe?: string;
}

/** Why Ops can't take a call, worded for the Call button; undefined when it can. */
export function callsMissing(keys: CallKeys, demo: boolean): string | undefined {
  if (demo) return undefined;
  const missing = [!keys.openai && 'an OpenAI API key', !keys.typesafe && 'a TypeSafe API key'].filter(Boolean);
  return missing.length ? `Calls need ${missing.join(' and ')}, set in the ready room's Plugins tab` : undefined;
}

/** The step the captain sees for the machine's state (`routing` has steps of its own inside). */
export function stepOf(value: unknown): CallStep {
  const top = typeof value === 'string' ? value : Object.keys(value as object)[0];
  return top === 'routing' || top === 'confirming' || top === 'dictating' || top === 'acting' || top === 'ended' ? top : 'listening';
}

type Runtime = ManagedRuntime.ManagedRuntime<Jev | Live, never>;

/** One call: its captions, its machine, and the sideband it talks over. */
class Call {
  lines: CallLine[] = [];
  error?: string;
  /** Where the conversation about the call's topic starts in its captions: the notes a capture carries begin there. */
  private topicFrom = 0;
  sideband?: Sideband;
  private readonly actor: Actor<typeof callMachine>;

  constructor(
    readonly id: string,
    private readonly runtime: Runtime,
    private readonly focus: CallHost,
    private readonly changed: () => void,
  ) {
    this.actor = createActor(
      callMachine.provide({
        actors: {
          route: fromPromise<Routing, RouteInput>(({ input }) => this.route(input)),
          act: fromPromise<string, Act | null>(({ input }) => (input ? Promise.resolve(this.act(input)) : Promise.reject(new Error('there was nothing waiting for a yes')))),
        },
        actions: {
          reply: (_, reply: Reply) => this.reply(reply),
          instruct: (_, text: string) => this.sideband?.send({ type: 'session.instructions.append', delegation_id: null, content: text }),
          inform: (_, text: string) => this.sideband?.send({ type: 'session.thinking.append', delegation_id: null, content: text }),
        },
      }),
    );
    this.actor.start();
    let topic = this.actor.getSnapshot().context.topic;
    this.actor.subscribe((snapshot) => {
      if (snapshot.context.topic !== topic) {
        topic = snapshot.context.topic;
        this.topicFrom = this.lines.length;
      }
      this.changed();
    });
  }

  state(): CallState {
    const snapshot = this.actor.getSnapshot();
    const { pending, topic, capture } = snapshot.context;
    return {
      id: this.id,
      step: stepOf(snapshot.value),
      ...(pending && { pending: askFor(pending) }),
      ...(topic && { topic: topic.title }),
      ...(capture && { capture: capturing(capture) }),
      lines: this.lines,
      ...(this.error && { error: this.error }),
    };
  }

  /** What the session says happened. */
  event(event: LiveEvent): void {
    const at = Date.now();
    switch (event.type) {
      case 'session.input_transcript.delta':
        this.caption('captain', event.delta, at);
        this.actor.send({ type: 'heard', text: event.delta });
        break;
      case 'session.output_transcript.delta':
        this.caption('ship', event.delta, at);
        break;
      case 'session.delegation.created':
        if (event.delegation.target === 'client') this.actor.send({ type: 'delegated', id: event.delegation.id });
        break;
      case 'session.closed':
        this.end(event.reason === 'close_requested' || event.reason === 'remote_hangup' ? undefined : `The call ended: ${event.reason.replace(/_/g, ' ')}`);
        break;
      case 'error':
        this.caption('office', `OpenAI: ${event.error.message}`, at);
        break;
      case 'session.started':
        break;
    }
  }

  hangUp(): void {
    this.sideband?.send({ type: 'session.close' });
    this.end();
  }

  end(error?: string): void {
    if (stepOf(this.actor.getSnapshot().value) === 'ended') return;
    if (error) this.error = error;
    this.actor.send({ type: 'hang-up' });
    this.sideband?.close();
  }

  private caption(who: CallLine['who'], text: string, at: number): void {
    this.lines = addCaption(this.lines, who, text, at);
    this.changed();
  }

  private reply({ delegation, text, quiet }: Reply): void {
    if (!text) return;
    if (quiet) return this.sideband?.send({ type: 'session.thinking.append', delegation_id: delegation, content: text });
    this.caption('office', text, Date.now());
    this.sideband?.send({ type: 'session.commentary.append', delegation_id: delegation, content: text });
  }

  /**
   * Jev on what the captain just said, against the ship as it stands now. Words for a new goal or a lead only need to
   * know whether they call it off.
   */
  private async route({ heard, scene }: RouteInput): Promise<Routing> {
    if (!heard) return { kind: 'say', text: "Sorry, I didn't catch that." };
    const snapshot = await this.focus.snapshot();
    const projects = shownProjects(snapshot.projects);
    const recent = this.lines.slice(0, -1);
    const answers = await this.runtime.runPromise(
      Effect.gen(function* () {
        const jev = yield* Jev;
        return yield* jev.ask(routingState(projects, heard, recent, scene), routingQuestions(projects, topics(snapshot), scene));
      }),
    );
    if (scene.capture) return dictated(scene.capture, heard, answers, callNotes(recent.slice(scene.topic ? this.topicFrom : 0)), scene.topic);
    return decide({ snapshot, ledger: this.focus.ledger(), now: Date.now(), scene }, answers);
  }

  /** Does what the captain said yes to; Ops checks again as it does (the goal still queued, a station free). */
  private act(act: Act): string {
    switch (act.kind) {
      case 'start-queued': {
        const agent = this.focus.startQueued(act.start.projectId, act.start.queueId, act.start.station);
        return `Started: ${agent.name} has "${act.start.title}" at station ${(agent.lead?.station ?? act.start.station) + 1}.`;
      }
      case 'new-goal': {
        const started = this.focus.startGoal(act.projectId, act.text);
        return 'agent' in started
          ? `Started: ${started.agent.name} has "${act.title}" at station ${(started.agent.lead?.station ?? 0) + 1}.`
          : `Queued "${act.title}" in ${act.projectName}: every team station has a goal.`;
      }
      case 'tell-lead':
        return 'sent' in this.focus.message(act.leadId, act.text)
          ? `Sent to ${act.leadName}.`
          : `Not sent yet: picking ${act.leadName}'s conversation back up on the API key needs your say, on the screens.`;
    }
  }
}

/** What a capture waits on, for the strip. */
const capturing = (capture: Capture) => (capture.kind === 'new-goal' ? `What should the new goal in ${capture.projectName} be?` : `What should I tell ${capture.leadName}?`);

/** Ops' calls: whether it can take one, and the one under way (or the last, once it's ended). */
export class Calls {
  private call: Call | null = null;
  /** OpenAI and Jev on the keys they were made with: made again when the captain changes a key (a call under way keeps its own). */
  private made: { keys: string; runtime: Runtime } | null = null;

  /**
   * `publish` tells every screen how the calls stand; `keys` are read as each call starts, so a key the captain sets
   * applies to the next; `layer`: OpenAI and Jev on those keys, or the demo's stand-ins for them (tests bring their own).
   */
  constructor(
    private readonly publish: (status: CallStatus) => void,
    private readonly focus: CallHost,
    private readonly keys: () => CallKeys,
    private readonly demo: boolean,
    private readonly layer: (keys: CallKeys) => Layer.Layer<Jev | Live> = (k) =>
      demo ? Layer.mergeAll(DemoJev.layer, DemoLive.layer) : Layer.mergeAll(Jev.layer(k.typesafe ?? ''), Live.layer(k.openai ?? '')),
  ) {}

  private get missing(): string | undefined {
    return callsMissing(this.keys(), this.demo);
  }

  /** OpenAI and Jev on the keys as they are now, or null while one's missing. */
  private get runtime(): Runtime | null {
    const keys = this.keys();
    if (callsMissing(keys, this.demo)) return null;
    const id = JSON.stringify([keys.openai, keys.typesafe]);
    if (this.made?.keys !== id) this.made = { keys: id, runtime: ManagedRuntime.make(this.layer(keys)) };
    return this.made.runtime;
  }

  status(): CallStatus {
    const missing = this.missing;
    return { ...(missing && { missing }), call: this.call?.state() ?? null };
  }

  /** Starts a call from the browser's WebRTC offer (hanging up one under way): the session's id and the answer. */
  async start(sdp: string): Promise<LiveSession> {
    const runtime = this.runtime;
    if (!runtime) throw new Error(this.missing);
    this.call?.hangUp();
    const session = await runtime.runPromise(
      Effect.gen(function* () {
        const live = yield* Live;
        return yield* live.create(sdp);
      }),
    );
    const call = new Call(session.id, runtime, this.focus, () => this.changed(call));
    this.call = call;
    try {
      call.sideband = await runtime.runPromise(
        Effect.gen(function* () {
          const live = yield* Live;
          return yield* live.attach(session.id, { event: (e) => call.event(e), closed: (why) => call.end(why && `Ops lost the call: ${why}`) });
        }),
      );
    } catch (err) {
      call.end(errorMessage(err));
      throw err;
    }
    this.changed(call);
    return session;
  }

  hangUp(id: string): void {
    if (this.call?.id === id) this.call.hangUp();
  }

  private changed(call: Call): void {
    if (call === this.call) this.publish(this.status());
  }
}
