// The ship's sounds, all synthesised with Web Audio: the engines' thrum underneath everything, doors that swoosh,
// LCARS chirps when a console opens and blips as you press its buttons, crew tapping at their stations while they work,
// a combadge chirp for news (a brighter trill when it's good, a denied tone when it isn't) and a transporter shimmer
// when you teleport.

import * as THREE from 'three';

const STORAGE_KEY = 'focus.sound';
const forward = new THREE.Vector3();
/** Pitches LCARS panels blip at; picking among them keeps a run of presses from droning on one note. */
const LCARS_BLIPS = [1175, 1319, 1480, 1568, 1760, 1976, 2349];
/** Stations further than this (metres) are out of earshot: the inverse rolloff alone would let every room leak in. */
const STATION_EARSHOT = 9;

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * A gain that rises to `peak` over `attack` seconds from `t`, then dies away by `t + end` (to about -35 dB).
 * A natural decay rather than an exponential ramp to silence, which drops so fast that a swoosh becomes a tick.
 */
function envelope(ctx: BaseAudioContext, t: number, attack: number, end: number, peak: number): GainNode {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + attack);
  env.gain.setTargetAtTime(0, t + attack, (end - attack) / 4);
  return env;
}

class ShipSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private brown: AudioBuffer | null = null;
  private white: AudioBuffer | null = null;
  private readonly ear = new THREE.Vector3();
  enabled = localStorage.getItem(STORAGE_KEY) !== 'off';

  /** Browsers only allow audio after a user gesture, so call this from one (the splash screen's button). */
  start(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(this.ctx.destination);
    this.brown = this.noise(4, true);
    this.white = this.noise(2, false);
    this.thrum();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.enabled ? 1 : 0, this.ctx.currentTime, 0.2);
    return this.enabled;
  }

  /** Moves the listener to the camera, so positioned sounds (doors) come from the right direction. */
  listen(camera: THREE.Camera): void {
    if (!this.ctx) return;
    camera.getWorldDirection(forward);
    const l = this.ctx.listener;
    const p = camera.position;
    this.ear.copy(p);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    } else {
      // Firefox only has the older setters
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /**
   * A pneumatic door at `at`, the TNG way: an unlatch tick, a burst of air, the whoosh of the leaves and the servo
   * driving them; closing ends in a soft thunk as they meet. Timed to the door animation (~0.3 s open, 0.4 s shut).
   */
  door(opening: boolean, at: THREE.Vector3): void {
    const out = this.out(1.3);
    if (!out) return;
    const { ctx, gain } = out;
    const t = ctx.currentTime;
    const panner = this.panner(ctx, at.x, 1.6, at.z, gain);

    const travel = opening ? 0.3 : 0.4;
    if (opening) this.hiss(panner, t, { type: 'highpass', from: 3500, to: 3500, q: 0.7, attack: 0.002, end: 0.03, peak: 0.35 }); // unlatch
    // the air: bright and fast when the seal breaks, darker and slower when it closes
    this.hiss(panner, t + (opening ? 0.01 : 0), opening
      ? { type: 'bandpass', from: 1400, to: 5200, q: 0.8, attack: 0.012, end: 0.45, peak: 0.9 }
      : { type: 'bandpass', from: 4200, to: 1300, q: 0.8, attack: 0.05, end: 0.42, peak: 0.55 });
    // the leaves pushing air aside
    this.hiss(panner, t, opening
      ? { type: 'bandpass', from: 320, to: 1300, q: 3, attack: 0.03, end: travel + 0.12, peak: 0.8 }
      : { type: 'bandpass', from: 1200, to: 300, q: 3, attack: 0.04, end: travel + 0.06, peak: 0.8 });

    // the servo, rising as it opens and falling as it shuts
    const servo = ctx.createOscillator();
    servo.type = 'sawtooth';
    servo.frequency.setValueAtTime(opening ? 150 : 260, t);
    servo.frequency.exponentialRampToValueAtTime(opening ? 270 : 140, t + travel);
    const servoTone = ctx.createBiquadFilter();
    servoTone.type = 'lowpass';
    servoTone.frequency.value = 800;
    servo.connect(servoTone).connect(envelope(ctx, t, 0.03, travel + 0.05, 0.06)).connect(panner);
    servo.start(t);
    servo.stop(t + travel + 0.1);

    if (!opening) {
      const meet = t + travel - 0.02;
      const thunk = ctx.createOscillator();
      // high enough for laptop speakers to play, low enough to feel like a thunk
      thunk.frequency.setValueAtTime(170, meet);
      thunk.frequency.exponentialRampToValueAtTime(70, meet + 0.1);
      thunk.connect(envelope(ctx, meet, 0.004, 0.16, 0.22)).connect(panner);
      thunk.start(meet);
      thunk.stop(meet + 0.2);
      this.hiss(panner, meet, { type: 'lowpass', from: 1200, to: 400, q: 0.7, attack: 0.002, end: 0.06, peak: 0.8 });
    }
  }

  /** A panner at (x, y, z) feeding `dest`, so a sound comes from somewhere on the ship. */
  private panner(ctx: AudioContext, x: number, y: number, z: number, dest: AudioNode): PannerNode {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.rolloffFactor = 1.2;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    panner.connect(dest);
    return panner;
  }

  /** A burst of filtered white noise starting at `t`, its filter swept from `from` to `to` Hz. */
  private hiss(dest: AudioNode, t: number, o: { type: BiquadFilterType; from: number; to: number; q: number; attack: number; end: number; peak: number }): void {
    const ctx = this.ctx!;
    const src = this.source(ctx, this.white!);
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q;
    filter.frequency.setValueAtTime(o.from, t);
    filter.frequency.exponentialRampToValueAtTime(o.to, t + o.end);
    src.connect(filter).connect(envelope(ctx, t, o.attack, o.end, o.peak)).connect(dest);
    src.start(t, Math.random(), o.end + 0.05);
  }

  /** LCARS console chirps: a rising pair when a panel opens, a falling one when it closes. */
  chirp(kind: 'open' | 'close'): void {
    this.tones(kind === 'open' ? [1320, 1760] : [1480, 990], 0.055, 0.05);
  }

  /** An LCARS button press. */
  press(): void {
    this.tones([pick(LCARS_BLIPS)], 0.06, 0.03);
  }

  /** The combadge for news, an acknowledging trill when something worked, a low denied tone when it didn't. */
  alert(level: 'info' | 'success' | 'error'): void {
    switch (level) {
      case 'info':
        return this.tones([2093, 2637, 3136], 0.045, 0.04, 'triangle');
      case 'success':
        return this.tones([1568, 2093, 2637, 2093, 2637], 0.04, 0.035, 'triangle');
      case 'error':
        return this.tones([587, 440], 0.14, 0.045, 'triangle');
    }
  }

  /** Someone tapping at the station whose display is at `at`: a few quiet blips, if you're close enough to hear. */
  console(at: THREE.Vector3): void {
    if (at.distanceTo(this.ear) > STATION_EARSHOT) return;
    const out = this.out(0.5);
    if (!out) return;
    const { ctx, gain } = out;
    const panner = this.panner(ctx, at.x, at.y, at.z, gain);
    let t = ctx.currentTime;
    for (let i = 2 + Math.floor(Math.random() * 3); i > 0; i--) {
      const step = 0.05 + Math.random() * 0.07;
      this.blip(panner, t, pick(LCARS_BLIPS), step * 0.8, 0.06, 'sine');
      t += step;
    }
  }

  /** Transporter shimmer for teleports. */
  beam(): void {
    const out = this.out(0.05);
    if (!out) return;
    const { ctx, gain } = out;
    const t = ctx.currentTime;
    const env = envelope(ctx, t, 0.25, 1.4, 1);
    // a fast tremolo is what makes it sparkle
    const tremolo = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 22;
    depth.gain.value = 0.5;
    tremolo.gain.value = 0.5;
    lfo.connect(depth).connect(tremolo.gain);
    tremolo.connect(env).connect(gain);
    for (const f of [1760, 2217, 2637, 3322, 3951]) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f * 0.92, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.06, t + 1.4);
      osc.connect(tremolo);
      osc.start(t);
      osc.stop(t + 1.45);
    }
    lfo.start(t);
    lfo.stop(t + 1.45);
  }

  /** The engines: brown noise rumble over a quiet, steady hum. Runs for as long as the page does. */
  private thrum(): void {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 0.16;
    bus.connect(this.master!);

    const rumble = this.source(ctx, this.brown!);
    rumble.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 140;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.9;
    rumble.connect(low).connect(rumbleGain).connect(bus);
    rumble.start();

    // Exact harmonics and a steady level: a detuned overtone or a swell makes the hum beat, which grates over time.
    const hum = ctx.createGain();
    hum.gain.value = 0.14;
    hum.connect(bus);
    for (const f of [49, 98, 147]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(hum);
      osc.start();
    }
  }

  private tones(freqs: number[], step: number, volume: number, type: OscillatorType = 'sine'): void {
    const out = this.out(volume);
    if (!out) return;
    const { ctx, gain } = out;
    freqs.forEach((f, i) => this.blip(gain, ctx.currentTime + i * step, f, step, 1, type));
  }

  /** One short tone of `length` seconds at `t`. */
  private blip(dest: AudioNode, t: number, freq: number, length: number, peak: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(envelope(ctx, t, 0.005, length * 0.95, peak)).connect(dest);
    osc.start(t);
    osc.stop(t + length);
  }

  /** A one-shot's output at `volume`, or null when sound hasn't started or is off (no point building the graph). */
  private out(volume: number): { ctx: AudioContext; gain: GainNode } | null {
    if (!this.ctx || !this.master || !this.enabled) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.master);
    return { ctx: this.ctx, gain };
  }

  private source(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  /** White noise, or brown (integrated, so it rumbles) for the engines. */
  private noise(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = brown ? last * 3.5 : white * 0.5;
    }
    return buffer;
  }
}

export const sound = new ShipSound();
