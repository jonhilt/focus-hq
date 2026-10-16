import { describe, expect, it } from 'vitest';
import { decodeWav, heardShare, verdict } from './voiceCheckRules';

/** A WAV of 16-bit PCM samples, as Kokoro's helpers write them. */
function wav(samples: number[], rate: number, channels = 1): Uint8Array {
  const data = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + data));
  const put = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  put(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, data, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return new Uint8Array(view.buffer);
}

describe('decodeWav', () => {
  it('reads 16-bit PCM as samples from -1 to 1, with its rate', () => {
    const out = decodeWav(wav([0, 16384, -32768], 24_000));
    expect(out?.rate).toBe(24_000);
    expect([...(out?.samples ?? [])]).toEqual([0, 0.5, -1]);
  });

  it('mixes stereo down to mono', () => {
    expect([...(decodeWav(wav([16384, 0, -16384, -16384], 48_000, 2))?.samples ?? [])]).toEqual([0.25, -0.5]);
  });

  it('has nothing for bytes that aren’t a WAV', () => {
    expect(decodeWav(new TextEncoder().encode('{"error":"no"}'))).toBeUndefined();
  });
});

describe('heardShare', () => {
  it('counts the words of the line whisper heard, whatever their case or punctuation', () => {
    expect(heardShare('What happens if the database stays down?', 'what happens if the data base stays down')).toBeCloseTo(6 / 7);
    expect(heardShare('Why wait?', 'Why wait.')).toBe(1);
    expect(heardShare('Why wait?', 'This is a demo transcription.')).toBe(0);
  });
});

describe('verdict', () => {
  const step = (ms: number, extra = {}) => ({ name: 'first reply', ms, budgetMs: 1000, ...extra });

  it('passes when every step ran within its budget and the question was heard', () => {
    const { lines, pass } = verdict([step(500, { note: 'quick answerer' })], 0.9);
    expect(pass).toBe(true);
    expect(lines[0]).toMatch(/^✓ first reply +0\.50 s {2}\(budget 1 s\) {2}quick answerer$/);
  });

  it('fails a step over its budget, or a question misheard', () => {
    expect(verdict([step(1500)], 1).pass).toBe(false);
    expect(verdict([step(500)], 0.5).pass).toBe(false);
  });

  it('never fails a step it could only skip', () => {
    const { lines, pass } = verdict([step(5000, { skipped: true })], 1);
    expect(pass).toBe(true);
    expect(lines[0]).toMatch(/^– /);
  });
});
