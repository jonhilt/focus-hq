import { describe, expect, it } from 'vitest';
import { afterCloudRun, carryOnInNewSession } from './cloud';

describe('afterCloudRun', () => {
  it('delivers when new commits reached the branch', () => {
    expect(afterCloudRun({ before: 'aaa1111', after: 'bbb2222', nudged: false })).toBe('deliver');
  });

  it('asks once to push when nothing arrived', () => {
    expect(afterCloudRun({ before: 'aaa1111', after: 'aaa1111', nudged: false })).toBe('nudge');
    expect(afterCloudRun({ before: 'aaa1111', after: 'aaa1111', nudged: true })).toBe('deliver');
  });
});

describe('carryOnInNewSession', () => {
  it('starts over in a new session when reattaching failed before the session got going', () => {
    expect(carryOnInNewSession({ ok: false, summary: '', error: 'cloud session session_01 is archived' }, true)).toBe(true);
  });

  it('leaves real failures, stops and fresh sessions alone', () => {
    expect(carryOnInNewSession({ ok: false, summary: '', error: 'boom', started: true }, true)).toBe(false);
    expect(carryOnInNewSession({ ok: false, summary: '', error: 'Stopped by the captain', aborted: true }, true)).toBe(false);
    expect(carryOnInNewSession({ ok: false, summary: '', error: 'Session creation failed' }, false)).toBe(false);
    expect(carryOnInNewSession({ ok: true, summary: 'done', started: true }, true)).toBe(false);
  });

  it('never starts a second session beside one that is still working or waiting', () => {
    const busy = 'Error: cloud session session_01 is busy with a turn; wait for it to finish, or watch it at https://claude.ai/code/session_01, then send the message again.';
    expect(carryOnInNewSession({ ok: false, summary: '', error: busy }, true)).toBe(false);
    const asking = 'Error: cloud session session_01 is waiting on a question; answer it where it was asked (https://claude.ai/code/session_01) before sending it another message.';
    expect(carryOnInNewSession({ ok: false, summary: '', error: asking }, true)).toBe(false);
  });
});
