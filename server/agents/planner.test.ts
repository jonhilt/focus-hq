import { describe, expect, it } from 'vitest';
import { draftSchema } from './planner';

describe('draftSchema', () => {
  it('lets the planner flag an idea as too big, optionally', () => {
    const schema = draftSchema(['acme/shop']);
    expect(Object.keys(schema.properties as object)).toContain('tooBig');
    expect(schema.required).toEqual(['repo', 'title', 'body']);
  });
});

