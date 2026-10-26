import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Snapshot } from '../shared/types';
import { Hub } from './hub';

let server: http.Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

/** A hub on a free port that refuses connections whose URL contains `refused`; where it listens. */
async function listening(): Promise<string> {
  server = http.createServer();
  new Hub().attach(server, () => new Promise<Snapshot>(() => undefined), (req) => (req.url?.includes('refused') ? 'refused' : undefined));
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The status a WebSocket's upgrade is answered with, 101 when it's let in. */
const upgradeStatus = (url: string) =>
  new Promise<number>((done) => {
    const ws = new WebSocket(url);
    ws.on('open', () => (ws.close(), done(101)));
    ws.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0));
    ws.on('error', () => undefined);
  });

describe('Hub', () => {
  it('lets a connection to /ws in, and refuses one it’s told to with a 403', async () => {
    const at = await listening();
    expect(await upgradeStatus(`${at}/ws`)).toBe(101);
    expect(await upgradeStatus(`${at}/ws?refused`)).toBe(403);
  });

  it('refuses any other upgrade it’s told to (Vite’s HMR), before what listens after it', async () => {
    const at = await listening();
    expect(await upgradeStatus(`${at}/hmr?refused`)).toBe(403);
  });
});
