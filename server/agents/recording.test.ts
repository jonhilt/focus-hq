import { describe, expect, it } from 'vitest';
import { badgeSpeeds, clock, concatList, editPlan, type EditRules, gifArgs, mp4Args, type RecordedFrame } from './recording';

const RULES: EditRules = { before: 500, after: 3000, waitShown: 1000, tail: 1000 };

/** A frame every `step` ms from `from` to `to` (exclusive), named by when it was shown. */
const frames = (from: number, to: number, step = 100): RecordedFrame[] =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => ({ file: `f${from + i * step}.jpg`, at: from + i * step }));

const total = (shows: { seconds: number }[]) => shows.reduce((sum, s) => sum + s.seconds, 0);

describe('editPlan', () => {
  it('plays each action at real speed and fast-forwards the wait between them, never dropping a frame', () => {
    // actions at 0 s and 20 s, the recording ends at 30 s
    const recorded = frames(0, 30_000);
    const edit = editPlan(recorded, [0, 20_000], RULES)!;
    expect(edit.shows.map((s) => s.file)).toEqual(recorded.slice(0, -1).map((f) => f.file));
    expect(edit.realSeconds).toBeCloseTo(29.9);
    // kept: 0–3 s, 19.5–23 s and the last second (28.9–29.9 s) at real speed, 7.5 s; waits 3–19.5 s (16.5 s at ×17)
    // and 23–28.9 s (5.9 s at ×6)
    expect(edit.fastForwards.map((f) => f.speed)).toEqual([17, 6]);
    expect(edit.shownSeconds).toBeCloseTo(7.5 + 16.5 / 17 + 5.9 / 6, 3);
    expect(total(edit.shows)).toBeCloseTo(edit.shownSeconds);
  });

  it('says where in the clip each fast-forward plays', () => {
    const edit = editPlan(frames(0, 30_000), [0, 20_000], RULES)!;
    const [first, second] = edit.fastForwards;
    expect(first.from).toBeCloseTo(3);
    expect(first.to).toBeCloseTo(3 + 16.5 / 17, 3);
    // after the second action's 3.5 s at real speed
    expect(second.from).toBeCloseTo(first.to + 3.5, 3);
  });

  it('plays a wait too short to speed up by two as it was, with no badge', () => {
    // actions 4.5 s apart: the 1 s between the first's after and the second's before stays as it is
    const edit = editPlan(frames(0, 9000), [0, 4500], RULES)!;
    expect(edit.fastForwards).toEqual([]);
    expect(edit.shownSeconds).toBeCloseTo(edit.realSeconds);
  });

  it('keeps the end at real speed, the page as the officer left it', () => {
    const edit = editPlan(frames(0, 20_000), [0], RULES)!;
    const tail = edit.shows.slice(-10);
    expect(tail.every((s) => s.seconds === 0.1)).toBe(true);
  });

  it('has nothing to edit without two frames', () => {
    expect(editPlan([], [0], RULES)).toBeNull();
    expect(editPlan(frames(0, 100), [0], RULES)).toBeNull();
  });
});

describe('the clip ffmpeg makes', () => {
  const edit = editPlan(frames(0, 60_000), [0, 20_000, 40_000], RULES)!;

  it('lists each frame for as long as it shows, the last held at the end', () => {
    const list = concatList(edit, "last's.jpg").split('\n');
    expect(list[0]).toBe('ffconcat version 1.0');
    expect(list[1]).toBe("file 'f0.jpg'");
    expect(list[2]).toBe('duration 0.1000');
    // a quote in a name is escaped for the demuxer, and the last file is named twice
    expect(list.slice(-4)).toEqual([`file 'last'\\''s.jpg'`, 'duration 1', `file 'last'\\''s.jpg'`, '']);
  });

  it('lays one badge per speed over the stretches at that speed', () => {
    // the two waits between actions are the same length, the one after the last is shorter
    expect(edit.fastForwards.map((f) => f.speed)).toEqual([17, 17, 16]);
    expect(badgeSpeeds(edit)).toEqual([17, 16]);
    const args = mp4Args(edit, 'list.ffconcat', ['b17.png', 'b16.png'], 'clip.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args.filter((a) => a === '-i')).toHaveLength(3);
    const [a, b] = edit.fastForwards;
    expect(graph).toContain(`[v0][1:v]overlay=W-w-16:16:enable='between(t,${a.from.toFixed(3)},${a.to.toFixed(3)})+between(t,${b.from.toFixed(3)},${b.to.toFixed(3)})'[v1]`);
    expect(graph).toContain('[v1][2:v]overlay=');
    expect(graph.endsWith('[v2]format=yuv420p[out]')).toBe(true);
    expect(args.at(-1)).toBe('clip.mp4');
  });

  it('makes a clip with no badges when nothing was fast-forwarded', () => {
    const still = editPlan(frames(0, 4000), [0], RULES)!;
    const args = mp4Args(still, 'list.ffconcat', [], 'clip.mp4');
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:v]fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2[v0];[v0]format=yuv420p[out]');
  });

  it('makes the GIF from the MP4', () => {
    expect(gifArgs('clip.mp4', 'clip.gif').slice(-1)).toEqual(['clip.gif']);
    expect(gifArgs('clip.mp4', 'clip.gif')).toContain('clip.mp4');
  });
});

describe('clock', () => {
  it('says minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(48.4)).toBe('0:48');
    expect(clock(725)).toBe('12:05');
  });
});
