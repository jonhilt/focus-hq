import { recordingLine } from '../../../shared/qa';
import type { QaRecording } from '../../../shared/types';
import { h } from './dom';

/**
 * The recording of QA's browser, as on the PR comment: the GIF, which plays by itself, opening the MP4, and how it was
 * edited. The clip Ops kept is shown, as the evidence branch of a private repo won't load here; without a GIF (too big
 * for one), the MP4 plays in place. One recorded before Ops kept clips links to GitHub's.
 */
export function recordingFigure(r: QaRecording): HTMLElement {
  const local = (file: string | undefined) => file && `/api/qa-shots/${file}`;
  const mp4 = local(r.mp4File) ?? r.mp4Url;
  const gif = local(r.gifFile) ?? r.gifUrl;
  return h('figure', { class: 'qa-recording' },
    gif
      ? h('a', { href: mp4, target: '_blank', rel: 'noreferrer' }, h('img', { src: gif, alt: 'Recording of QA’s browser session', loading: 'lazy' }))
      : h('video', { src: mp4, controls: true, muted: true, preload: 'metadata' }),
    h('figcaption', null, h('strong', null, '🎬 Recording'), ` · ${recordingLine(r)} · `, h('a', { href: mp4, target: '_blank', rel: 'noreferrer' }, 'MP4 ↗')),
  );
}
