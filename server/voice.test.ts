import { describe, expect, it } from 'vitest';
import { cleanTranscript } from './voice';

describe('cleanTranscript', () => {
  it('joins whisper-cli lines into one trimmed sentence', () => {
    expect(cleanTranscript('\n Add a retry to the\n webhook handler.\n\n')).toBe('Add a retry to the webhook handler.');
  });

  it('drops markers whisper prints for silence and noise', () => {
    expect(cleanTranscript('[BLANK_AUDIO]\n')).toBe('');
    expect(cleanTranscript(' Ship it. [MUSIC PLAYING]\n')).toBe('Ship it.');
  });
});
