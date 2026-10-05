/** whisper.cpp reads 16 kHz mono 16-bit PCM, so the browser converts to that and the server needs no ffmpeg. */
export const WHISPER_RATE = 16_000;

/**
 * Mixes the channels down to mono and resamples them to 16 kHz. Each output sample averages the input samples it
 * covers, which keeps downsampling from aliasing high frequencies into the speech band.
 */
export function toMono16k(channels: Float32Array[], sampleRate: number): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  if (sampleRate === WHISPER_RATE) return mono;

  const ratio = sampleRate / WHISPER_RATE;
  const out = new Float32Array(Math.floor(length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = i * ratio;
    const to = Math.min(length, (i + 1) * ratio);
    if (to - from <= 1) {
      // upsampling: interpolate between the two nearest samples
      const at = Math.floor(from);
      const next = mono[Math.min(at + 1, length - 1)];
      out[i] = mono[at] + (next - mono[at]) * (from - at);
    } else {
      let sum = 0;
      let count = 0;
      for (let j = Math.floor(from); j < to; j++, count++) sum += mono[j];
      out[i] = sum / count;
    }
  }
  return out;
}

/** A WAV file of 16-bit PCM mono samples. */
export function encodeWav(samples: Float32Array, sampleRate = WHISPER_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return buffer;
}

/**
 * The field's text with a transcript dropped in at the cursor (replacing the selection), spaced off from the words
 * around it. `cursor` sits just after the transcript.
 */
export function insertTranscript(value: string, start: number, end: number, transcript: string): { value: string; cursor: number } {
  const text = transcript.trim();
  if (!text) return { value, cursor: end };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)\]}]/.test(after) ? ' ' : '';
  const inserted = `${lead}${text}`;
  return { value: `${before}${inserted}${trail}${after}`, cursor: before.length + inserted.length };
}
