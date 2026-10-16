import { describe, expect, it } from 'vitest';
import { bestBrowserVoice, speechRoute } from './crewVoice';

describe('speechRoute', () => {
  it('speaks in Kokoro once it is ready', () => {
    expect(speechRoute({ state: 'ready' })).toBe('kokoro');
  });

  it('waits for Kokoro while it is idle, loading or not yet heard from, rather than using the browser voice', () => {
    expect(speechRoute({ state: 'idle' })).toBe('wait');
    expect(speechRoute({ state: 'loading', bytes: 10 })).toBe('wait');
    expect(speechRoute(undefined)).toBe('wait');
  });

  it('falls back to the browser voice only once Kokoro has failed', () => {
    expect(speechRoute({ state: 'failed', error: 'no' })).toBe('browser');
  });
});

const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService });

describe('bestBrowserVoice', () => {
  it('prefers a premium or enhanced voice over the default one', () => {
    const voices = [voice('Fred', 'en-US'), voice('Samantha', 'en-US'), voice('Ava (Premium)', 'en-US')];
    expect(bestBrowserVoice(voices, 'en-US')?.name).toBe('Ava (Premium)');
  });

  it('prefers the right accent among voices of the same quality', () => {
    const voices = [voice('Samantha', 'en-US'), voice('Daniel', 'en-GB')];
    expect(bestBrowserVoice(voices, 'en-GB')?.name).toBe('Daniel');
  });

  it('never picks a novelty voice, and takes another accent over none', () => {
    const voices = [voice('Zarvox', 'en-US'), voice('Bad News', 'en-US'), voice('Karen', 'en-AU')];
    expect(bestBrowserVoice(voices, 'en-US')?.name).toBe('Karen');
  });

  it('leaves it to the browser when no voice speaks the language', () => {
    expect(bestBrowserVoice([voice('Thomas', 'fr-FR')], 'en-US')).toBeNull();
  });
});
