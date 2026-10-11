import { Effect, Layer, ManagedRuntime } from 'effect';
import { type Actor, createActor, fromPromise } from 'xstate';
import { shownProjects } from '../../shared/hidden';
import type { Agent, CallLine, CallState, CallStatus, CallStep, Snapshot } from '../../shared/types';
import type { Hub } from '../hub';
import { errorMessage } from '../util';
import { addCaption } from './captions';
import { DemoJev, DemoLive } from './demo';
import { Jev } from './jev';
import { Live, type LiveEvent, type LiveSession, type Sideband } from './live';
import { callMachine, type Reply, type RouteInput } from './machine';
import { decide, type Routing, routingQuestions, routingState, type StartGoal } from './route';

// Calls to Number One (docs/calls.md): one at a time, each a gpt-live-1 session the office is the backend of. The
// session's events drive the call's machine; what the machine says goes back over the sideband.

/** What a call needs from the office: how the ship stands, and starting a queued goal. */
export interface CallOffice {
  snapshot(): Promise<Snapshot>;
  startQueued(projectId: string, queueId: string, station: number): Agent;
}

export interface CallKeys {
  openai?: string;
  typesafe?: string;
}

/** Why the office can't take a call, worded for the Call button; undefined when it can. */
export function callsMissing(keys: CallKeys, demo: boolean): string | undefined {
  if (demo) return undefined;
  const missing = [!keys.openai && 'OPENAI_API_KEY', !keys.typesafe && 'TYPESAFE_API_KEY'].filter(Boolean);
  return missing.length ? `Calls need ${missing.join(' and ')} set where the office starts (see docs/calls.md)` : undefined;
}

/** The step the captain sees for the machine's state. */
function stepOf(value: unknown): CallStep {
  const top = typeof value === 'string' ? value : Object.keys(value as object)[0];
  return top === 'routing' || top === 'confirming' || top === 'acting' || top === 'ended' ? top : 'listening';
}

type Runtime = ManagedRuntime.ManagedRuntime<Jev | Live, never>;

/** One call: its captions, its machine, and the sideband it talks over. */
class Call {
  lines: CallLine[] = [];
  error?: string;
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
          start: fromPromise<string, StartGoal>(({ input }) => this.start(input)),
        },
        actions: {
          reply: (_, reply: Reply) => this.reply(reply),
          instruct: (_, text: string) => this.sideband?.send({ type: 'session.instructions.append', delegation_id: null, content: text }),
        },
      }),
    );
    this.actor.start();
    this.actor.subscribe(() => this.changed());
  }

  state(): CallState {
    const snapshot = this.actor.getSnapshot();
    const pending = snapshot.context.pending;
    return {
      id: this.id,
      step: stepOf(snapshot.value),
      ...(pending && { pending: `Start "${pending.title}" in ${pending.projectName}, at station ${pending.station + 1}?` }),
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

  private reply({ delegation, text }: Reply): void {
    if (!text) return;
    this.caption('office', text, Date.now());
    this.sideband?.send({ type: 'session.commentary.append', delegation_id: delegation, content: text });
  }

  /** Jev on what the captain just said, against the ship as it stands now. */
  private async route({ heard, pending }: RouteInput): Promise<Routing> {
    if (!heard) return { kind: 'say', text: "Sorry, I didn't catch that." };
    const snapshot = await this.office.snapshot();
    const projects = shownProjects(snapshot.projects);
    const recent = this.lines.slice(0, -1);
    const answers = await this.runtime.runPromise(
      Effect.gen(function* () {
        const jev = yield* Jev;
        return yield* jev.ask(routingState(projects, heard, recent, pending ?? undefined), routingQuestions(projects, pending ?? undefined));
      }),
    );
    return decide(snapshot, answers, pending ?? undefined);
  }

  /** Starts the goal the captain said yes to: the office checks again that it's still queued and a station is free. */
  private start(start: StartGoal): Promise<string> {
    const agent = this.office.startQueued(start.projectId, start.queueId, start.station);
    return Promise.resolve(`Started: ${agent.name} has "${start.title}" at station ${(agent.lead?.station ?? start.station) + 1}.`);
  }
}

/** The office's calls: whether it can take one, and the one under way (or the last, once it's ended). */
export class Calls {
  private call: Call | null = null;
  private readonly runtime: Runtime | null;
  private readonly missing: string | undefined;

  constructor(
    private readonly hub: Hub,
    private readonly office: CallOffice,
    keys: CallKeys,
    demo: boolean,
  ) {
    this.missing = callsMissing(keys, demo);
    const layer = demo ? Layer.mergeAll(DemoJev.layer, DemoLive.layer) : Layer.mergeAll(Jev.layer(keys.typesafe ?? ''), Live.layer(keys.openai ?? ''));
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
    const call = new Call(session.id, runtime, this.office, () => this.publish(call));
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
    this.publish(call);
    return session;
  }

  hangUp(id: string): void {
    if (this.call?.id === id) this.call.hangUp();
  }

  private publish(call: Call): void {
    if (call === this.call) this.hub.send({ type: 'call', call: call.state() });
  }
}
