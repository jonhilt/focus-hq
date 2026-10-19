import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http, { type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import type { Duplex } from 'node:stream';
import type { Preview, PreviewLink, PreviewMirror } from '../shared/types';
import { previewMirrors as settings } from './config';
import { errorMessage } from './util';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The machine's Tailscale addresses: 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
export function tailnetAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  return Object.values(interfaces).flatMap((list) => list ?? []).map((a) => a.address).filter((address) => {
    if (net.isIPv4(address)) {
      const [a, b] = address.split('.').map(Number);
      return a === 100 && b >= 64 && b < 128;
    }
    return address.toLowerCase().startsWith('fd7a:115c:a1e0:');
  });
}

/** Where the mirrors listen: FOCUS_PREVIEW_HOSTS (`off` for nowhere), else the tailnet addresses. */
export function mirrorHosts(setting: string | undefined, interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  if (setting?.trim() === 'off') return [];
  const listed = (setting ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return listed.length ? listed : tailnetAddresses(interfaces);
}

/**
 * The local ports worth mirroring, with the name to reach each by: the links of previews that are up, once a check has
 * found them answering (so the dev server has its port before the mirror takes the same one on another address).
 */
export function wantedPorts(previews: readonly Preview[]): Map<number, string> {
  const wanted = new Map<number, string>();
  for (const preview of previews) {
    if (preview.status === 'stopping' || preview.status === 'failed') continue;
    for (const link of preview.links) {
      if (link.health !== 'up' && link.health !== 'error') continue;
      const url = parseUrl(link.url);
      if (url && LOOPBACK.has(url.hostname) && url.port) wanted.set(Number(url.port), url.hostname.replace(/^\[|\]$/g, ''));
    }
  }
  return wanted;
}

/** Which mirrors to open and which to close, to go from the ones there are to the ones wanted. */
export function mirrorPlan(open: Iterable<number>, wanted: Iterable<number>): { open: number[]; close: number[] } {
  const have = new Set(open);
  const want = new Set(wanted);
  return { open: [...want].filter((p) => !have.has(p)), close: [...have].filter((p) => !want.has(p)) };
}

/**
 * A request's headers as the local site expects them: it's asked for by its local name (dev servers like Vite refuse
 * other names), from a page of its own local origin.
 */
export function localHeaders(headers: IncomingHttpHeaders, target: string): IncomingHttpHeaders {
  // the port is after the last colon, whatever the name before it (`::1:5173` is no URL's host)
  const local = `localhost:${target.slice(target.lastIndexOf(':') + 1)}`;
  const out: IncomingHttpHeaders = { ...headers, host: local };
  if (headers.origin) out.origin = `http://${local}`;
  if (typeof headers.referer === 'string') out.referer = relocated(headers.referer, `http://${local}`);
  return out;
}

/** A redirect to the local site, kept on the mirror: just its path. */
export function mirroredLocation(location: string, port: number): string {
  const url = parseUrl(location);
  return url && LOOPBACK.has(url.hostname) && Number(url.port) === port ? `${url.pathname}${url.search}${url.hash}` : location;
}

/** The first DNS name on a certificate (`tailscale cert` issues it for the machine's ts.net name). */
export function certHost(pem: string): string | undefined {
  const names = new X509Certificate(pem).subjectAltName ?? '';
  return /DNS:([^,\s]+)/.exec(names)?.[1];
}

function relocated(url: string, origin: string): string {
  const parsed = parseUrl(url);
  return parsed ? `${origin}${parsed.pathname}${parsed.search}` : url;
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

interface Tls {
  cert: string;
  key: string;
  host?: string;
}

interface Mirror {
  servers: Server[];
  scheme: PreviewMirror['scheme'];
  host?: string;
}

/**
 * Mirrors previews' local sites onto the machine's tailnet addresses, so a browser on another machine opens them: a
 * listener on each address at the site's own port forwards requests and WebSocket upgrades (hot reload) to the site,
 * by its local name. The sites themselves stay on loopback.
 */
export class PreviewMirrors {
  private mirrors = new Map<number, Mirror>();
  private opening = new Map<number, Promise<void>>();
  /** Mirrors still closing: a port opens again only once its old listeners are gone. */
  private closing = new Map<number, Promise<void>>();
  private listeners: (() => void)[] = [];

  constructor(
    private readonly hosts: () => string[] = () => mirrorHosts(settings.hosts, os.networkInterfaces()),
    private readonly tls: () => Tls | undefined = readTls,
  ) {}

  /** Called once a mirror opens or closes. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Opens and closes mirrors to match the previews' links. */
  sync(previews: readonly Preview[]): void {
    const wanted = wantedPorts(previews);
    const plan = mirrorPlan([...this.mirrors.keys(), ...this.opening.keys()], wanted.keys());
    for (const port of plan.close) void this.close(port);
    for (const port of plan.open) {
      const target = wanted.get(port);
      if (target === undefined) continue;
      const opening = this.open(port, target).finally(() => this.opening.delete(port));
      this.opening.set(port, opening);
    }
  }

  /** The mirrors of these links' ports. */
  reach(links: readonly PreviewLink[]): PreviewMirror[] | undefined {
    const ports = new Set(links.map((l) => Number(parseUrl(l.url)?.port)));
    const found = [...this.mirrors].filter(([port]) => ports.has(port)).map(([port, m]): PreviewMirror => ({ port, scheme: m.scheme, ...(m.host && { host: m.host }) }));
    return found.length ? found : undefined;
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.opening.values());
    await Promise.all([...this.mirrors.keys()].map((port) => this.close(port)));
  }

  private async open(port: number, target: string): Promise<void> {
    await this.closing.get(port);
    const hosts = this.hosts();
    if (!hosts.length) return;
    const tls = this.tls();
    const servers = (await Promise.all(hosts.map((host) => listen(mirrorServer(port, target, tls), port, host)))).filter((s): s is Server => !!s);
    if (!servers.length) return;
    this.mirrors.set(port, { servers, scheme: tls ? 'https' : 'http', ...(tls?.host && { host: tls.host }) });
    this.changed();
  }

  private async close(port: number): Promise<void> {
    await this.opening.get(port);
    const mirror = this.mirrors.get(port);
    if (!mirror) return;
    this.mirrors.delete(port);
    const closed = Promise.all(mirror.servers.map((s) => new Promise<void>((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections();
    }))).then(() => undefined);
    this.closing.set(port, closed);
    await closed;
    if (this.closing.get(port) === closed) this.closing.delete(port);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

function readTls(): Tls | undefined {
  if (!existsSync(settings.cert) || !existsSync(settings.key)) return undefined;
  try {
    const cert = readFileSync(settings.cert, 'utf8');
    return { cert, key: readFileSync(settings.key, 'utf8'), host: certHost(cert) };
  } catch (err) {
    console.warn(`Preview mirrors: can't use the certificate at ${settings.cert}, serving http: ${String(err)}`);
    return undefined;
  }
}

/** Listens, or gives up quietly: the address may be gone, or the site may already listen there itself (on 0.0.0.0, say). */
function listen(server: Server, port: number, host: string): Promise<Server | undefined> {
  return new Promise((resolve) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') console.warn(`Preview mirrors: can't listen on ${host}:${port}: ${err.message}`);
      resolve(undefined);
    });
    server.listen(port, host, () => resolve(server));
  });
}

/** A server that forwards everything to the local site on `port`, by the name `target` it's reached at. */
function mirrorServer(port: number, target: string, tls: Tls | undefined): Server {
  const forward = (req: IncomingMessage, res: http.ServerResponse) => {
    const failed = (err: unknown) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`The preview isn't answering: ${errorMessage(err)}`);
    };
    // a throw in here would take the office down with it
    try {
      const upstream = http.request({ host: target, port, method: req.method, path: req.url, headers: localHeaders(req.headers, `${target}:${port}`) }, (answer) => {
        const headers = { ...answer.headers };
        if (typeof headers.location === 'string') headers.location = mirroredLocation(headers.location, port);
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, headers);
        answer.pipe(res);
      });
      upstream.on('error', failed);
      req.pipe(upstream);
    } catch (err) {
      failed(err);
    }
  };
  const server = tls ? https.createServer({ cert: tls.cert, key: tls.key }, forward) : http.createServer(forward);
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => upgrade(req, socket, head, port, target));
  return server;
}

/** Hands a WebSocket upgrade (a dev server's hot reload) through to the local site, then pipes the two sockets together. */
function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number, target: string): void {
  socket.on('error', () => socket.destroy());
  let upstream: http.ClientRequest;
  try {
    upstream = http.request({ host: target, port, method: req.method, path: req.url, headers: localHeaders(req.headers, `${target}:${port}`) });
  } catch {
    socket.destroy();
    return;
  }
  upstream.on('upgrade', (answer, theirs, theirHead) => {
    const lines = [`HTTP/1.1 ${answer.statusCode ?? 101} ${answer.statusMessage ?? 'Switching Protocols'}`];
    for (let i = 0; i < answer.rawHeaders.length; i += 2) lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (theirHead.length) socket.write(theirHead);
    if (head.length) theirs.write(head);
    theirs.pipe(socket);
    socket.pipe(theirs);
    theirs.on('error', () => socket.destroy());
    socket.on('error', () => theirs.destroy());
  });
  upstream.on('response', (answer) => {
    socket.end(`HTTP/1.1 ${answer.statusCode ?? 502} ${answer.statusMessage ?? ''}\r\nConnection: close\r\n\r\n`);
    answer.resume();
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}
