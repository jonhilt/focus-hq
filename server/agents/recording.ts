// How a QA officer's recorded browser session is edited down for the pull request: every action they took plays at
// real speed, and the waits between them (the officer reading and thinking) are fast-forwarded, never cut, so the clip
// still shows everything that happened on the page. Pure, so it's unit tested (recording.test.ts); the capture and
// ffmpeg run in recorder.ts.

/** A frame of the screencast, as a file, and when the page showed it (ms since the epoch). */
export interface RecordedFrame {
  file: string;
  at: number;
}

/** How the edit keeps each action and shrinks the waits between them, in ms. */
export interface EditRules {
  /** Real time kept before each action, so the page can be seen as it was. */
  before: number;
  /** Real time kept after each action, for what it did to settle. */
  after: number;
  /** How long a fast-forwarded wait lasts in the clip, at most. */
  waitShown: number;
  /** Real time kept at the end, the page as the officer left it. */
  tail: number;
}

export const EDIT_RULES: EditRules = { before: 500, after: 3000, waitShown: 1200, tail: 1500 };

/** The edited clip: each frame and how long it shows, and where (in the clip's own seconds) it's fast-forwarded. */
export interface Edit {
  shows: { file: string; seconds: number }[];
  fastForwards: FastForward[];
  realSeconds: number;
  shownSeconds: number;
}

/** A stretch of the clip that plays `speed` times faster than it happened, from `from` to `to` seconds into it. */
export interface FastForward {
  from: number;
  to: number;
  speed: number;
}

/**
 * The edit of a recording whose frames are `frames` (in the order shown) and in which the officer acted at `actions`
 * (ms since the epoch). A wait plays at a whole number of times its real speed, so the badge saying so is exact; one
 * too short to speed up by two plays as it was. Nothing when there's nothing to show.
 */
export function editPlan(recorded: readonly RecordedFrame[], actions: readonly number[], rules: EditRules = EDIT_RULES): Edit | null {
  if (recorded.length < 2) return null;
  const last = recorded[recorded.length - 1];
  const kept = [...actions.map((a) => [a - rules.before, a + rules.after]), [last.at - rules.tail, Infinity]];
  const keeps = (at: number) => kept.some(([from, to]) => at >= from && at < to);
  const frames = splitAt(recorded, kept.flat());
  const shows: Edit['shows'] = [];
  const fastForwards: FastForward[] = [];
  let shown = 0;
  const show = (i: number, speed: number) => {
    const seconds = (frames[i + 1].at - frames[i].at) / 1000 / speed;
    shows.push({ file: frames[i].file, seconds });
    shown += seconds;
  };
  for (let i = 0; i < frames.length - 1; ) {
    if (keeps(frames[i].at)) {
      show(i++, 1);
      continue;
    }
    let end = i;
    while (end < frames.length - 1 && !keeps(frames[end].at)) end++;
    const speed = Math.max(1, Math.round((frames[end].at - frames[i].at) / rules.waitShown));
    const from = shown;
    for (; i < end; i++) show(i, speed);
    if (speed > 1) fastForwards.push({ from, to: shown, speed });
  }
  return { shows, fastForwards, realSeconds: (last.at - frames[0].at) / 1000, shownSeconds: shown };
}

/**
 * The frames with one more at each of `cuts` that falls between two of them: the frame showing then, again. The
 * screencast sends a frame only when the page changes, so on a still page the frame showing as an action's moment
 * begins may have come long before it, and without a cut there its moment would play sped up with the wait.
 */
function splitAt(frames: readonly RecordedFrame[], cuts: readonly number[]): RecordedFrame[] {
  const split = [...frames];
  for (const cut of cuts) {
    const after = split.findIndex((f) => f.at >= cut);
    if (after > 0 && split[after].at !== cut) split.splice(after, 0, { file: split[after - 1].file, at: cut });
  }
  return split;
}

/** How long the last frame stays up at the end of the clip, in seconds. */
const HOLD = 1;

/**
 * The edit as an ffconcat list for ffmpeg's concat demuxer: each frame for as long as it shows. The last is named twice,
 * as the demuxer ignores the duration of the final entry.
 */
export function concatList(edit: Edit, lastFile: string): string {
  const quoted = (file: string) => `file '${file.replace(/'/g, `'\\''`)}'`;
  const lines = edit.shows.map((s) => `${quoted(s.file)}\nduration ${s.seconds.toFixed(4)}`);
  return ['ffconcat version 1.0', ...lines, quoted(lastFile), `duration ${HOLD}`, quoted(lastFile), ''].join('\n');
}

/** The badge on a fast-forwarded stretch. */
export const badgeText = (speed: number) => `⏩ ×${speed}`;

/** Each speed the clip is fast-forwarded at, once, in the order first seen: one badge image each. */
export const badgeSpeeds = (edit: Edit): number[] => [...new Set(edit.fastForwards.map((f) => f.speed))];

/** The clip's frame rate. */
const FPS = 25;

/**
 * ffmpeg's arguments to make the clip as an MP4 at `out` from the ffconcat list at `list` and a PNG badge per speed
 * (`badges`, in the order of `badgeSpeeds`), each laid over the top right corner while its stretches play.
 */
export function mp4Args(edit: Edit, list: string, badges: readonly string[], out: string): string[] {
  const speeds = badgeSpeeds(edit);
  const filters = [`[0:v]fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2[v0]`];
  speeds.forEach((speed, i) => {
    const when = edit.fastForwards
      .filter((f) => f.speed === speed)
      .map((f) => `between(t,${f.from.toFixed(3)},${f.to.toFixed(3)})`)
      .join('+');
    filters.push(`[v${i}][${i + 1}:v]overlay=W-w-16:16:enable='${when}'[v${i + 1}]`);
  });
  filters.push(`[v${speeds.length}]format=yuv420p[out]`);
  return [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    ...badges.flatMap((b) => ['-i', b]),
    '-filter_complex', filters.join(';'),
    '-map', '[out]', '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-movflags', '+faststart', out,
  ];
}

/** ffmpeg's arguments to make the GIF that plays in the pull request comment from the MP4 at `mp4`. */
export function gifArgs(mp4: string, out: string): string[] {
  return [
    '-y', '-loglevel', 'error', '-i', mp4,
    '-vf', 'fps=10,scale=min(800\\,iw):-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
    out,
  ];
}

/** A length of time as the comment says it: `0:48`, `12:05`. */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
