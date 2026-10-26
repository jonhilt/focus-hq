import http from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { Preview, PreviewLink } from '../shared/types';
import { certHost, localHeaders, mirroredLocation, mirrorHosts, PreviewMirrors, tailnetAddresses, wantedPorts } from './previewMirrors';

const nic = (address: string): NetworkInterfaceInfo =>
  address.includes(':') ? { address, netmask: '', family: 'IPv6', mac: '', internal: false, cidr: null, scopeid: 0 } : { address, netmask: '', family: 'IPv4', mac: '', internal: false, cidr: null };
const interfaces = { lo0: [nic('127.0.0.1'), nic('::1')], en0: [nic('192.168.1.20')], utun4: [nic('100.101.102.103'), nic('fd7a:115c:a1e0::1')] };

const preview = (status: Preview['status'], links: PreviewLink[]): Preview => ({
  projectId: 'p', repo: 'o/r', number: 1, title: 't', set: {}, checkouts: [], status, activity: '', links, startedAt: 0,
});

describe('tailnetAddresses', () => {
  it('finds the machine’s Tailscale addresses and nothing else', () => {
    expect(tailnetAddresses(interfaces)).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::1']);
    expect(tailnetAddresses({ eth0: [nic('100.10.0.1'), nic('100.128.0.1')] })).toEqual([]);
  });
});

describe('mirrorHosts', () => {
  it('takes FOCUS_PREVIEW_HOSTS, `off` for none, and the tailnet addresses without it', () => {
    expect(mirrorHosts(undefined, interfaces)).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::1']);
    expect(mirrorHosts('10.0.0.5, 10.0.0.6', interfaces)).toEqual(['10.0.0.5', '10.0.0.6']);
    expect(mirrorHosts('off', interfaces)).toEqual([]);
  });
});

describe('wantedPorts', () => {
  it('mirrors the local links of live previews once they answer', () => {
    const previews = [
      preview('running', [{ url: 'http://localhost:5173/', health: 'up' }, { url: 'http://127.0.0.1:8080/api', health: 'error' }, { url: 'http://localhost:9000/', health: 'down' }]),
      preview('starting', [{ url: 'http://[::1]:3000/' }]),
      preview('running', [{ url: 'https://example.com:4000/', health: 'up' }]),
    ];
    expect([...wantedPorts(previews)]).toEqual([[5173, 'localhost'], [8080, '127.0.0.1']]);
  });

  it('lets go of previews being stopped or that failed', () => {
    expect(wantedPorts([preview('stopping', [{ url: 'http://localhost:5173/', health: 'up' }]), preview('failed', [{ url: 'http://localhost:5174/', health: 'up' }])]).size).toBe(0);
  });
});

describe('localHeaders', () => {
  it('asks for the site by its local name, from its own local origin', () => {
    const headers = localHeaders({ host: 'vps.tail1.ts.net:5173', origin: 'https://vps.tail1.ts.net:5173', referer: 'https://vps.tail1.ts.net:5173/app?x=1', accept: '*/*' }, '127.0.0.1:5173');
    expect(headers).toEqual({ host: 'localhost:5173', origin: 'http://localhost:5173', referer: 'http://localhost:5173/app?x=1', accept: '*/*' });
    expect(localHeaders({ host: 'vps:5173' }, 'localhost:5173')).toEqual({ host: 'localhost:5173' });
    expect(localHeaders({ host: 'vps:5173' }, '::1:5173')).toEqual({ host: 'localhost:5173' });
  });
});

describe('mirroredLocation', () => {
  it('keeps a redirect to the local site on the mirror, and leaves others alone', () => {
    expect(mirroredLocation('http://localhost:5173/login?next=%2F#top', 5173)).toBe('/login?next=%2F#top');
    expect(mirroredLocation('http://localhost:3000/', 5173)).toBe('http://localhost:3000/');
    expect(mirroredLocation('/relative', 5173)).toBe('/relative');
    expect(mirroredLocation('https://github.com/login', 5173)).toBe('https://github.com/login');
  });
});

// a throwaway self-signed certificate, as `tailscale cert` would issue for a machine
const CERT = `-----BEGIN CERTIFICATE-----
MIIBsjCCAVegAwIBAgIUPSI9bMd3+sk7dHhmyqmbTOEKDwUwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTdnBzLnRhaWwxMjM0LnRzLm5ldDAeFw0yNjEwMTkxMTI5NDVa
Fw0zNjEwMTYxMTI5NDVaMB4xHDAaBgNVBAMME3Zwcy50YWlsMTIzNC50cy5uZXQw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASLtT5opAZF3yXAYrpxfHKVfVskrUyS
4yZHogeVNqjxObX65ePg5XA+c7sT3OdogHG955297ajBeKCM0vPFqIZZo3MwcTAd
BgNVHQ4EFgQUQBpl7/Ryw2uIwSfkL8xbjjqBAacwHwYDVR0jBBgwFoAUQBpl7/Ry
w2uIwSfkL8xbjjqBAacwDwYDVR0TAQH/BAUwAwEB/zAeBgNVHREEFzAVghN2cHMu
dGFpbDEyMzQudHMubmV0MAoGCCqGSM49BAMCA0kAMEYCIQCkYbUh+QxIquIrtqZy
jTtpNgq+AT6Q6rzzAxXiqs+UwwIhAPOKfdmxlFOt7shFO5s3gWPNnApNhk87OSbN
zj4CYRnQ
-----END CERTIFICATE-----`;

describe('certHost', () => {
  it('reads the name the certificate is for', () => {
    expect(certHost(CERT)).toBe('vps.tail1234.ts.net');
  });
});

describe('PreviewMirrors', () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((f) => f()));
  });

  /** A dev server on 127.0.0.1 that tells what it was asked for, with a WebSocket that echoes. */
  async function devServer(bind = '127.0.0.1'): Promise<number> {
    const server = http.createServer((req, res) => {
      if (req.url === '/away') return void res.writeHead(302, { location: `http://localhost:${port}/here` }).end();
      res.end(JSON.stringify({ host: req.headers.host, url: req.url }));
    });
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => ws.on('message', (m) => ws.send(`${req.headers.host} ${String(m)}`)));
    await new Promise<void>((resolve) => server.listen(0, bind, resolve));
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    cleanup.push(() => new Promise((resolve) => {
      wss.close();
      server.closeAllConnections();
      server.close(() => resolve());
    }));
    return port;
  }

  async function mirrored(port: number, link = `http://127.0.0.1:${port}/`, on = '::1'): Promise<PreviewMirrors> {
    const mirrors = new PreviewMirrors(() => [on], () => undefined);
    cleanup.push(() => mirrors.shutdown());
    const opened = new Promise<void>((resolve) => mirrors.onChange(resolve));
    mirrors.sync([preview('running', [{ url: link, health: 'up' }])]);
    await opened;
    return mirrors;
  }

  it('forwards requests to the site by its local name, and keeps its redirects on the mirror', async () => {
    const port = await devServer();
    const mirrors = await mirrored(port);
    expect(mirrors.reach([{ url: `http://127.0.0.1:${port}/` }])).toEqual([{ port, scheme: 'http' }]);
    const res = await fetch(`http://[::1]:${port}/app?x=1`);
    expect(await res.json()).toEqual({ host: `localhost:${port}`, url: '/app?x=1' });
    const away = await fetch(`http://[::1]:${port}/away`, { redirect: 'manual' });
    expect(away.headers.get('location')).toBe('/here');
  });

  it('forwards to a site linked by its IPv6 loopback address', async () => {
    const port = await devServer('::1');
    await mirrored(port, `http://[::1]:${port}/`, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${port}/app`);
    expect(await res.json()).toEqual({ host: `localhost:${port}`, url: '/app' });
  });

  it('hands WebSocket upgrades through, for hot reload', async () => {
    const port = await devServer();
    await mirrored(port);
    const ws = new WebSocket(`ws://[::1]:${port}/`, { headers: { origin: `http://vps:${port}` } });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('ping'));
      ws.on('message', (m) => resolve(String(m)));
      ws.on('error', reject);
    });
    ws.close();
    expect(reply).toBe(`localhost:${port} ping`);
  });

  it('closes a mirror once its preview is gone', async () => {
    const port = await devServer();
    const mirrors = await mirrored(port);
    const closed = new Promise<void>((resolve) => mirrors.onChange(resolve));
    mirrors.sync([]);
    await closed;
    expect(mirrors.reach([{ url: `http://127.0.0.1:${port}/` }])).toBeUndefined();
    await expect(fetch(`http://[::1]:${port}/`)).rejects.toThrow();
  });
});

describe('mirror of a site linked by [::1]', () => {
  it('builds local headers for the target the plan hands to the forwarder', () => {
    const wanted = wantedPorts([{ projectId: 'p', repo: 'o/r', number: 1, title: 't', set: {}, checkouts: [], status: 'running', activity: '', links: [{ url: 'http://[::1]:5173/', health: 'up' }], startedAt: 0 }]);
    const target = wanted.get(5173) as string;
    // mirrorServer calls localHeaders(req.headers, `${target}:${port}`) for every request
    const build = () => localHeaders({ host: 'vps:5173' }, `${target}:5173`);
    expect(build).not.toThrow();
    expect(build().host).toBe('localhost:5173');
  });
});
