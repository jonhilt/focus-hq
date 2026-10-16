import type { SpeechEngine } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';

/**
 * Whom a line goes to: Kokoro once it's ready, a wait while it loads (or before it's been asked to), and the browser's
 * voice only once Kokoro has failed. A line never falls back to the browser just because Kokoro is slow.
 */
export function speechRoute(engine: SpeechEngine | undefined): 'kokoro' | 'wait' | 'browser' {
  switch (engine?.state) {
    case 'ready':
      return 'kokoro';
    case 'failed':
      return 'browser';
    default:
      // idle, loading, or no word from the office yet
      return 'wait';
  }
}

/** Resolves true once Kokoro is ready, asking the office to load it if it's idle; false once it's failed (or `signal` aborts). */
export function kokoroReady(signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let asked = false;
    const check = (): boolean => {
      const engine = state.voice?.speech.engine;
      const route = speechRoute(engine);
      if (route !== 'wait') {
        resolve(route === 'kokoro');
        return true;
      }
      if (engine?.state === 'idle' && !asked) {
        asked = true;
        void api.loadSpeech().catch(() => undefined);
      }
      return false;
    };
    if (check()) return;
    const unsubscribe = state.on('voice', () => void (check() && unsubscribe()));
    signal?.addEventListener('abort', () => {
      unsubscribe();
      resolve(false);
    });
  });
}

/** The words in a voice's name that mark the better of the system's voices (macOS's downloaded ones, Edge's neural ones). */
const BETTER = /premium|enhanced|natural|neural/i;
/** macOS's novelty voices and its old synthesised ones (Fred is the "robot"), worst of all for reading a line aloud. */
const ROBOTIC = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|fred|good news|jester|junior|kathy|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox)\b/i;

/**
 * The best of the browser's voices for a language, for when Kokoro can't speak: a premium or neural voice if there is
 * one, then one in the right accent, then any in the language, never a novelty or robotic one. Null leaves it to the browser.
 */
export function bestBrowserVoice<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>>(voices: readonly V[], lang: string): V | null {
  const base = lang.split('-')[0];
  const speaking = voices.filter((v) => v.lang.replace('_', '-').split('-')[0] === base && !ROBOTIC.test(v.name));
  const score = (v: V) => (BETTER.test(v.name) ? 4 : 0) + (v.lang.replace('_', '-') === lang ? 2 : 0) + (v.localService ? 1 : 0);
  return speaking.reduce<V | null>((best, v) => (!best || score(v) > score(best) ? v : best), null);
}
