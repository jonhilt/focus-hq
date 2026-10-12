// The studio's narration (docs/studio.md): the presenter's takes, the parts kept, and the words on one timeline. A
// narration file (scenes/<name>.narration.yaml) names the takes and the spans of each to keep; `assemble` turns those
// into the cuts to make (dropping fillers like "um" and shortening long pauses) and the words' times in the result, and
// `beatsFromWords` groups the words into beats for a shot plan. Pure, so it's testable; the recorder does the I/O.

import type { Beat } from './stagePlan';

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface NarrationSpec {
  /** Each take's video file, by name. */
  takes: Record<string, string>;
  /** The spans to keep, in order: seconds into their take. */
  keep: { take: string; from: number; to: number; why?: string }[];
  /** Words dropped wherever they fall. */
  fillers?: string[];
  /** The longest a pause between words may run, in seconds; longer ones are shortened to it. */
  maxPause?: number;
}

/** One cut: `from`–`to` seconds of a take, landing at `at` in the narration. */
export interface Cut {
  take: string;
  from: number;
  to: number;
  at: number;
}

const DEFAULT_FILLERS = ['um', 'uh', 'erm', 'er'];

/** A whisper.cpp full JSON transcript (`-ojf`) as words: tokens that start with a space start a word. */
export function wordsFromWhisper(json: unknown): Word[] {
  const words: Word[] = [];
  const segments = (json as { transcription?: { tokens?: { text: string; offsets: { from: number; to: number } }[] }[] }).transcription ?? [];
  for (const segment of segments) {
    for (const token of segment.tokens ?? []) {
      if (token.text.startsWith('[_')) continue;
      const start = token.offsets.from / 1000;
      const end = token.offsets.to / 1000;
      const last = words.at(-1);
      if (token.text.startsWith(' ') || !last) words.push({ text: token.text.trim(), start, end });
      else {
        last.text += token.text;
        last.end = end;
      }
    }
  }
  return words.filter((w) => w.text);
}

const bare = (text: string) => text.toLowerCase().replace(/[^a-z']/g, '');

/**
 * The cuts that make the narration, and its words on the narration's clock. Within each kept span, fillers are cut
 * out, and pauses longer than `maxPause` are shortened to it, by splitting the span round them.
 */
export function assemble(spec: NarrationSpec, wordsByTake: Record<string, Word[]>): { cuts: Cut[]; words: Word[] } {
  const fillers = new Set((spec.fillers ?? DEFAULT_FILLERS).map(bare));
  const maxPause = spec.maxPause ?? 0.6;
  // a breath either side of each run of words, so cuts don't clip them
  const pad = Math.min(0.15, maxPause / 4);
  const cuts: Cut[] = [];
  const words: Word[] = [];
  let at = 0;
  for (const k of spec.keep) {
    const all = wordsByTake[k.take];
    if (!all) throw new Error(`There's no take called ${k.take}`);
    // a word that starts inside the span is kept (whisper often stretches a word's end over the pause after it)
    const kept = all.filter((w) => w.start >= k.from && w.start < k.to && !fillers.has(bare(w.text)));
    // runs of words with no pause longer than maxPause (or a filler) between them
    const runs: Word[][] = [];
    for (const w of kept) {
      const run = runs.at(-1);
      const previous = run?.at(-1);
      const skipped = previous && all.some((x) => x.start > previous.start && x.start < w.start && fillers.has(bare(x.text)));
      if (run && previous && w.start - previous.end <= maxPause && !skipped) run.push(w);
      else runs.push([w]);
    }
    for (const run of runs) {
      const from = Math.max(k.from, run[0].start - pad);
      const to = Math.min(k.to, run.at(-1)!.end + pad);
      cuts.push({ take: k.take, from, to, at });
      for (const w of run) words.push({ text: w.text, start: at + (w.start - from), end: at + (Math.min(w.end, to) - from) });
      at += to - from;
    }
  }
  return { cuts, words };
}

/**
 * The words as beats: a new beat after a sentence's end or a pause, or once a beat runs long. Each beat lists its
 * words' starts (as `w0`, `w1`…) for a director to name its stressed ones.
 */
export function beatsFromWords(words: Word[], { pause = 0.45, longest = 12 } = {}): (Beat & { words: [string, number][] })[] {
  const beats: (Beat & { words: [string, number][] })[] = [];
  let current: Word[] = [];
  const close = () => {
    if (!current.length) return;
    const id = `b${beats.length + 1}`;
    beats.push({ id, at: current[0].start, end: current.at(-1)!.end, text: current.map((w) => w.text).join(' '), words: current.map((w) => [w.text, Number(w.start.toFixed(2))]) });
    current = [];
  };
  for (const [i, w] of words.entries()) {
    current.push(w);
    const next = words[i + 1];
    const sentence = /[.!?]$/.test(w.text);
    if (!next || sentence || next.start - w.end > pause || w.end - current[0].start > longest) close();
  }
  return beats;
}
