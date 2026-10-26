import { describe, expect, it } from 'vitest';
import { safeDescription, terminalDescription } from './terminalText';

describe('safeDescription', () => {
  it('keeps plain words and punctuation, and drops what a shell or cmd.exe would read', () => {
    expect(safeDescription('Focus HQ: Ada on acme/shop#12 (dark mode).')).toBe('Focus HQ: Ada on acme/shop#12 (dark mode).');
    expect(safeDescription('a "quoted" 100% & | <b> $x `y` ^z it\'s')).toBe('a quoted 100 b x y z it s');
  });

  it('is cut to length', () => {
    expect(safeDescription('word '.repeat(100), 20)).toBe('word word word word');
  });
});

describe('terminalDescription', () => {
  it('says who it’s for and asks the session to wait, in words any command line takes as they are', () => {
    const text = terminalDescription({ name: 'Ada', repo: 'acme/shop', issue: { number: 12, title: 'Dark "mode" & more', url: '' } });
    expect(text).toMatch(/^Focus HQ: Ada on acme\/shop#12\. .*reply only with the word Ready\.$/);
    expect(safeDescription(text)).toBe(text);
  });
});
