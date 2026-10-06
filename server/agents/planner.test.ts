import { describe, expect, it } from 'vitest';
import { draftSchema, standDraftSchema } from './planner';

describe('standDraftSchema', () => {
  it('lets the stand flag an idea as too big, optionally, and keeps it out of the briefing wrap-up', () => {
    const stand = standDraftSchema(['acme/shop']);
    expect(Object.keys(stand.properties as object)).toContain('tooBig');
    expect(stand.required).toEqual(['repo', 'title', 'body']);
    expect(Object.keys(draftSchema(['acme/shop']).properties as object)).not.toContain('tooBig');
  });
});
