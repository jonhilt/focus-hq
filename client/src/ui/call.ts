import type { CallLine, CallState, CallStep } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { busy, h } from './dom';

// Calls to Number One (docs/calls.md): this browser carries the audio, straight to OpenAI over WebRTC; the office
// joins the call on a line of its own, and tells every screen how it's going (`state.call`). The call outlives Number
// One's panel, so the captain can walk round the ship while they talk.

/** A call this browser is on: its audio, and the session it's for. */
class PhoneCall {
  private constructor(
    readonly id: string,
    private readonly peer: RTCPeerConnection | null,
    private readonly mic: MediaStream | null,
  ) {}

  /** Opens the mic, offers the call to the office, and plays the ship's voice. The demo's calls have no audio. */
  static async dial(): Promise<PhoneCall> {
    if (state.info?.mode === 'demo') return new PhoneCall((await api.startCall('demo')).id, null, null);
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const peer = new RTCPeerConnection();
    try {
      const speaker = new Audio();
      speaker.autoplay = true;
      peer.ontrack = (e) => (speaker.srcObject = e.streams[0]);
      for (const track of mic.getTracks()) peer.addTrack(track, mic);
      // OpenAI's events channel: the office has its own line, so this one only carries a hang-up
      peer.createDataChannel('oai-events');
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const session = await api.startCall(offer.sdp ?? '');
      if (session.sdp) await peer.setRemoteDescription({ type: 'answer', sdp: session.sdp });
      return new PhoneCall(session.id, peer, mic);
    } catch (err) {
      peer.close();
      for (const track of mic.getTracks()) track.stop();
      throw err;
    }
  }

  /** Lets go of the mic and the line; the office ends its side. */
  hangUp(): Promise<unknown> {
    this.peer?.close();
    for (const track of this.mic?.getTracks() ?? []) track.stop();
    return api.hangUp(this.id);
  }
}

let current: PhoneCall | null = null;


// the office ended the call (the captain hung up elsewhere, or the line dropped): let go of the mic here too
state.on('call', () => {
  if (current && (!state.call?.call || state.call.call.id !== current.id || state.call.call.step === 'ended')) {
    void current.hangUp().catch(() => undefined);
    current = null;
  }
});

const STEP: Record<CallStep, string> = {
  listening: 'Listening',
  routing: 'Working it out…',
  confirming: 'Waiting for your yes',
  dictating: 'Waiting for your words',
  acting: 'Doing it…',
  ended: 'Call ended',
};

/** What the strip says the call is doing. */
export function stepLabel(call: Pick<CallState, 'step' | 'pending'>): string {
  return call.step === 'routing' && call.pending ? 'Checking your answer…' : STEP[call.step];
}

const WHO: Record<CallLine['who'], string> = { captain: 'You', ship: 'Number One', office: 'Office' };

/**
 * Number One's call controls: Call (greyed, with why, when the office can't take one), and while a call is on, how it's
 * going, what waits on your yes, the captions, and Hang up. `error` shows what went wrong placing it.
 */
export function callView(error: (message: string) => void, changed: () => void): HTMLElement {
  const status = state.call;
  const call = status?.call ?? null;
  // a call placed on another screen (the phone, say) shows here too, and can be hung up from here
  const live = call && call.step !== 'ended' ? call : null;
  if (!live) {
    const dial = h('button', { class: 'btn', title: status?.missing ?? 'Talk to Number One hands-free: ask how things stand, start the next queued goal, or talk a goal or a project through and make it a goal' }, '📞 Call');
    dial.disabled = !status || !!status.missing;
    dial.onclick = () =>
      void busy(dial, async () => {
        current = await PhoneCall.dial();
        changed();
      }, error);
    const ended = call?.step === 'ended' && call.lines.length ? call : null;
    return h('div', { class: 'call' },
      h('div', { class: 'row' }, dial, ended ? h('small', { class: ended.error ? 'error' : 'muted' }, ended.error ?? 'The last call:') : null),
      ended ? captions(ended.lines) : null,
    );
  }
  const hang = h('button', { class: 'btn danger' }, 'Hang up');
  hang.onclick = () =>
    void busy(hang, async () => {
      const mine = current?.id === live.id ? current : null;
      if (mine) current = null;
      await (mine ? mine.hangUp() : api.hangUp(live.id));
      changed();
    }, error);
  return h('div', { class: `call on ${live.step}` },
    h('div', { class: 'row' }, h('span', { class: 'call-step' }, `📞 ${stepLabel(live)}`), live.topic ? h('span', { class: 'call-topic' }, `Talking through: ${live.topic}`) : null, h('span', { class: 'grow' }), hang),
    live.pending ? h('div', { class: 'call-pending' }, `${live.pending} Say yes, or make it so.`) : null,
    live.capture ? h('div', { class: 'call-pending' }, live.capture) : null,
    captions(live.lines),
  );
}

function captions(lines: CallLine[]): HTMLElement {
  const list = h('div', { class: 'call-lines' }, ...lines.map((l) => h('div', { class: `call-line ${l.who}` }, h('strong', null, WHO[l.who]), ` ${l.text}`)));
  requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
  return list;
}
