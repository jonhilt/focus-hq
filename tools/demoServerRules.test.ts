import { describe, expect, it } from 'vitest';
import { decodeRecord, demoHealth, describeDemo, parseDemoArgs, startPlan, stopTarget, type DemoRecord } from './demoServerRules';

const record: DemoRecord = {
  v: 1, pid: 4242, port: 51234, url: 'http://127.0.0.1:51234/', dataDir: '/w/.demo/data', log: '/w/.demo/demo.log',
  commit: 'abcdef0123456789', dirty: false, built: false, startedAt: 1,
};

describe('parseDemoArgs', () => {
  it('reads the command and --built, past pnpm\'s --', () => {
    expect(parseDemoArgs(['start'])).toEqual({ command: 'start', built: false });
    expect(parseDemoArgs(['start', '--', '--built'])).toEqual({ command: 'start', built: true });
    expect(parseDemoArgs(['status'])).toEqual({ command: 'status', built: false });
  });

  it('refuses a missing or unknown command, an unknown option, and --built off start', () => {
    expect(parseDemoArgs([])).toHaveProperty('error');
    expect(parseDemoArgs(['restart'])).toHaveProperty('error');
    expect(parseDemoArgs(['start', '--port'])).toHaveProperty('error');
    expect(parseDemoArgs(['stop', '--built'])).toHaveProperty('error');
  });
});

describe('decodeRecord', () => {
  it('reads what start wrote and nothing else', () => {
    expect(decodeRecord(JSON.stringify(record))).toEqual(record);
    expect(decodeRecord(JSON.stringify({ ...record, pid: '4242' }))).toBeUndefined();
    expect(decodeRecord('not json')).toBeUndefined();
  });
});

describe('demoHealth', () => {
  it('goes by the record, the process and whether it answers', () => {
    expect(demoHealth(undefined, false, false)).toBe('none');
    expect(demoHealth(record, false, true)).toBe('gone');
    expect(demoHealth(record, true, false)).toBe('stuck');
    expect(demoHealth(record, true, true)).toBe('up');
  });
});

describe('startPlan', () => {
  it('keeps a demo that is up and serving the client as asked', () => {
    expect(startPlan('up', record, false)).toBe('reuse');
  });

  it('replaces its own demo when it is stuck or serves the client the other way', () => {
    expect(startPlan('stuck', record, false)).toBe('replace');
    expect(startPlan('up', record, true)).toBe('replace');
  });

  it('launches when there is none or it has gone', () => {
    expect(startPlan('none', undefined, false)).toBe('launch');
    expect(startPlan('gone', record, false)).toBe('launch');
  });
});

describe('stopTarget', () => {
  it('is only ever the recorded pid, while it lives', () => {
    expect(stopTarget('up', record)).toBe(4242);
    expect(stopTarget('stuck', record)).toBe(4242);
    expect(stopTarget('gone', record)).toBeUndefined();
    expect(stopTarget('none', undefined)).toBeUndefined();
  });
});

describe('describeDemo', () => {
  const head = { commit: record.commit, dirty: false };

  it('leads with the URL and says how the client is served', () => {
    const text = describeDemo('up', record, head);
    expect(text.split('\n')[0]).toBe('Demo ship up at http://127.0.0.1:51234/');
    expect(text).toContain('hot reload');
    expect(text).not.toContain('now');
  });

  it('says when the checkout has moved on since it started', () => {
    expect(describeDemo('up', record, { commit: '9999999999', dirty: false })).toContain('the checkout is at 99999999 now');
    expect(describeDemo('up', record, { ...head, dirty: true })).toContain('with uncommitted changes now');
    expect(describeDemo('up', { ...record, dirty: true }, { ...head, dirty: true })).not.toContain('now');
  });

  it('says how to start one when there is none or it has gone', () => {
    expect(describeDemo('none', undefined, head)).toContain('pnpm run demo:start');
    expect(describeDemo('gone', record, head)).toContain('has exited');
  });
});
