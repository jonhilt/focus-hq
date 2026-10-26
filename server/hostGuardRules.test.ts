import { describe, expect, it } from 'vitest';
import { allowedHosts, hostname, listensBeyondLoopback, refusal } from './hostGuardRules';

const machine = { hostname: 'my-mac', addresses: ['127.0.0.1', '192.168.1.20', 'fe80::1'] };
const local = allowedHosts('127.0.0.1', '', machine);

describe('hostname', () => {
  it('drops the port and an IPv6 address’s brackets', () => {
    expect(hostname('localhost:4477')).toBe('localhost');
    expect(hostname('[::1]:4477')).toBe('::1');
    expect(hostname('Mac.Tailnet.ts.net')).toBe('mac.tailnet.ts.net');
  });
});

describe('refusal', () => {
  it('lets the captain’s own browser in, by any loopback name', () => {
    for (const host of ['localhost:4477', '127.0.0.1:4477', '[::1]:4477']) {
      expect(refusal({ host }, local)).toBeUndefined();
      expect(refusal({ host, origin: `http://${host}` }, local)).toBeUndefined();
    }
  });

  it('lets the Tricorder in through Tailscale Serve', () => {
    const host = 'mac.tailnet.ts.net';
    expect(refusal({ host, origin: `https://${host}` }, local)).toBeUndefined();
  });

  it('refuses another site’s name pointed at this machine (DNS rebinding)', () => {
    expect(refusal({ host: 'evil.example:4477', origin: 'http://evil.example:4477' }, local)).toMatch(/host evil\.example/);
    expect(refusal({}, local)).toMatch(/host \(none\)/);
  });

  it('refuses another site’s page, and a sandboxed one, driving Focus', () => {
    expect(refusal({ host: 'localhost:4477', origin: 'https://evil.example' }, local)).toMatch(/pages from https:\/\/evil\.example/);
    expect(refusal({ host: 'localhost:4477', origin: 'null' }, local)).toMatch(/pages from null/);
    expect(refusal({ host: 'localhost:4477', origin: 'https://localhost.evil.example' }, local)).toBeDefined();
  });

  it('refuses a page from another app on this machine, or another machine on a tailnet', () => {
    expect(refusal({ host: 'localhost:4477', origin: 'http://localhost:3000' }, local)).toMatch(/pages from http:\/\/localhost:3000/);
    expect(refusal({ host: 'localhost:4477', origin: 'http://127.0.0.1:4477' }, local)).toBeDefined();
    expect(refusal({ host: 'mac.tailnet.ts.net', origin: 'https://evil.ts.net' }, local)).toMatch(/pages from https:\/\/evil\.ts\.net/);
    expect(refusal({ host: 'localhost:4477', origin: 'https://mac.tailnet.ts.net' }, local)).toBeDefined();
  });

  it('lets scripts and curl in with no Origin, on a known host', () => {
    expect(refusal({ host: 'localhost:4477' }, local)).toBeUndefined();
  });
});

describe('allowedHosts', () => {
  it('adds the host Focus listens on, and FOCUS_ALLOWED_HOSTS’s names and suffixes', () => {
    const hosts = allowedHosts('focus.lan', 'Office.Example, .corp.example', machine);
    expect(refusal({ host: 'focus.lan:4477' }, hosts)).toBeUndefined();
    expect(refusal({ host: 'office.example' }, hosts)).toBeUndefined();
    expect(refusal({ host: 'Office.Example', origin: 'https://office.example' }, hosts)).toBeUndefined();
    expect(refusal({ host: 'me.corp.example', origin: 'https://me.corp.example' }, hosts)).toBeUndefined();
    expect(refusal({ host: '192.168.1.20:4477' }, hosts)).toBeDefined();
  });

  it('listening on every interface adds the machine’s own name and addresses', () => {
    const hosts = allowedHosts('0.0.0.0', '', machine);
    expect(refusal({ host: '192.168.1.20:4477', origin: 'http://192.168.1.20:4477' }, hosts)).toBeUndefined();
    expect(refusal({ host: 'my-mac.local:4477' }, hosts)).toBeUndefined();
    expect(refusal({ host: '0.0.0.0:4477' }, hosts)).toBeDefined();
  });
});

describe('listensBeyondLoopback', () => {
  it('is true for anything but a loopback name', () => {
    expect(listensBeyondLoopback('127.0.0.1')).toBe(false);
    expect(listensBeyondLoopback('localhost')).toBe(false);
    expect(listensBeyondLoopback('0.0.0.0')).toBe(true);
    expect(listensBeyondLoopback('192.168.1.20')).toBe(true);
  });
});
