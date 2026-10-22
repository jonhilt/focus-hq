import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { whisper } from './config';
import { Hub } from './hub';
import { cleanTranscript, Voice, type VoiceSettings, whisperFor } from './voice';

describe('cleanTranscript', () => {
  it('joins whisper-cli lines into one trimmed sentence', () => {
    expect(cleanTranscript('\n Add a retry to the\n webhook handler.\n\n')).toBe('Add a retry to the webhook handler.');
  });

  it('drops markers whisper prints for silence and noise', () => {
    expect(cleanTranscript('[BLANK_AUDIO]\n')).toBe('');
    expect(cleanTranscript(' Ship it. [MUSIC PLAYING]\n')).toBe('Ship it.');
  });
});

describe('whisper’s command and model', () => {
  it('are whisper-cli and the model in Focus’s data folder, unless Settings name others', () => {
    expect(whisperFor({})).toEqual({ bin: 'whisper-cli', model: whisper.model });
    expect(whisperFor({ whisperBin: '/opt/bin/whisper-cli', whisperModel: 'models/small.bin' })).toEqual({ bin: '/opt/bin/whisper-cli', model: path.resolve('models/small.bin') });
  });

  it('follow Settings as they change, each browser hearing where they are now', () => {
    const hub = new Hub();
    const sent: unknown[] = [];
    vi.spyOn(hub, 'send').mockImplementation((e) => void sent.push(e));
    let settings: VoiceSettings = {};
    const voice = new Voice(hub, true, () => settings);
    expect(voice.status().model.path).toBe(whisper.model);
    settings = { whisperBin: 'my-whisper', whisperModel: '/models/small.bin' };
    voice.settingsChanged();
    expect(voice.status()).toMatchObject({ whisper: { command: 'my-whisper' }, model: { path: '/models/small.bin' } });
    expect(sent).toContainEqual(expect.objectContaining({ type: 'voice', voice: expect.objectContaining({ model: expect.objectContaining({ path: '/models/small.bin' }) }) }));
  });
});
