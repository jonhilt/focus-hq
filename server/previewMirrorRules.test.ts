import { describe, expect, it } from 'vitest';
import { mirrorPlan } from './previewMirrorRules';

describe('mirrorPlan', () => {
  it('opens what’s wanted and missing, and closes what’s no longer wanted', () => {
    expect(mirrorPlan([5173, 8080], [8080, 3000])).toEqual({ open: [3000], close: [5173] });
    expect(mirrorPlan([], [])).toEqual({ open: [], close: [] });
  });
});
