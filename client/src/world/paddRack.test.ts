import { describe, expect, it } from 'vitest';
import { paddPiles } from './paddRack';

const prs = (...numbers: number[]) => numbers.map((number) => ({ number }));
const sizes = (piles: { number: number }[][]) => piles.map((p) => p.length);

describe('paddPiles', () => {
  it('gives each pull request a pile of one to three PADDs, by its number', () => {
    const piles = paddPiles(prs(3, 4, 5), (pr) => pr.number);
    expect(sizes(piles)).toEqual([1, 2, 3]);
    expect(piles[1].every((pr) => pr.number === 4)).toBe(true);
  });

  it('is empty with nothing to review', () => {
    expect(paddPiles([], () => 0)).toEqual([]);
  });

  it('stacks pull requests beyond the rack onto its piles in turn', () => {
    const piles = paddPiles(prs(3, 6, 9, 12, 15), (pr) => pr.number, 2);
    // 3, 9 and 15 on the first pile; 6 and 12 on the second; a PADD each
    expect(piles.map((p) => p.map((pr) => pr.number))).toEqual([[3, 9, 15], [6, 12]]);
  });
});
