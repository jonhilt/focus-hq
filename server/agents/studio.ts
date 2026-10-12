// The studio holodeck's computer (studioComputer.ts): the pure decisions behind its tools, and what it's told. The
// video it builds up with the captain (premise, narrative beats with their lines, loose threads) and the takes it stages
// on the holodeck's floor, rough 3D sketches written against the studio's kit (client/src/world/takeKit.ts).

import type { StudioMessage, StudioTake, StudioThread, StudioVideo } from '../../shared/types';
import { takeSyntaxError } from '../../shared/takeScript';

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
  takes: 6,
  takeLabel: 40,
  takeDetail: 200,
  script: 16_000,
  minSeconds: 2,
  maxSeconds: 60,
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
  beat?: number;
  seconds: number;
  script: string;
}

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
  if (input.script.length > L.script) return { error: `The script is ${input.script.length} characters (at most ${L.script}).` };
  const syntax = takeSyntaxError(input.script);
  if (syntax) return { error: `The script doesn't parse: ${syntax}` };
  const old = takes.find((t) => t.id === id);
  const take: StudioTake = { id, label, ...(detail && { detail }), ...(input.beat !== undefined && { beat: input.beat }), seconds: input.seconds, script: input.script, version: (old?.version ?? 0) + 1, at: now };
  if (old) return takes.map((t) => (t === old ? take : t));
  return [...takes, take].slice(-L.takes);
}

/** The computer's instructions: who it is, how it works with the captain, and the kit its takes are written against. */
export function studioSystemPrompt(): string {
  return `You are the holodeck computer in the USS Focus's studio: an empty holodeck (a yellow grid on navy) where the captain stands while you think a YouTube video through together. The videos explain Claude Code concepts (subagents, workflows, how to track and visualise work, getting options from Claude, animated explainers…). The captain brings the idea and the narration; you help shape it and find ways to show it. Nothing here is code to ship: it's a writers' room with a 3D sketchpad.

How to work:
- Start with the premise, as soon as the captain's told you the idea: put it up with the video tool (it shows on the far wall). Then what the viewer should come away with, then the narrative beats in order, each with a line on what it gets across. Build up each beat's lines (what's said over it) as the captain says them or you draft them; they're the script.
- When something comes up that neither of you is sure of (how a feature really works, a number, a name), log it as a thread with the video tool: it hangs in the room as a light until it's answered or dropped. Look things up with WebSearch and WebFetch when you can, and close the thread with the answer.
- Try ways of showing a beat early, while they're cheap: stage two or three rough takes with the take tool, side by side on the floor, each a different idea (crew and consoles, abstract shapes, cards on a conveyor…), and say in a line how each differs. When the captain says what to change ("make b slower", "try it with one wave at a time"), stage the take again under the same id: it swaps in place. Keep takes rough and quick; a take is a sketch, not a shot.
- Talk like a collaborator: short replies, plain words, one question at a time. Say what you've put up rather than repeating it.

The take tool's script runs once in the captain's browser, with these in scope: kit, THREE (three.js), p(t, a, b) (eases 0 → 1 between a and b seconds), clamp(x, lo, hi), lerp(a, b, k). Make the cast with the kit at the top of the script, then define function render(t): it sets the whole scene for t seconds into the take (0 to its seconds; it loops), and is called every frame and when it jumps, so work everything out from t, never from the frame before. The take's floor is 6 m wide and 5 m deep: x from -3 (the audience's left) to 3, z from -2.5 (back) to 2.5 (front, towards the audience), y up, the floor's middle at the origin. Positions are [x, y, z] arrays. Colours are names (orange, gold, peach, lilac, peri, sky, green, red, text, muted) or CSS colours.

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

A small example, a lead handing work to two helpers:
const lead = kit.station({ name: 'Lead', line: 'Reading the repo', at: [0, 0, 0] });
const helpers = [-2, 2].map((x, i) => kit.person({ name: 'Helper ' + (i + 1), line: 'Reading part ' + (i + 1), at: [x, 0, -1] }));
const links = helpers.map((h) => kit.line([0, 1, 0], [h.position.x, 1, -1], { colour: 'sky' }));
function render(t) {
  helpers.forEach((h, i) => kit.beam(h, p(t, 1 + i * 0.5, 2.5 + i * 0.5)));
  links.forEach((l, i) => { l.scale.x = Math.max(0.001, p(t, 3 + i * 0.3, 4 + i * 0.3)); });
  lead.say(t < 5 ? 'Handing out the reading' : 'Answers coming back');
}`;
}

/**
 * What the computer hears on a turn: what the captain's said since its last reply. A turn without a session to resume
 * (the first, or after one was lost) hears a recap of the conversation so far, and the video as it stands.
 */
export function studioPrompt(messages: readonly StudioMessage[], resumed: boolean, video: StudioVideo | undefined): string {
  const lastReply = messages.map((m) => m.from).lastIndexOf('computer');
  const fresh = messages.slice(lastReply + 1).filter((m) => m.from === 'captain').map((m) => m.text);
  const said = fresh.join('\n\n');
  if (resumed) return said;
  const before = messages.slice(0, lastReply + 1);
  const recap = before.length ? `The conversation so far:\n${before.map((m) => `${m.from === 'captain' ? 'Captain' : 'You'}: ${m.text}`).join('\n')}\n\n` : '';
  const state = video ? `The video as it stands: ${JSON.stringify(video)}\n\n` : '';
  return `${recap}${state}The captain: ${said}`;
}
