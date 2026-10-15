import { describe, expect, it } from 'vitest';
import type { VoiceStatus } from './types';
import { forSpeech, linesToSpeak, spokenLine, voiceMissing } from './voice';

const status = (whisper: boolean, model: boolean): VoiceStatus => ({
  whisper: { found: whisper, command: 'whisper-cli' },
  model: { present: model, path: '/m.bin' },
  speech: { downloaded: false, path: '/kokoro', engine: { state: 'idle' } },
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

describe('forSpeech', () => {
  it('drops code, paths and file names', () => {
    expect(forSpeech('It lives in `server/voice.ts` and client/src/ui/dictation.ts, next to speech.test.ts.')).toBe('It lives in and next to.');
    expect(forSpeech('Call `transcribe()` or toWav() first.')).toBe('Call or first.');
    expect(forSpeech('Like this:\n```ts\nconst x = 1;\n```\nThoughts?')).toBe('Like this: Thoughts?');
  });

  it('drops Markdown marks', () => {
    expect(forSpeech('**Yes**, keep it _short_.')).toBe('Yes, keep it short.');
  });

  it('keeps every sentence', () => {
    expect(forSpeech('One. Two? Three!')).toBe('One. Two? Three!');
  });
});

describe('spokenLine', () => {
  const text = 'I read `server/agents/briefing.ts`: replies are plain text today. Should the spoken line come from the same turn? I’d say yes, no extra call.';

  it('makes the officer’s own line speakable', () => {
    expect(spokenLine('Replies are plain text today. Same turn for the spoken line?', text)).toBe('Replies are plain text today. Same turn for the spoken line?');
    expect(spokenLine('See `briefing.ts`. Same turn?', text)).toBe('See. Same turn?');
  });

  it('keeps at most two sentences', () => {
    expect(spokenLine('One. Two? Three! Four.', text)).toBe('One. Two?');
  });

  it('falls back to the reply’s last question when there is no line', () => {
    expect(spokenLine(undefined, text)).toBe('Should the spoken line come from the same turn?');
    expect(spokenLine('  `code only`  ', text)).toBe('Should the spoken line come from the same turn?');
  });

  it('falls back to the reply’s opening when it asks nothing', () => {
    expect(spokenLine(undefined, 'Noted. Added it to the scope. Ready when you are.')).toBe('Noted. Added it to the scope.');
  });

  it('is shorter than the reply and has no paths or code', () => {
    const line = spokenLine(undefined, text)!;
    expect(line.length).toBeLessThan(text.length);
    expect(line).not.toMatch(/[`/\\]|\.ts\b/);
  });
});

describe('linesToSpeak', () => {
  const messages: Parameters<typeof linesToSpeak>[0] = [
    { from: 'manager', text: 'A wishlist' },
    { from: 'officer', text: 'I read `cart.ts`. Who is it for?', spoken: 'Who is it for?' },
    { from: 'qa', text: 'Say what **fast** means.' },
    { from: 'system', text: 'The captain asked Lt. Brennan for options.' },
    { from: 'engineer', text: '2 options on the screen. I’d go with A, one module: it’s smaller. And safer.' },
    { from: 'officer', text: 'It’s written up and waiting at Shop’s Ops station.' },
  ];

  it('speaks the crew in log order: the officer’s spoken line, the rest as they are', () => {
    expect(linesToSpeak(messages, 0)).toEqual([
      { speaker: 'officer', text: 'Who is it for?' },
      { speaker: 'qa', text: 'Say what fast means.' },
      { speaker: 'engineer', text: '2 options on the screen. I’d go with A, one module: it’s smaller. And safer.' },
      { speaker: 'officer', text: 'It’s written up and waiting at Shop’s Ops station.' },
    ]);
  });

  it('says nothing that was in the log before `from`', () => {
    expect(linesToSpeak(messages, 5)).toEqual([{ speaker: 'officer', text: 'It’s written up and waiting at Shop’s Ops station.' }]);
    expect(linesToSpeak(messages, 6)).toEqual([]);
  });

  it('speaks any crew member’s replies as their spoken line, never the captain’s', () => {
    const chat: { from: 'manager' | 'guest'; text: string; spoken?: string }[] = [
      { from: 'manager', text: 'How does the cart work?' },
      { from: 'guest', text: 'It starts in `src/cart.ts`.', spoken: 'It starts in the cart module.' },
    ];
    expect(linesToSpeak(chat, 0)).toEqual([{ speaker: 'guest', text: 'It starts in the cart module.' }]);
  });
});
