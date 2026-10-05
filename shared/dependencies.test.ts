import { describe, expect, it } from 'vitest';
import { assignWarning, dependsOn, startOrder, waitingFor, waitsLabel } from './dependencies';
import type { Issue } from './types';

const issue = (number: number, body = '', repo = 'acme/shop'): Issue => ({
  repo,
  number,
  title: `Issue ${number}`,
  body,
  url: `https://github.com/${repo}/issues/${number}`,
  labels: [],
  createdAt: new Date(Date.UTC(2026, 0, number)).toISOString(),
});

describe('dependsOn', () => {
  it('reads "Depends on" and "Blocked by", in any case', () => {
    expect(dependsOn('Depends on #12')).toEqual([12]);
    expect(dependsOn('Some context.\n\nblocked BY #12, #13')).toEqual([12, 13]);
    expect(dependsOn('DEPENDS ON: #4 and #5 & #6')).toEqual([4, 5, 6]);
    expect(dependsOn('Depends on #3.\nBlocked by #3, #7')).toEqual([3, 7]);
  });

  it('ignores mentions that aren’t dependencies, and other repos', () => {
    expect(dependsOn('See #12. Related to #13.')).toEqual([]);
    expect(dependsOn('Depends on acme/api#12')).toEqual([]);
    expect(dependsOn('Depends on the API landing first, see #12')).toEqual([]);
  });
});

describe('waitingFor', () => {
  it('lists the open issues an issue waits for', () => {
    const waiting = waitingFor([issue(1), issue(2), issue(3, 'Blocked by #1, #2')]);
    expect(waiting.get('acme/shop#3')).toEqual([1, 2]);
    expect(waiting.has('acme/shop#1')).toBe(false);
  });

  it('stops waiting once the dependencies are closed', () => {
    expect(waitingFor([issue(2), issue(3, 'Blocked by #1, #2')]).get('acme/shop#3')).toEqual([2]);
    expect(waitingFor([issue(3, 'Blocked by #1, #2')]).size).toBe(0);
  });

  it('only looks in the issue’s own repo', () => {
    expect(waitingFor([issue(1, '', 'acme/api'), issue(3, 'Depends on #1')]).size).toBe(0);
  });

  it('treats cycle members as not waiting for each other, but still for what’s outside the cycle', () => {
    const waiting = waitingFor([issue(1, 'Depends on #2'), issue(2, 'Depends on #3'), issue(3, 'Depends on #1, #4'), issue(4), issue(5, 'Depends on #5')]);
    expect([...waiting]).toEqual([['acme/shop#3', [4]]]);
  });
});

describe('startOrder', () => {
  const numbers = (issues: Issue[]) => startOrder(issues).map((i) => i.number);

  it('keeps creation order when nothing depends on anything', () => {
    expect(numbers([issue(2), issue(1), issue(3)])).toEqual([1, 2, 3]);
  });

  it('leaves out waiting issues and starts the one holding up the longest chain first', () => {
    // 4 ← 5 ← 6 is a longer chain than 1 ← 2
    expect(numbers([issue(1), issue(2, 'Depends on #1'), issue(3), issue(4), issue(5, 'Depends on #4'), issue(6, 'Depends on #5')])).toEqual([4, 1, 3]);
  });

  it('measures the chain, not the number of dependents', () => {
    // 1 holds up 2 and 3 directly; 4 holds up 5, which holds up 6
    expect(numbers([issue(1), issue(2, 'Depends on #1'), issue(3, 'Depends on #1'), issue(4), issue(5, 'Depends on #4'), issue(6, 'Depends on #5')])).toEqual([4, 1]);
  });

  it('finishes on a cycle, starting its members like any other issue', () => {
    expect(numbers([issue(1, 'Depends on #2'), issue(2, 'Depends on #1'), issue(3, 'Depends on #2')])).toEqual([2, 1]);
  });
});

describe('waitsLabel', () => {
  it('names what an issue waits for, and nothing when it can start', () => {
    expect(waitsLabel([12, 13])).toBe('waits for #12, #13');
    expect(waitsLabel([])).toBe('');
  });

  it('warns before an issue that waits is assigned by hand', () => {
    expect(assignWarning({ number: 5, waitsFor: [12] })).toBe('#5 waits for #12, which is still open. Assign an agent anyway?');
    expect(assignWarning({ number: 5, waitsFor: [] })).toBeUndefined();
  });
});
