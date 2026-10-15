import { describe, expect, it } from 'vitest';
import { messageFrom } from './transcript';

describe('messageFrom', () => {
  it('knows the office’s and QA’s messages by how they open', () => {
    expect(messageFrom('[Office] Slice 1 has landed')).toBe('office');
    expect(messageFrom('[QA officer Ensign Halloran] QA failed jonhilt/focus#154')).toBe('qa');
    expect(messageFrom('Please QA pull request #12 in demo/shop')).toBe('office');
    expect(messageFrom('This session is being continued from a previous conversation')).toBe('compacted');
  });

  it('leaves out the harness’s own messages, and takes the rest as the captain’s', () => {
    expect(messageFrom('<system-reminder>…</system-reminder>')).toBeNull();
    expect(messageFrom('<task-notification>done</task-notification>')).toBeNull();
    expect(messageFrom('can we make the doors quieter?')).toBe('captain');
  });
});
