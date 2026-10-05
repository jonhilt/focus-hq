import { describe, expect, it } from 'vitest';
import { encodeWav, insertTranscript, toMono16k, WHISPER_RATE } from './speech';

describe('toMono16k', () => {
  it('averages the channels into one', () => {
    const out = toMono16k([Float32Array.from([1, 0.5]), Float32Array.from([0, -0.5])], WHISPER_RATE);
    expect([...out]).toEqual([0.5, 0]);
  });

  it('downsamples 48 kHz to 16 kHz by averaging each group of three', () => {
    const out = toMono16k([Float32Array.from([0.3, 0.6, 0.9, -0.3, -0.6, -0.9, 0])], 48_000);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(-0.6);
  });

  it('downsamples 44.1 kHz to the right length', () => {
    expect(toMono16k([new Float32Array(44_100)], 44_100)).toHaveLength(16_000);
  });

  it('upsamples 8 kHz by interpolating', () => {
    const out = toMono16k([Float32Array.from([0, 1, 0])], 8_000);
    expect([...out].slice(0, 4)).toEqual([0, 0.5, 1, 0.5]);
  });
});

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit PCM header and clamped samples', () => {
    const view = new DataView(encodeWav(Float32Array.from([0, 1, -1, 2])));
    const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(view.buffer, at, n));
    expect(text(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(text(8, 8)).toBe('WAVEfmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});

describe('insertTranscript', () => {
  it('fills an empty field', () => {
    expect(insertTranscript('', 0, 0, ' Fix the login page. ')).toEqual({ value: 'Fix the login page.', cursor: 19 });
  });

  it('spaces off from the text before and after the cursor', () => {
    expect(insertTranscript('Hello world', 5, 5, 'there')).toEqual({ value: 'Hello there world', cursor: 11 });
  });

  it('adds no extra space where there already is one', () => {
    expect(insertTranscript('Hello ', 6, 6, 'there')).toEqual({ value: 'Hello there', cursor: 11 });
  });

  it('leaves punctuation after the cursor attached', () => {
    expect(insertTranscript('Use the.', 7, 7, 'retry queue')).toEqual({ value: 'Use the retry queue.', cursor: 19 });
  });

  it('replaces the selection', () => {
    expect(insertTranscript('Use Redis here', 4, 9, 'Postgres')).toEqual({ value: 'Use Postgres here', cursor: 12 });
  });

  it('leaves the text alone when nothing was heard', () => {
    expect(insertTranscript('Keep me', 2, 4, '  ')).toEqual({ value: 'Keep me', cursor: 4 });
  });
});
