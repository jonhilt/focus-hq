import { describe, expect, it } from 'vitest';
import { CROSS, crossCoupling, type OwnedCommit } from './crossRepo';

const HOUR = 60 * 60 * 1000;
let n = 0;
/** A commit by `author`, `hours` in, touching `parts`. */
const at = (hours: number, author: string, ...parts: string[]): OwnedCommit => ({ sha: `c${n++}`, date: new Date(Date.UTC(2026, 9, 1) + hours * HOUR).toISOString(), author, parts });

describe('crossCoupling', () => {
  it('ties parts in different repos that one author changes close together', () => {
    // four times, ann changes the web's checkout and then the api's orders within the hour; once, only the web
    const web = [at(0, 'ann', 'checkout'), at(24, 'ann', 'checkout'), at(48, 'ann', 'checkout'), at(72, 'ann', 'checkout'), at(96, 'ann', 'checkout')];
    const api = [at(0.5, 'ann', 'orders'), at(24.5, 'ann', 'orders'), at(48.5, 'ann', 'orders'), at(72.5, 'ann', 'orders')];
    expect(crossCoupling([{ repo: 'o/web', commits: web }, { repo: 'o/api', commits: api }])).toEqual([
      { a: { repo: 'o/api', part: 'orders' }, b: { repo: 'o/web', part: 'checkout' }, together: 4, either: 5 },
    ]);
  });

  it('keeps apart what different people change, or changes hours apart, and what\'s too rare to say', () => {
    const web = [0, 24, 48, 72].map((h) => at(h, 'ann', 'checkout'));
    const byBob = [0.5, 24.5, 48.5, 72.5].map((h) => at(h, 'bob', 'orders'));
    const later = [0, 24, 48, 72].map((h) => at(h + CROSS.windowMs / HOUR + 1, 'ann', 'orders'));
    const rare = Array.from({ length: CROSS.together - 1 }, (_, i) => at(i * 24 + 0.5, 'ann', 'billing'));
    expect(crossCoupling([{ repo: 'o/web', commits: web }, { repo: 'o/api', commits: byBob }])).toEqual([]);
    expect(crossCoupling([{ repo: 'o/web', commits: web }, { repo: 'o/api', commits: later }])).toEqual([]);
    expect(crossCoupling([{ repo: 'o/web', commits: web }, { repo: 'o/api', commits: rare }])).toEqual([]);
  });

  it('never ties a repo to itself, nor the same commit seen in two repos', () => {
    const same = [0, 24, 48, 72].map((h) => at(h, 'ann', 'checkout', 'cart'));
    expect(crossCoupling([{ repo: 'o/web', commits: same }])).toEqual([]);
    expect(crossCoupling([{ repo: 'o/web', commits: same }, { repo: 'o/mirror', commits: same }])).toEqual([]);
  });
});
