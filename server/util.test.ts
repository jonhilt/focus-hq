import { describe, expect, it } from 'vitest';
import { byteRange } from './util';

describe('byteRange', () => {
  it('reads the ranges a browser seeking in a video asks for', () => {
    expect(byteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(byteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(byteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
    expect(byteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('sends the whole thing for no range, or one it does not handle', () => {
    expect(byteRange(undefined, 1000)).toBeUndefined();
    expect(byteRange('bytes=0-1,5-9', 1000)).toBeUndefined();
    expect(byteRange('items=0-1', 1000)).toBeUndefined();
    expect(byteRange('bytes=-', 1000)).toBeUndefined();
  });

  it('says when a range starts past the end', () => {
    expect(byteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});
