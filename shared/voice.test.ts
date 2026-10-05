import { describe, expect, it } from 'vitest';
import type { VoiceStatus } from './types';
import { voiceMissing } from './voice';

const status = (whisper: boolean, model: boolean): VoiceStatus => ({
  whisper: { found: whisper, command: 'whisper-cli' },
  model: { present: model, path: '/m.bin' },
});

describe('voiceMissing', () => {
  it('is undefined once whisper-cli and the model are both there', () => {
    expect(voiceMissing(status(true, true))).toBeUndefined();
  });

  it('names what is missing and where to set it up', () => {
    expect(voiceMissing(status(false, true))).toMatch(/needs whisper-cli\. .*Voice input/);
    expect(voiceMissing(status(true, false))).toMatch(/needs the speech model\./);
    expect(voiceMissing(status(false, false))).toMatch(/needs whisper-cli and the speech model\./);
  });

  it('waits for the first status from the server', () => {
    expect(voiceMissing(null)).toMatch(/connecting/);
  });
});
