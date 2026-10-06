import { describe, expect, it } from 'vitest';
import { demoTooBig } from './demoRunner';

describe('demoTooBig', () => {
  it('flags a rebuild with a list of features', () => {
    expect(demoTooBig('rebuild checkout with saved cards, guest checkout and gift wrapping')).toMatch(/3 separate features/);
  });

  it('flags a list of three or more features', () => {
    expect(demoTooBig('add wishlists, reviews and a loyalty scheme')).toBeDefined();
  });

  it('leaves an ordinary small idea alone', () => {
    expect(demoTooBig('let shoppers save items for later from the cart')).toBeUndefined();
    expect(demoTooBig('show name and email on the account page')).toBeUndefined();
  });
});
