import { describe, expect, it } from 'vitest';
import type { BackgroundTask } from '../../../shared/types';
import { clip, probeCaption, probeSlots, runningFor } from './probeSlots';

const task = (id: string, startedAt: number, status: BackgroundTask['status'] = 'running', kind: BackgroundTask['kind'] = 'shell'): BackgroundTask =>
  ({ id, kind, description: `cmd ${id}`, status, startedAt });

describe('probeSlots', () => {
  it('shows every task in the order they started while they fit', () => {
    const { shown, more } = probeSlots([task('b', 2), task('a', 1)]);
    expect(shown.map((t) => t.id)).toEqual(['a', 'b']);
    expect(more).toBe(0);
  });

  it('keeps each in its place when one ends', () => {
    expect(probeSlots([task('a', 1, 'stopped'), task('b', 2)]).shown.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('shows the running ones over the ended ones beyond four, and counts the rest', () => {
    const tasks = [task('a', 1, 'done'), task('b', 2), task('c', 3, 'stopped'), task('d', 4), task('e', 5), task('f', 6)];
    expect(probeSlots(tasks)).toMatchObject({ shown: [{ id: 'b' }, { id: 'd' }, { id: 'e' }, { id: 'f' }], more: 2 });
    const fewer = [task('a', 1, 'done'), task('b', 2), task('c', 3, 'stopped'), task('d', 4), task('e', 5)];
    expect(probeSlots(fewer).shown.map((t) => t.id)).toEqual(['a', 'b', 'd', 'e']);
  });
});

describe('probeCaption', () => {
  it('cuts a long command short and says what it is and how it stands', () => {
    const t = { ...task('a', 1, 'failed'), description: 'pnpm exec vitest --watch --reporter verbose server/' };
    expect(probeCaption(t)).toEqual({ command: 'pnpm exec vitest --watch --re…', status: 'Shell · failed' });
    expect(probeCaption(task('m', 1, 'running', 'monitor')).status).toBe('Monitor · running');
  });

  it('keeps a short one as it is, on one line', () => {
    expect(clip('pnpm\n run  dev', 30)).toBe('pnpm run dev');
  });
});

describe('runningFor', () => {
  it('counts to now while it runs, and to when it ended after', () => {
    expect(runningFor(task('a', 0), 42_000)).toBe('42s');
    expect(runningFor({ ...task('a', 0), endedAt: 185_000 }, 999_999_999)).toBe('3m');
    expect(runningFor(task('a', 0), 3_900_000)).toBe('1h 5m');
  });
});
