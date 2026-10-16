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

// Calls to Number One (../calls.md): one at a time, each a gpt-live-1 session the office is the backend of. The
// session's events drive the call's machine; what the machine says goes back over the sideband.

/** What a call needs from the office: how the ship stands, its log, and the acts the captain says yes to. */
export interface CallOffice {
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

/** Why the office can't take a call, worded for the Call button; undefined when it can. */
export function callsMissing(keys: CallKeys, demo: boolean): string | undefined {
  if (demo) return undefined;
  const missing = [!keys.openai && 'OPENAI_API_KEY', !keys.typesafe && 'TYPESAFE_API_KEY'].filter(Boolean);
  return missing.length ? `Calls need ${missing.join(' and ')} set where the office starts (see plugins/number-one/calls.md)` : undefined;
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
    private readonly office: CallOffice,
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
    const snapshot = await this.office.snapshot();
    const projects = shownProjects(snapshot.projects);
    const recent = this.lines.slice(0, -1);
    const answers = await this.runtime.runPromise(
      Effect.gen(function* () {
        const jev = yield* Jev;
        return yield* jev.ask(routingState(projects, heard, recent, scene), routingQuestions(projects, topics(snapshot), scene));
      }),
    );
    if (scene.capture) return dictated(scene.capture, heard, answers, callNotes(recent.slice(scene.topic ? this.topicFrom : 0)), scene.topic);
    return decide({ snapshot, ledger: this.office.ledger(), now: Date.now(), scene }, answers);
  }

  /** Does what the captain said yes to; the office checks again as it does (the goal still queued, a station free). */
  private act(act: Act): string {
    switch (act.kind) {
      case 'start-queued': {
        const agent = this.office.startQueued(act.start.projectId, act.start.queueId, act.start.station);
        return `Started: ${agent.name} has "${act.start.title}" at station ${(agent.lead?.station ?? act.start.station) + 1}.`;
      }
      case 'new-goal': {
        const started = this.office.startGoal(act.projectId, act.text);
        return 'agent' in started
          ? `Started: ${started.agent.name} has "${act.title}" at station ${(started.agent.lead?.station ?? 0) + 1}.`
          : `Queued "${act.title}" in ${act.projectName}: every team station has a goal.`;
      }
      case 'tell-lead':
        return 'sent' in this.office.message(act.leadId, act.text)
          ? `Sent to ${act.leadName}.`
          : `Not sent yet: picking ${act.leadName}'s conversation back up on the API key needs your say, on the screens.`;
    }
  }
}

/** What a capture waits on, for the strip. */
const capturing = (capture: Capture) => (capture.kind === 'new-goal' ? `What should the new goal in ${capture.projectName} be?` : `What should I tell ${capture.leadName}?`);

/** The office's calls: whether it can take one, and the one under way (or the last, once it's ended). */
export class Calls {
  private call: Call | null = null;
  private readonly runtime: Runtime | null;
  private readonly missing: string | undefined;

  /** `publish` tells every screen how the calls stand; `layer`: OpenAI and Jev, or the demo's stand-ins for them (tests bring their own). */
  constructor(
    private readonly publish: (status: CallStatus) => void,
    private readonly office: CallOffice,
    keys: CallKeys,
    demo: boolean,
    layer: Layer.Layer<Jev | Live> = demo ? Layer.mergeAll(DemoJev.layer, DemoLive.layer) : Layer.mergeAll(Jev.layer(keys.typesafe ?? ''), Live.layer(keys.openai ?? '')),
  ) {
    this.missing = callsMissing(keys, demo);
    this.runtime = this.missing ? null : ManagedRuntime.make(layer);
  }

  status(): CallStatus {
    return { ...(this.missing && { missing: this.missing }), call: this.call?.state() ?? null };
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
    const call = new Call(session.id, runtime, this.office, () => this.changed(call));
    this.call = call;
    try {
      call.sideband = await runtime.runPromise(
        Effect.gen(function* () {
          const live = yield* Live;
          return yield* live.attach(session.id, { event: (e) => call.event(e), closed: (why) => call.end(why && `The office lost the call: ${why}`) });
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
