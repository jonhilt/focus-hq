import { describe, expect, it } from 'vitest';
import { afterCloudRun, CLOUD_UNAVAILABLE, carryOnInNewSession, cloudRefused, fallBackToLocal } from './cloud';

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

  it('does not start a new session when Claude Code refuses to start cloud sessions', () => {
    expect(carryOnInNewSession({ ok: false, summary: '', error: CLOUD_UNAVAILABLE }, true)).toBe(false);
  });
});

describe('fallBackToLocal', () => {
  const refused = { ok: false, summary: '', error: CLOUD_UNAVAILABLE };

  it('carries on locally when Claude Code refuses to start a cloud session', () => {
    expect(fallBackToLocal({ cloud: true }, refused)).toBe(true);
  });

  it('leaves stops, successes, other errors and local agents alone', () => {
    expect(fallBackToLocal({ cloud: true }, { ...refused, aborted: true })).toBe(false);
    expect(fallBackToLocal({ cloud: true }, { ok: true, summary: 'done' })).toBe(false);
    expect(fallBackToLocal({ cloud: true }, { ok: false, summary: '', error: 'Error: cloud session session_01 is busy with a turn' })).toBe(false);
    expect(fallBackToLocal({ cloud: true }, { ok: false, summary: '', error: 'boom', started: true })).toBe(false);
    expect(fallBackToLocal({}, refused)).toBe(false);
  });
});

describe('cloudRefused', () => {
  it('spots Claude Code refusing to start a cloud session without a terminal', () => {
    const stderr = `Claude Code process exited with code 1
Error: --cloud requires an interactive terminal.
Non-interactive invocations (piped stdout, --init-only, --sdk-url) run locally and would silently ignore --cloud. Drop --cloud, or run from a TTY.`;
    expect(cloudRefused(stderr)).toBe(true);
    const notAnId = `Error: --cloud "fix it" is not a cloud session ID or URL.
Without an interactive terminal, --cloud can only send the prompt to an existing cloud session: pass its ID (session_... or cse_...) or its claude.ai/code URL. To start a new cloud session, run from a TTY.`;
    expect(cloudRefused(notAnId)).toBe(true);
  });

  it('leaves other failures alone', () => {
    expect(cloudRefused('Claude Code process exited with code 1')).toBe(false);
    expect(cloudRefused('Error: cloud session session_01 is archived')).toBe(false);
  });
});
