// The decisions behind `pnpm run voice:check` (voiceCheck.ts), kept pure so they're tested next to it.
import { isRecord, type VoiceStatus } from '../../../plugin-api/server';

/** A 16-bit PCM WAV (Kokoro's, from either helper) as mono samples from -1 to 1, and its rate; undefined if it isn't one. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; rate: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') return undefined;
  let channels = 1;
  let rate = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = text(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (!rate) return undefined;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (channels * (bits / 8)));
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + (f * channels + c) * (bits / 8);
          sum += bits === 16 ? view.getInt16(at, true) / 32768 : bits === 32 ? view.getFloat32(at, true) : 0;
        }
        samples[f] = sum / channels;
      }
      return { samples, rate };
    }
    at = body + size + (size % 2);
  }
  return undefined;
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

/** How much of what was said whisper heard: the share of the line's words found in the transcript, from 0 to 1. */
export function heardShare(said: string, heard: string): number {
  const want = words(said);
  const got = new Set(words(heard));
  return want.length ? want.filter((w) => got.has(w)).length / want.length : 1;
}

/** One timed step of the check, and how long it may take before the check fails. */
export interface Step {
  name: string;
  ms: number;
  budgetMs: number;
  /** Anything worth saying beside it: who answered, what was heard. */
  note?: string;
  /** A step that couldn't be checked here (whisper in a demo office): shown, never failed. */
  skipped?: boolean;
}

/**
 * The budgets a conversation lives or dies by. A spoken line or a transcript slower than a few seconds, or a first
 * reply slower than people wait in a conversation, fails the check; the lead, who reads code, gets longer than the
 * quick answerer.
 */
export const BUDGETS = {
  speak: 3_000,
  transcribe: 10_000,
  quickReply: 15_000,
  leadReply: 60_000,
  firstSound: 3_000,
} as const;

/** The check's report, a line a step, and whether it passed: every step that ran within its budget. */
export function verdict(steps: readonly Step[], heard: number, minHeard = 0.7): { lines: string[]; pass: boolean } {
  const over = steps.filter((s) => !s.skipped && s.ms > s.budgetMs);
  const misheard = heard < minHeard;
  const lines = steps.map((s) => {
    const mark = s.skipped ? '–' : s.ms > s.budgetMs ? '✗' : '✓';
    return `${mark} ${s.name.padEnd(22)} ${(s.ms / 1000).toFixed(2).padStart(6)} s  (budget ${(s.budgetMs / 1000).toFixed(0)} s)${s.note ? `  ${s.note}` : ''}`;
  });
  lines.push(`${misheard ? '✗' : '✓'} heard ${Math.round(heard * 100)}% of the question's words${misheard ? ` (needs ${Math.round(minHeard * 100)}%)` : ''}`);
  return { lines, pass: !over.length && !misheard };
}

/** A response's body read as JSON, or what went wrong: the office's own error, or its status when the body isn't JSON. */
export function readResponse(route: string, res: Pick<Response, 'ok' | 'status' | 'statusText'>, text: string): { body: unknown } | { error: string } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (res.ok && body !== undefined) return { body };
  const said = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
  return { error: `${route}: ${said ?? `${res.status} ${res.statusText}${text ? `, ${text.slice(0, 200)}` : ''}`}` };
}

/** The lead and briefing to ask about: `lead` and `briefing` if given, or the first lead with something on their screen (their latest). */
export function pickBriefing<A extends { id: string; lead?: { artifacts?: readonly { id: string }[] } }>(agents: readonly A[], lead?: string, briefing?: string): { lead: A; briefing: string } | undefined {
  const leads = agents.filter((a) => a.lead?.artifacts?.length && (!lead || a.id === lead));
  const picked = leads.find((a) => a.lead?.artifacts?.some((x) => x.id === briefing)) ?? leads[0];
  const about = briefing ?? picked?.lead?.artifacts?.at(-1)?.id;
  return picked && about ? { lead: picked, briefing: about } : undefined;
}

/** Where Kokoro runs, once it's ready (` on the GPU`), or nothing to add. */
export const engineOn = (voice: VoiceStatus): string => (voice.speech.engine.state === 'ready' && voice.speech.engine.on ? ` on the ${voice.speech.engine.on.toUpperCase()}` : '');
