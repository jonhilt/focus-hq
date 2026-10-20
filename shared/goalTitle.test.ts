import { describe, expect, it } from 'vitest';
import { goalTitle } from './goalTitle';

describe('goal titles', () => {
  it('takes the captain’s first sentence of their first line, without its stop', () => {
    expect(goalTitle('\n  Saved items.\nmore')).toBe('Saved items');
    expect(goalTitle('Shoppers can save items for later. Then find them on any device')).toBe('Shoppers can save items for later');
    expect(goalTitle('Why does the cart empty itself?')).toBe('Why does the cart empty itself');
    expect(goalTitle('   ')).toBe('A new goal');
  });

  it('cuts a long sentence at its first clause, if that’s long enough to say something', () => {
    expect(goalTitle('we need better branch names - when merging PRS for example on the Thomas project I’ve realised')).toBe('we need better branch names');
    expect(goalTitle('Stock levels, shown on the product page and the cart, so shoppers know what’s left')).toBe('Stock levels, shown on the product page and the cart');
  });

  it('else cuts it at a word, leaving no small word hanging', () => {
    const long = goalTitle('Let shoppers save items for later from the cart and the product page then find them again on any device');
    expect(long).toBe('Let shoppers save items for later from the cart');
    expect(goalTitle(`Refactor ${'x'.repeat(80)}`)).toHaveLength(60);
  });
});
