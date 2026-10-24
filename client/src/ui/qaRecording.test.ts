// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { QaRecording } from '../../../shared/types';
import { recordingFigure } from './qaRecording';

const recording: QaRecording = {
  mp4Url: 'https://github.com/acme/shop/raw/focus-qa-evidence/pr-7/recording.mp4',
  gifUrl: 'https://github.com/acme/shop/raw/focus-qa-evidence/pr-7/recording.gif',
  realSeconds: 312,
  shownSeconds: 47,
  actions: 9,
  mp4File: 'acme-shop-7-1700-recording.mp4',
  gifFile: 'acme-shop-7-1700-recording.gif',
};

describe('the recording on the QA station’s report card', () => {
  it('plays the GIF Ops kept, opening the MP4, and says how it was edited', () => {
    const figure = recordingFigure(recording);
    expect(figure.querySelector('img')?.getAttribute('src')).toBe('/api/qa-shots/acme-shop-7-1700-recording.gif');
    expect(figure.querySelector('a')?.getAttribute('href')).toBe('/api/qa-shots/acme-shop-7-1700-recording.mp4');
    expect(figure.querySelector('figcaption')?.textContent).toBe('🎬 Recording · took 5:12, shown in 0:47 · 9 browser actions at real speed, waits fast-forwarded · MP4 ↗');
  });

  it('plays the MP4 in place when the clip was too big for a GIF', () => {
    const figure = recordingFigure({ ...recording, gifUrl: undefined, gifFile: undefined });
    expect(figure.querySelector('img')).toBeNull();
    expect(figure.querySelector('video')?.getAttribute('src')).toBe('/api/qa-shots/acme-shop-7-1700-recording.mp4');
  });

  it('links GitHub’s clip for a recording from before Ops kept them', () => {
    const figure = recordingFigure({ ...recording, mp4File: undefined, gifFile: undefined, actions: 1 });
    expect(figure.querySelector('img')?.getAttribute('src')).toBe(recording.gifUrl);
    expect(figure.querySelector('a')?.getAttribute('href')).toBe(recording.mp4Url);
    expect(figure.textContent).toContain('1 browser action at real speed');
  });
});
