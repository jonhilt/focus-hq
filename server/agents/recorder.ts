import type { BrowserContext, CDPSession, Page } from 'playwright';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../util';
import { badgeSpeeds, badgeText, concatList, editPlan, gifArgs, mp4Args, type RecordedFrame } from './recording';

/** Frames a second the screencast keeps at most: enough to follow a click, few enough for a long review's disk. */
const KEEP_FPS = 12;
/** Frames a recording keeps at most (about 20 minutes at KEEP_FPS); past it, the rest of the session isn't recorded. */
const MAX_FRAMES = KEEP_FPS * 60 * 20;
/** A GIF bigger than this stays off the comment, which links the MP4 alone. */
const MAX_GIF_BYTES = 10 * 1024 * 1024;

/**
 * An agent's browser session recorded as it happens: Chrome's screencast frames, as JPEGs in a folder of their own,
 * and when the agent acted. Kept across the agent's tabs (a review that goes on in a new session goes on recording)
 * until it's finished. Chrome's screencast, not Playwright's video, as that needs an ffmpeg build of Playwright's own.
 */
export class Recording {
  readonly frames: RecordedFrame[] = [];
  readonly actions: number[] = [];
  private cdp: CDPSession | null = null;
  private writing = new Set<Promise<void>>();

  private constructor(readonly dir: string) {}

  static async start(): Promise<Recording> {
    return new Recording(await mkdtemp(path.join(os.tmpdir(), 'focus-recording-')));
  }

  /** Records `page` from now on, in place of any page it recorded before. */
  async watch(context: BrowserContext, page: Page): Promise<void> {
    await this.unwatch();
    const cdp = await context.newCDPSession(page);
    this.cdp = cdp;
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
      const at = Math.round((metadata.timestamp ?? Date.now() / 1000) * 1000);
      const previous = this.frames[this.frames.length - 1];
      if (this.frames.length >= MAX_FRAMES || (previous && at - previous.at < 1000 / KEEP_FPS)) return;
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, '0')}.jpg`);
      this.frames.push({ file, at });
      const written = writeFile(file, Buffer.from(data, 'base64')).catch(() => undefined);
      this.writing.add(written);
      void written.then(() => this.writing.delete(written));
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1100, maxHeight: 700 });
  }

  /** Stops recording the page it watches (its tab closing, say); the frames so far stay. */
  async unwatch(): Promise<void> {
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) await cdp.send('Page.stopScreencast').then(() => cdp.detach()).catch(() => undefined);
    await Promise.all(this.writing);
  }

  /** The agent acted on the page just now. */
  acted(): void {
    this.actions.push(Date.now());
  }

  /** Throws the frames away. */
  async discard(): Promise<void> {
    await this.unwatch();
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A recording edited down (recording.ts): the clip as an MP4, the GIF of it when it's small enough, and how it was cut. */
export interface EditedRecording {
  mp4: Buffer;
  gif?: Buffer;
  realSeconds: number;
  shownSeconds: number;
  actions: number;
}

/**
 * Edits `recording` down with the machine's ffmpeg, drawing each fast-forward badge with `badge` (a PNG of its text,
 * since an ffmpeg without freetype can't draw text), and throws its frames away. Nothing when the agent never acted in
 * the browser; throws when ffmpeg isn't there or fails.
 */
export async function editRecording(recording: Recording, badge: (text: string) => Promise<Buffer>): Promise<EditedRecording | null> {
  try {
    await recording.unwatch();
    const edit = recording.actions.length ? editPlan(recording.frames, recording.actions) : null;
    if (!edit) return null;
    const file = (name: string) => path.join(recording.dir, name);
    await writeFile(file('list.ffconcat'), concatList(edit, recording.frames[recording.frames.length - 1].file));
    const badges = await Promise.all(badgeSpeeds(edit).map(async (speed, i) => {
      await writeFile(file(`badge-${i}.png`), await badge(badgeText(speed)));
      return file(`badge-${i}.png`);
    }));
    await run('ffmpeg', mp4Args(edit, file('list.ffconcat'), badges, file('clip.mp4')), { timeoutMs: 5 * 60_000 });
    await run('ffmpeg', gifArgs(file('clip.mp4'), file('clip.gif')), { timeoutMs: 5 * 60_000 });
    const small = (await stat(file('clip.gif'))).size <= MAX_GIF_BYTES;
    return {
      mp4: await readFile(file('clip.mp4')),
      ...(small && { gif: await readFile(file('clip.gif')) }),
      realSeconds: edit.realSeconds,
      shownSeconds: edit.shownSeconds,
      actions: recording.actions.length,
    };
  } finally {
    await recording.discard();
  }
}
