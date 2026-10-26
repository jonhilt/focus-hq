import { describe, expect, it } from 'vitest';
import { afterCloudRun, cantMoveToCloud, cloudRefused } from './cloudRules';

describe('afterCloudRun', () => {
  it('delivers when new commits reached the branch', () => {
    expect(afterCloudRun({ before: 'aaa1111', after: 'bbb2222', nudged: false })).toBe('deliver');
  });

  it('asks once to push when nothing arrived', () => {
    expect(afterCloudRun({ before: 'aaa1111', after: 'aaa1111', nudged: false })).toBe('nudge');
    expect(afterCloudRun({ before: 'aaa1111', after: 'aaa1111', nudged: true })).toBe('deliver');
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

  it('spots Claude Code refusing to attach to a cloud session with the SDK’s stream-json output', () => {
    const stderr = `Claude Code process exited with code 1
Error: --cloud <session_id> does not support --output-format stream-json`;
    expect(cloudRefused(stderr)).toBe(true);
    // a reworded refusal still counts
    expect(cloudRefused('Error: --output-format stream-json cannot be combined with --cloud <session_id|url>')).toBe(true);
  });

  it('leaves other failures alone', () => {
    expect(cloudRefused('Error: --cloud "fix it" cannot also take a positional prompt.\n--output-format stream-json')).toBe(false);
    expect(cloudRefused('Claude Code process exited with code 1')).toBe(false);
    expect(cloudRefused('Error: cloud session session_01 is archived')).toBe(false);
  });
});

describe('cantMoveToCloud', () => {
  const dev = { name: 'Ada', task: 'issue' as const, status: 'working' as const, sessionId: 'local-1' };

  it('moves a developer at work, finished or not started', () => {
    expect(cantMoveToCloud(dev)).toBeUndefined();
    expect(cantMoveToCloud({ ...dev, status: 'done' })).toBeUndefined();
    expect(cantMoveToCloud({ ...dev, task: 'fix', status: 'stopped' })).toBeUndefined();
    expect(cantMoveToCloud({ ...dev, status: 'queued', sessionId: undefined })).toBeUndefined();
  });

  it('keeps QA, leads and conflict resolution on this machine', () => {
    expect(cantMoveToCloud({ ...dev, task: 'review' })).toMatch(/browser/);
    expect(cantMoveToCloud({ ...dev, task: 'lead' })).toMatch(/side by side/);
    expect(cantMoveToCloud({ ...dev, task: 'conflicts' })).toMatch(/this machine/);
  });

  it('won’t move anyone twice, or while their work is half way to GitHub', () => {
    expect(cantMoveToCloud({ ...dev, cloud: true })).toMatch(/already works in the cloud/);
    expect(cantMoveToCloud({ ...dev, cloud: true, handover: { since: 1, fresh: false } })).toMatch(/already waiting/);
    expect(cantMoveToCloud({ ...dev, status: 'pushing' })).toMatch(/pushing/);
    expect(cantMoveToCloud({ ...dev, status: 'setting-up' })).toMatch(/setting up/);
    expect(cantMoveToCloud({ ...dev, status: 'queued' })).toMatch(/pick their work back up/);
  });
});
