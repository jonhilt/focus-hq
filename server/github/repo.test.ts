import { describe, expect, it } from 'vitest';
import { githubRepo } from './repo';

describe('githubRepo', () => {
  it('reads owner/repo from either form of a GitHub remote, and nothing from another host', () => {
    const REPO = 'jonhilt/focus';
    expect(githubRepo('https://github.com/jonhilt/focus.git\n')).toBe(REPO);
    expect(githubRepo('git@github.com:jonhilt/focus.git')).toBe(REPO);
    expect(githubRepo('https://github.com/jonhilt/focus')).toBe(REPO);
    expect(githubRepo('https://gitlab.com/jonhilt/focus.git')).toBeUndefined();
  });
});
