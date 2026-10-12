// The studio holodeck's computer (studioComputer.ts): the pure decisions behind its tools, and what it's told. The
// video it builds up with the captain (premise, narrative beats with their lines, loose threads) and the takes it stages
// on the holodeck's floor, rough 3D sketches written against the studio's kit (client/src/world/takeKit.ts).

import type { StudioMessage, StudioPitches, StudioTake, StudioThread, StudioVideo } from '../../shared/types';
import { type TakePhases, takeSyntaxError } from '../../shared/takeScript';

/** How long each part may be, how many beats and open threads a video has room for, and how many takes stay on the floor. */
export const STUDIO_LIMITS = {
  premise: 300,
  takeaway: 200,
  beats: 12,
  beatTitle: 60,
  point: 200,
  lines: 1200,
  thread: 160,
  answer: 240,
  open: 8,
  kept: 30,
  takes: 12,
  takeLabel: 40,
  takeDetail: 200,
  metaphor: 200,
  phases: 12,
  script: 16_000,
  minSeconds: 2,
  maxSeconds: 60,
  minPitches: 2,
  maxPitches: 5,
  pitchTitle: 40,
  pitchScale: 60,
  pitchCheck: 200,
} as const;
const L = STUDIO_LIMITS;

/** What the video tool can send: each field replaces what was there, except thread and closeThread, which log and close one. */
export interface VideoInput {
  premise?: string;
  takeaway?: string;
  beats?: { title: string; point?: string; lines?: string }[];
  thread?: string;
  closeThread?: { id: string; as: 'answered' | 'dropped'; answer?: string };
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const openThreads = (threads: readonly StudioThread[]) => threads.filter((t) => !t.closed).map((t) => `${t.id} (${t.text})`).join(', ') || 'none';

/** The video after the computer's change, or why it was refused (then nothing changes). It starts with its premise. */
export function applyVideo(video: StudioVideo | undefined, input: VideoInput, now: number): StudioVideo | { error: string } {
  const premise = input.premise !== undefined ? clean(input.premise) : video?.premise;
  if (!premise) return { error: 'Start with the premise: the video’s basic idea, in a sentence or two.' };
  if (premise.length > L.premise) return { error: `The premise is ${premise.length} characters (at most ${L.premise}).` };
  const takeaway = input.takeaway !== undefined ? clean(input.takeaway) : video?.takeaway;
  if (takeaway && takeaway.length > L.takeaway) return { error: `The takeaway is ${takeaway.length} characters (at most ${L.takeaway}).` };
  const beats = input.beats?.map((b) => ({ title: clean(b.title), ...(b.point?.trim() && { point: clean(b.point) }), ...(b.lines?.trim() && { lines: b.lines.trim() }) })) ?? video?.beats ?? [];
  if (beats.length > L.beats) return { error: `There are ${beats.length} beats (at most ${L.beats}): merge some.` };
  if (beats.some((b) => !b.title)) return { error: 'Every beat needs a title.' };
  const long = beats.find((b) => b.title.length > L.beatTitle || (b.point?.length ?? 0) > L.point || (b.lines?.length ?? 0) > L.lines);
  if (long) return { error: `Beat “${long.title.slice(0, 30)}” is too long (titles at most ${L.beatTitle} characters, points ${L.point}, lines ${L.lines}).` };
  const threads = applyThreads(video?.threads ?? [], input, now);
  if ('error' in threads) return threads;
  return { premise, ...(takeaway && { takeaway }), beats, threads };
}

function applyThreads(threads: StudioThread[], input: VideoInput, now: number): StudioThread[] | { error: string } {
  let all = threads;
  if (input.closeThread) {
    const { id, as } = input.closeThread;
    const found = all.find((t) => t.id === id.trim());
    if (!found) return { error: `There's no thread ${id}. Open threads: ${openThreads(all)}.` };
    if (found.closed) return { error: `Thread ${found.id} was already ${found.closed.as}.` };
    const answer = clean(input.closeThread.answer ?? '');
    if (answer.length > L.answer) return { error: `The answer is ${answer.length} characters (at most ${L.answer}).` };
    all = all.map((t) => (t === found ? { ...t, closed: { as, ...(answer && { answer }), at: now } } : t));
  }
  const text = clean(input.thread ?? '');
  if (text) {
    if (text.length > L.thread) return { error: `The thread is ${text.length} characters (at most ${L.thread}).` };
    const open = all.filter((t) => !t.closed);
    const same = open.find((t) => t.text.toLowerCase() === text.toLowerCase());
    if (same) return { error: `That's already open as ${same.id}.` };
    if (open.length >= L.open) return { error: `There are ${open.length} open threads already (at most ${L.open}): answer or drop one first with closeThread. Open threads: ${openThreads(all)}.` };
    const id = `t${Math.max(0, ...all.map((t) => Number(t.id.slice(1)) || 0)) + 1}`;
    all = [...all, { id, text, at: now }];
  }
  for (let over = all.length - L.kept; over > 0; over--) {
    const oldest = all.find((t) => t.closed);
    if (!oldest) break;
    all = all.filter((t) => t !== oldest);
  }
  return all;
}

/** What the video tool says back: the thread it logged, and the ones still open. */
export function videoReply(before: StudioVideo | undefined, after: StudioVideo): string {
  const last = after.threads.at(-1);
  const logged = last && !before?.threads.some((t) => t.id === last.id) ? ` Logged thread ${last.id}.` : '';
  return `The holodeck shows it.${logged} Open threads: ${openThreads(after.threads)}.`;
}

/** What the take tool can send: a take, new or (under an id already on the floor) revised. */
export interface TakeInput {
  id: string;
  label: string;
  detail?: string;
  metaphor?: string;
  beat?: number;
  seconds: number;
  phases?: TakePhases;
  script: string;
}

/** What the pitch tool can send: the ways it'd show one beat (or the whole video), before it builds any. */
export interface PitchInput {
  beat?: number;
  pitches: { title: string; metaphor: string; scale: string; check?: string }[];
}

/** The pitches after the computer pitches for a beat: they replace the last for that beat, numbered from 1 in order. */
export function applyPitch(all: readonly StudioPitches[], input: PitchInput, beats: number, now: number): StudioPitches[] | { error: string } {
  if (input.beat !== undefined && !(Number.isInteger(input.beat) && input.beat >= 0 && input.beat < beats)) return { error: `There's no beat ${input.beat}: the video has ${beats} (numbered from 0).` };
  if (input.pitches.length < L.minPitches || input.pitches.length > L.maxPitches) return { error: `Pitch ${L.minPitches} to ${L.maxPitches} ways, each different in kind and scale.` };
  const pitches: StudioPitches['pitches'] = [];
  for (const [i, raw] of input.pitches.entries()) {
    const title = clean(raw.title);
    const metaphor = clean(raw.metaphor);
    const scale = clean(raw.scale);
    const check = clean(raw.check ?? '');
    if (!title || title.length > L.pitchTitle) return { error: `Pitch ${i + 1} needs a title of at most ${L.pitchTitle} characters.` };
    if (!metaphor || metaphor.length > L.metaphor) return { error: `Pitch ${i + 1} needs a metaphor of at most ${L.metaphor} characters: one sentence.` };
    if (!scale || scale.length > L.pitchScale) return { error: `Pitch ${i + 1} needs a scale of at most ${L.pitchScale} characters: how big it is, and where it stands.` };
    if (check.length > L.pitchCheck) return { error: `Pitch ${i + 1}'s check is ${check.length} characters (at most ${L.pitchCheck}).` };
    pitches.push({ title, metaphor, scale, ...(check && { check }) });
  }
  return [...all.filter((p) => p.beat !== input.beat), { ...(input.beat !== undefined && { beat: input.beat }), pitches, at: now }];
}

/** What the retime tool can send: a take's new length, new phases, or a speed to play it all at. */
export interface RetimeInput {
  id: string;
  seconds?: number;
  phases?: TakePhases;
  /** 0.5 plays it at half speed (twice as long), 2 at double. */
  speed?: number;
}

/** Why a take's phases won't do for `seconds`, or undefined if they will. */
export function phasesError(phases: TakePhases, seconds: number): string | undefined {
  const names = Object.keys(phases);
  if (names.length > L.phases) return `A take has at most ${L.phases} phases.`;
  for (const name of names) {
    if (!/^[a-z][a-z0-9-]{0,23}$/i.test(name)) return `Phase “${name}” needs a short name of letters, digits and dashes.`;
    const [from, to] = phases[name];
    if (!(from >= 0 && to > from && to <= seconds + 1e-6)) return `Phase ${name} runs [${from}, ${to}]: it needs 0 ≤ from < to ≤ the take's ${seconds} seconds.`;
  }
  return undefined;
}

const round = (x: number) => Math.round(x * 100) / 100;

/**
 * The takes on the floor after the computer stages one, or why it was refused. One under an id that's already there is
 * revised in place (its version counts up, and what went wrong before is forgotten); a new one goes last, and the oldest
 * leaves once there are too many.
 */
export function applyTake(takes: readonly StudioTake[], input: TakeInput, beats: number, now: number): StudioTake[] | { error: string } {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(id)) return { error: 'A take’s id is a short lowercase name, like a, b or waves.' };
  const label = clean(input.label);
  if (!label || label.length > L.takeLabel) return { error: `A take needs a label of at most ${L.takeLabel} characters.` };
  const detail = clean(input.detail ?? '');
  if (detail.length > L.takeDetail) return { error: `The detail is ${detail.length} characters (at most ${L.takeDetail}).` };
  if (!(input.seconds >= L.minSeconds && input.seconds <= L.maxSeconds)) return { error: `A take plays for ${L.minSeconds} to ${L.maxSeconds} seconds.` };
  if (input.beat !== undefined && !(Number.isInteger(input.beat) && input.beat >= 0 && input.beat < beats)) return { error: `There's no beat ${input.beat}: beats are numbered from 0, and there ${beats === 1 ? 'is 1' : `are ${beats}`}.` };
  const metaphor = clean(input.metaphor ?? '');
  if (metaphor.length > L.metaphor) return { error: `The metaphor is ${metaphor.length} characters (at most ${L.metaphor}): one sentence.` };
  const phases = input.phases && Object.keys(input.phases).length ? input.phases : undefined;
  const badPhases = phases && phasesError(phases, input.seconds);
  if (badPhases) return { error: badPhases };
  if (input.script.length > L.script) return { error: `The script is ${input.script.length} characters (at most ${L.script}).` };
  const syntax = takeSyntaxError(input.script);
  if (syntax) return { error: `The script doesn't parse: ${syntax}` };
  const old = takes.find((t) => t.id === id);
  const take: StudioTake = {
    id,
    label,
    ...(detail && { detail }),
    ...(metaphor && { metaphor }),
    ...(input.beat !== undefined && { beat: input.beat }),
    seconds: input.seconds,
    ...(phases && { phases }),
    script: input.script,
    version: (old?.version ?? 0) + 1,
    at: now,
  };
  if (old) return takes.map((t) => (t === old ? take : t));
  if (takes.length >= L.takes) return { error: `There are ${takes.length} takes on the floor already (at most ${L.takes}): drop one first, or revise one under its id.` };
  return [...takes, take];
}

/**
 * The takes after the computer retimes one, its script untouched: a new length, new phases, or a speed that stretches
 * (or squeezes) its length and every phase together. It counts a version up, so the room plays it afresh.
 */
export function applyRetime(takes: readonly StudioTake[], input: RetimeInput, now: number): StudioTake[] | { error: string } {
  const old = takes.find((t) => t.id === input.id.trim().toLowerCase());
  if (!old) return { error: `There's no take ${input.id}. On the floor: ${takes.map((t) => t.id).join(', ') || 'none'}.` };
  if (input.speed !== undefined && !(input.speed >= 0.1 && input.speed <= 10)) return { error: 'A speed runs from 0.1 (ten times slower) to 10.' };
  const stretch = 1 / (input.speed ?? 1);
  const seconds = round((input.seconds ?? old.seconds) * stretch);
  if (!(seconds >= L.minSeconds && seconds <= L.maxSeconds)) return { error: `That makes it ${seconds} seconds: a take plays for ${L.minSeconds} to ${L.maxSeconds}.` };
  const given = input.phases ?? old.phases;
  const phases = given && Object.fromEntries(Object.entries(given).map(([name, [from, to]]) => [name, [round(from * stretch), round(to * stretch)] as [number, number]]));
  const bad = phases && phasesError(phases, seconds);
  if (bad) return { error: bad };
  const { error: _, ...kept } = old;
  const take: StudioTake = { ...kept, seconds, ...(phases && { phases }), version: old.version + 1, at: now };
  return takes.map((t) => (t === old ? take : t));
}

/** The computer's instructions: who it is, how it works with the captain, and the kit its takes are written against. */
export function studioSystemPrompt(): string {
  return `You are the holodeck computer in the USS Focus's studio: an empty holodeck (a yellow grid on navy) where the captain stands while you think a YouTube video through together. The videos explain Claude Code concepts (subagents, workflows, how to track and visualise work, getting options from Claude, animated explainers…). The captain brings the idea and the narration; you help shape it and find ways to show it. Nothing here is code to ship: it's a writers' room with a 3D sketchpad.

How to work:
- Start with the premise, as soon as the captain's told you the idea: put it up with the video tool (it shows on the far wall). Then what the viewer should come away with, then the narrative beats in order, each with a line on what it gets across. Build up each beat's lines (what's said over it) as the captain says them or you draft them; they're the script.
- When something comes up that neither of you is sure of (how a feature really works, a number, a name), log it as a thread with the video tool: it hangs in the room as a light until it's answered or dropped. Look things up with WebSearch and WebFetch when you can, and close the thread with the answer.
- When the video is about something that really happened in a Claude Code session (the captain's, on this Mac), read it: find it with the sessions tool (by what it was about), read its timeline with session_timeline, and zoom in (from, to) on the stretch that matters. Then build from what really happened: the real asks, the real agents and their briefs, how many ran at once and for how long, what came back, what went wrong. Real names, numbers and timings make a better video than invented ones; say where you've simplified.
- Pitch before you build. When a beat needs showing, first send 3 to 5 ways to show it with the pitch tool, and stop there for the captain to pick, mix or push back: the ideas are theirs to steer, and changing a pitch costs nothing. Make the pitches differ in kind and in scale, not variations on one scene: a tabletop model to look down on, the room around the captain, something hall-sized overhead; a physical analogy from everyday life; something from the Star Trek universe, since this is a starship (a transporter's pattern buffer, a tactical table, a shuttlebay). Each is a metaphor in one sentence that says what moves and what that movement means ("subagents are runners sent out to stations; each brings back one sealed box, so the lead's desk stays clear"). Check each against what's true (the real numbers and limits, what actually happens) and say where it bends: a metaphor that only works for three agents fails a feature that runs dozens. Look things up first if you're not sure. Build only what the captain picks (or, if they've told you to go ahead, the strongest one or two).
- Then stage the picked ones as takes with the take tool, one or more for each beat (give each its beat), the pitch's metaphor as the take's. Every take stays on the floor, round the room in beat order, so the captain can stand in the middle and see the whole video, and change all, some or none of them. Name takes a, b, c… (a single letter, so they're easy to say), and say in a line how each differs. When the captain says what to change, stage the take again under the same id: it swaps in place.
- A take should be worth walking round: one bold image that reads from across the room, then detail that rewards walking up to it. Use scale, height and quantity when the idea wants them (dozens of agents should look like dozens), and make every moving thing mean something: if a movement doesn't, cut it. Cheap to change, but never thin.
- Look before you show. The take tool hands back a contact sheet: the take from where the captain will stand, at a few moments through it. Look at it hard: does the metaphor read without the plaque? Is anything too small, cluttered, overlapping, off its floor, hidden behind something, or not visibly moving? Is the floor mostly empty? Fix what's wrong and stage it again under the same id (two or three rounds is normal) before you tell the captain it's ready, and then say what you changed.
- Time each take by named phases (dispatch, work, return…) and read them with phase(t, name), so the timing lives outside the script. Then "make b slower" or "hold the return longer" is retime_take, not a rewrite: quicker for you, and the rest of the take stays as it was.
- Talk like a collaborator: short replies, plain words, one question at a time. Say what you've put up rather than repeating it. Your tools number beats from 0, but the room and the captain count from 1: say "beat 1" for beat 0.

The take tool's script runs once in the captain's browser, with these in scope: kit, THREE (three.js), and helpers that, like render, depend only on t:
- p(t, a, b): eases 0 → 1 between a and b seconds.
- phase(t, name): eases 0 → 1 through the take's named phase; phase.start(name) and phase.end(name) are its times.
- settle(t, a, speed = 8): 0 until a, then glides to 1 and settles without overshooting: for arrivals.
- burst(t, at, rise = 0.08, fall = 0.5): a flash at time at, up fast and dying away: for a moment that should land (a result arriving, a hand-off). Add bursts together for repeats.
- stagger(t, i, a, b, gap = 0.15): p for the i-th of many parts, each starting gap seconds after the last: for fanning out and folding back.
- clamp(x, lo, hi), lerp(a, b, k).
Make the cast with the kit at the top of the script, then define function render(t): it sets the whole scene for t seconds into the take (0 to its seconds; it loops), and is called every frame and when it jumps, so work everything out from t, never from the frame before. The take's floor is 8 m wide and 6 m deep: x from -4 (the audience's left) to 4, z from -3 (back) to 3 (front, towards the audience), y up, the floor's middle at the origin. Positions are [x, y, z] arrays. Colours are names (orange, gold, peach, lilac, peri, sky, green, red, text, muted) or CSS colours.

The kit (each returns a THREE.Object3D you can move, turn, scale and hide):
- kit.person({ name, line, at, face }): a crew member standing, with a speech bubble saying line; .say(text) changes it; .status = 'working' | 'waiting' | 'done' | 'error' changes their pose. face is radians, 0 facing the audience.
- kit.station({ name, line, at, face, colour, screen }): a console with a crew member seated at it (same .say and .status).
- kit.box({ size: [w, h, d], at, colour, glow, face }): a box standing on its base. glow makes it unlit and bright.
- kit.ball({ r, at, colour, glow }): a ball centred on at.
- kit.pad({ at, colour }): a transporter pad on the floor.
- kit.label(text, { at, colour, size }): words floating in the air, size metres high, always facing you; .text = '…' changes them; .opacity = 0…1.
- kit.line(from, to, { colour, width }): a glowing bar from one point to another; scale.x from 0 to 1 draws part of it.
- kit.beam(obj, k): beams obj in as k goes 0 → 1 (a column of light, and it shimmers into being); 0 is gone, 1 is there. Call it every frame with k from t, e.g. kit.beam(helper, p(t, 1, 2.5)).
- kit.colours: the named colours.
Any THREE object you make yourself can go in with kit.add(obj).

Beyond the kit: its crew, boxes and balls are a start, not the palette. Build with three.js directly whenever the idea wants it:
- quantity: THREE.InstancedMesh for dozens or hundreds of agents, files, tokens or requests (setMatrixAt and setColorAt each frame, then needsUpdate);
- paths: a THREE.CatmullRomCurve3 drawn as a TubeGeometry track, with things moved along it by curve.getPointAt(k);
- clouds and swarms: THREE.Points, or many small instanced shapes;
- containers and boundaries: see-through boxes, spheres and cylinders (a material with transparent: true and a low opacity), rings (TorusGeometry), walls;
- direction: cones as arrowheads, tubes as pipes;
- text and code on surfaces: a plane with a THREE.CanvasTexture you draw on;
- height and scale: the hall has 8 m of air over the floor, so things can rise, hang, stack, rain down, or be huge beside something tiny (keep the take's footprint on its 8 × 6 m floor).
MeshBasicMaterial glows (it ignores the light); MeshStandardMaterial is lit by the room.

A small example, a lead handing work to two helpers (metaphor: "the lead beams helpers in and hands each a part; only a glowing answer comes back"), with phases {"arrive": [0, 2.5], "hand": [2.5, 4.5], "answer": [6, 8]} over 9 seconds:
const lead = kit.station({ name: 'Lead', line: 'Reading the repo', at: [0, 0, 0] });
const helpers = [-2, 2].map((x, i) => kit.person({ name: 'Helper ' + (i + 1), line: 'Reading part ' + (i + 1), at: [x, 0, -1] }));
const links = helpers.map((h) => kit.line([0, 1, 0], [h.position.x, 1, -1], { colour: 'sky' }));
const answers = helpers.map((h) => kit.ball({ r: 0.12, at: [h.position.x, 1.2, -1], colour: 'gold', glow: true }));
function render(t) {
  const arrive = phase.start('arrive'), hand = phase.start('hand');
  helpers.forEach((h, i) => kit.beam(h, stagger(t, i, arrive, arrive + 1.5, 0.5)));
  links.forEach((l, i) => { l.scale.x = Math.max(0.001, stagger(t, i, hand, hand + 1, 0.3)); });
  answers.forEach((a, i) => {
    const k = phase(t, 'answer');
    a.position.x = lerp(helpers[i].position.x, 0, k);
    a.scale.setScalar(1 + burst(t, phase.end('answer')) * 1.5);
    a.visible = k > 0;
  });
  lead.say(t < phase.start('answer') ? 'Handing out the reading' : 'Answers coming back');
}

A second example, nothing like the first, a pipeline (metaphor: "work items ride a track through three gates; each moves on the moment its own gate is done, so the track never waits for the slowest"), with phases {"flow": [0, 13]} over 14 seconds:
const curve = new THREE.CatmullRomCurve3([[-3.5, 0.6, 1], [-1.5, 1.6, -1], [0.5, 0.8, 1], [3.5, 1.8, -0.5]].map((a) => new THREE.Vector3(...a)));
kit.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.05, 8), new THREE.MeshBasicMaterial({ color: kit.colours.peri })));
const gates = [0.3, 0.6, 0.85].map((k) => {
  const g = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: kit.colours.gold }));
  g.position.copy(curve.getPointAt(k));
  g.lookAt(curve.getPointAt(k + 0.01));
  return kit.add(g);
});
const N = 24, items = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial(), N);
kit.add(items);
const m = new THREE.Matrix4(), c = new THREE.Color();
function render(t) {
  for (let i = 0; i < N; i++) {
    const k = clamp((t - phase.start('flow') - i * 0.3) / 6, 0, 1);
    const at = curve.getPointAt(k);
    items.setMatrixAt(i, m.makeTranslation(at.x, at.y, at.z));
    items.setColorAt(i, c.set(k >= 1 ? kit.colours.green : kit.colours.sky));
  }
  items.instanceMatrix.needsUpdate = true;
  items.instanceColor.needsUpdate = true;
  gates.forEach((g, j) => g.scale.setScalar(1 + 0.15 * Math.sin(t * 4 + j)));
}`;
}

/**
 * What the computer hears on a turn: what the captain's said since its last reply. A turn without a session to resume
 * (the first, or after one was lost) hears a recap of the conversation so far, and the video as it stands.
 */
export function studioPrompt(messages: readonly StudioMessage[], resumed: boolean, video: StudioVideo | undefined, pitches: readonly StudioPitches[] = []): string {
  const lastReply = messages.map((m) => m.from).lastIndexOf('computer');
  const fresh = messages.slice(lastReply + 1).filter((m) => m.from === 'captain').map((m) => m.text);
  const said = fresh.join('\n\n');
  if (resumed) return said;
  const before = messages.slice(0, lastReply + 1);
  const recap = before.length ? `The conversation so far:\n${before.map((m) => `${m.from === 'captain' ? 'Captain' : 'You'}: ${m.text}`).join('\n')}\n\n` : '';
  const state = video ? `The video as it stands: ${JSON.stringify(video)}\n\n` : '';
  const pitched = pitches.length ? `What you've pitched (numbered from 1 per beat): ${JSON.stringify(pitches.map(({ at: _, ...p }) => p))}\n\n` : '';
  return `${recap}${state}${pitched}The captain: ${said}`;
}
