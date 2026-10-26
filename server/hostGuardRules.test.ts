import { describe, expect, it } from 'vitest';
import { allowedHosts, allowedLogins, hostname, isTailnetAddress, listensBeyondLoopback, refusal, tailnetRefusal } from './hostGuardRules';

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

describe('tailnetRefusal', () => {
  const serve = { host: 'mac.tailnet.ts.net', remoteAddress: '127.0.0.1' };
  // a person's laptop through Tailscale Serve, and a tagged box (Grok Bot's) through it: Serve sets no login for that
  const person = { ...serve, forwardedFor: '100.101.102.103', login: 'jon@example.com' };
  const tagged = { ...serve, forwardedFor: '100.81.155.55' };

  it('lets this machine in on loopback, as before, on any route', () => {
    for (const host of ['127.0.0.1:4477', 'localhost:4477']) {
      expect(tailnetRefusal({ host, remoteAddress: '127.0.0.1', url: '/api/plugins/chief-of-staff/inbox' }, undefined)).toBeUndefined();
      expect(tailnetRefusal({ host, remoteAddress: '::1', url: '/ws' }, undefined)).toBeUndefined();
    }
  });

  it('lets a device a person owns in on any route, with any login', () => {
    for (const url of ['/', '/api/plugins/chief-of-staff/inbox', '/ws', '/api/bot/inbox']) expect(tailnetRefusal({ ...person, url }, undefined)).toBeUndefined();
  });

  it('with FOCUS_ALLOWED_LOGINS, only those logins', () => {
    const logins = allowedLogins(' Jon@Example.com , ops@example.com');
    expect(tailnetRefusal({ ...person, url: '/' }, logins)).toBeUndefined();
    expect(tailnetRefusal({ ...person, login: 'someone@else.com', url: '/' }, logins)).toMatch(/login someone@else\.com/);
    expect(allowedLogins(' , ')).toBeUndefined();
  });

  it('lets a tagged device reach only the bot’s routes, where the bot guard wants the token', () => {
    for (const url of ['/api/bot', '/api/bot/inbox', '/api/bot/inbox/turn:a:1/decide?x=1']) expect(tailnetRefusal({ ...tagged, url }, undefined)).toBeUndefined();
    for (const url of ['/', '/api/plugins/chief-of-staff/inbox', '/api/settings/bot/token', '/ws', '/api/botx', '/api/bot/../plugins/chief-of-staff/inbox', '/api/bot/%2e%2e/info'])
      expect(tailnetRefusal({ ...tagged, url }, undefined)).toMatch(/only on \/api\/bot/);
  });

  it('knows a tagged device that names this machine as localhost: Serve passes the Host on as sent', () => {
    expect(tailnetRefusal({ ...tagged, host: 'localhost:4477', url: '/api/plugins/chief-of-staff/inbox' }, undefined)).toBeDefined();
    expect(tailnetRefusal({ ...tagged, host: '127.0.0.1', forwardedFor: '::ffff:100.81.155.55', url: '/' }, undefined)).toBeDefined();
    expect(tailnetRefusal({ ...tagged, host: 'localhost', forwardedFor: 'fd7a:115c:a1e0::1', url: '/' }, undefined)).toBeDefined();
  });

  it('refuses a request through Funnel off the bot’s routes, whatever host it names', () => {
    const funnel = { host: 'localhost', remoteAddress: '127.0.0.1', forwardedFor: '203.0.113.9', funnel: '?1' };
    expect(tailnetRefusal({ ...funnel, url: '/' }, undefined)).toBeDefined();
    expect(tailnetRefusal({ ...funnel, url: '/api/bot/inbox' }, undefined)).toBeUndefined();
  });

  it('refuses a tailnet device reaching Focus directly, or by its .ts.net name, with no login', () => {
    expect(tailnetRefusal({ host: 'localhost:4477', remoteAddress: '100.81.155.55', url: '/' }, undefined)).toBeDefined();
    expect(tailnetRefusal({ host: 'mac.tailnet.ts.net:4477', remoteAddress: '127.0.0.1', url: '/' }, undefined)).toBeDefined();
  });

  it('leaves a FOCUS_ALLOWED_HOSTS name off the tailnet (the LAN, another proxy) to the host guard', () => {
    expect(tailnetRefusal({ host: 'focus.lan:4477', remoteAddress: '192.168.1.30', url: '/' }, undefined)).toBeUndefined();
    expect(tailnetRefusal({ host: 'focus.example.com', remoteAddress: '127.0.0.1', forwardedFor: '198.51.100.7', url: '/' }, undefined)).toBeUndefined();
  });
});

describe('isTailnetAddress', () => {
  it('is Tailscale’s 100.64.0.0/10 and fd7a:115c:a1e0::/48', () => {
    for (const a of ['100.64.0.1', '100.127.255.254', '100.114.71.102', '::ffff:100.81.155.55', 'FD7A:115C:A1E0:ab12::1', ' 100.100.1.1']) expect(isTailnetAddress(a)).toBe(true);
    for (const a of ['100.63.255.255', '100.128.0.1', '10.0.0.1', '127.0.0.1', '::1', 'fd7a:115c:a1e1::1', '']) expect(isTailnetAddress(a)).toBe(false);
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
