import type { VoiceStatus } from './types';

export const WHISPER_INSTALL = 'brew install whisper-cpp';

/** The Kokoro voices the crew speak in: a is American, b British; f and m the voice's pitch range. */
export const KOKORO_VOICES = ['af_heart', 'af_bella', 'am_michael', 'am_puck', 'am_fenrir', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_fable'] as const;
export type KokoroVoice = (typeof KOKORO_VOICES)[number];

export const isKokoroVoice = (v: unknown): v is KokoroVoice => KOKORO_VOICES.some((k) => k === v);

/** Who speaks aloud: the crew, and Number One in the ready room. */
export type CrewSpeaker = 'officer' | 'qa' | 'engineer' | 'number-one';

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
  return `Voice input needs ${missing.join(' and ')}. Set it up in the ready room: ⚙️ Settings → Voice input.`;
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

export interface CrewLine {
  speaker: CrewSpeaker;
  text: string;
}

/**
 * What the crew say aloud among the messages from index `from` on, in log order: an officer's reply as its spoken
 * line; QA's notes, the engineer's recommendation and the office's fixed officer lines as they are.
 */
export function linesToSpeak(messages: { from: CrewSpeaker | 'manager' | 'system'; text: string; spoken?: string }[], from: number): CrewLine[] {
  return messages.slice(from).flatMap((m) => {
    if (m.from === 'manager' || m.from === 'system') return [];
    const text = forSpeech(m.spoken ?? m.text);
    return text ? [{ speaker: m.from, text }] : [];
  });
}
