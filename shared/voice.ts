import { replyPart } from './termText';
import type { TermLine, VoiceStatus } from './types';

export const WHISPER_INSTALL = 'brew install whisper-cpp';

/** The Kokoro voices the crew speak in: a is American, b British; f and m the voice's pitch range. */
export const KOKORO_VOICES = ['af_heart', 'af_bella', 'am_michael', 'am_puck', 'am_fenrir', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_fable'] as const;
export type KokoroVoice = (typeof KOKORO_VOICES)[number];

export const isKokoroVoice = (v: unknown): v is KokoroVoice => KOKORO_VOICES.some((k) => k === v);

/** Who among the core's crew speaks aloud (a plugin's crew bring a `CrewVoice` of their own). */
export type CrewSpeaker = 'officer' | 'qa' | 'engineer';

/** A crew member's voice: Kokoro's, and how the browser's built-in voice stands in for it while Kokoro isn't ready. */
export interface CrewVoice {
  kokoro: KokoroVoice;
  lang: 'en-US' | 'en-GB';
  /** For the browser's voice, which may be the same voice for everyone: a pitch of their own keeps them apart. */
  pitch: number;
}

/** Why dictation can't run yet, worded for a mic button's tooltip; undefined once it can. */
export function voiceMissing(status: VoiceStatus | null): string | undefined {
  if (!status) return 'Voice input: connecting…';
  const missing = [!status.whisper.found && 'whisper-cli', !status.model.present && 'the speech model'].filter(Boolean);
  if (!missing.length) return undefined;
  return `Voice input needs ${missing.join(' and ')}. Set it up in the ready room: Settings, Voice input.`;
}

const CODE_EXTENSIONS = 'ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|rb|go|rs|java|kt|cs|swift|sql|yml|yaml|toml|sh|vue|svelte';
/** Code and anything path-like: fenced blocks, `inline code`, tokens with a slash, file names, calls. */
const UNSPEAKABLE = [/```[\s\S]*?```/g, /`[^`]*`/g, /\S*[/\\]\S*/g, new RegExp(`\\b[\\w.-]+\\.(?:${CODE_EXTENSIONS})\\b`, 'g'), /\b\w+\(\)/g];
const SPOKEN_SENTENCES = 2;

/** Text as it should be read aloud: without code, paths or Markdown marks. */
export function forSpeech(text: string): string {
  return UNSPEAKABLE.reduce((t, pattern) => t.replace(pattern, ' '), text)
    .replace(/[*_#>~|[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[,.;:!?])/g, '')
    .trim();
}

const firstSentences = (text: string) =>
  (text.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) ?? []).slice(0, SPOKEN_SENTENCES).join(' ').replace(/\s+/g, ' ').trim();

/**
 * The line an officer's reply is spoken as: the line they gave for it, made speakable, in at most two sentences. If
 * they gave none (or nothing speakable is left), the reply's question, or failing that its opening.
 */
export function spokenLine(spoken: string | undefined, text: string): string | undefined {
  const given = firstSentences(forSpeech(spoken ?? ''));
  if (given) return given;
  const question = text.match(/[^.!?\n]*\?/g)?.at(-1);
  return firstSentences(forSpeech(question ?? text)) || undefined;
}

export interface CrewLine<S extends string = CrewSpeaker> {
  speaker: S;
  text: string;
}

/** Whether a message is the crew's, not the captain's or the office's. */
const crewSaid = <S extends string>(from: S): from is Exclude<S, 'manager' | 'system'> => from !== 'manager' && from !== 'system';

/**
 * What the crew say aloud among the messages from index `from` on, in log order: an officer's reply as its spoken
 * line; QA's notes, the engineer's recommendation and the office's fixed officer lines as they are.
 */
export function linesToSpeak<S extends string>(messages: { from: S; text: string; spoken?: string }[], from: number): CrewLine<Exclude<S, 'manager' | 'system'>>[] {
  return messages.slice(from).flatMap((m) => {
    const speaker = m.from;
    if (!crewSaid(speaker)) return [];
    const text = forSpeech(m.spoken ?? m.text);
    return text ? [{ speaker, text }] : [];
  });
}

/**
 * The replies in a batch of an agent's terminal lines, each as it should be read aloud: tool calls, their output and
 * the manager's own lines left out, and a reply that carries on from the last batch (no start) said on its own.
 */
export function repliesToSpeak(lines: TermLine[]): string[] {
  const replies: string[][] = [];
  for (const line of lines) {
    const part = replyPart(line);
    if (!part) continue;
    const last = replies.at(-1);
    if (part.start || !last) replies.push([part.text]);
    else last.push(part.text);
  }
  return replies.map((reply) => forSpeech(reply.join('\n'))).filter(Boolean);
}
