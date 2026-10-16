// Dictation and the crew's voices.

/** A speech model download in progress, or the last one that failed. */
export type VoiceDownload = { state: 'running'; bytes: number; total?: number } | { state: 'failed'; error: string };

/**
 * Kokoro, the crew's voices: idle until voice mode (or Settings) asks for it, then loading (downloading
 * the model first, once) and ready, or failed.
 */
export type SpeechEngine =
  | { state: 'idle' }
  | { state: 'loading'; bytes: number; total?: number }
  /** `on`: where it runs, the Apple GPU or the CPU. */
  | { state: 'ready'; on?: 'gpu' | 'cpu' }
  | { state: 'failed'; error: string };

export interface SpeechStatus {
  /** Whether the model is on this machine, in `path`. */
  downloaded: boolean;
  path: string;
  engine: SpeechEngine;
}

/** Whether dictation can run (whisper.cpp's CLI and its model, both on this machine), and the crew's voices. */
export interface VoiceStatus {
  /** `command` is the resolved path when found, otherwise what was looked for. */
  whisper: { found: boolean; command: string };
  model: { present: boolean; path: string };
  download?: VoiceDownload;
  speech: SpeechStatus;
}
