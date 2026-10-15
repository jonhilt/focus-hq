import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { Live, LIVE_MODEL, type LiveEvent, readEvent, sessionConfig } from './live';

// gpt-live-1's client against a stand-in for OpenAI's Live API on this machine: creating a session for the browser's
// offer, and attaching the office's sideband to it.

let server: Server | undefined;
let wss: WebSocketServer | undefined;
afterEach(() => {
  wss?.close();
  server?.close();
});

interface Seen {
  auth?: string;
  path?: string;
  body?: unknown;
}

/** A stand-in Live API: answers session creation with `reply`, and accepts sidebands, handing each socket to `attached`. */
async function stub(status: number, reply: unknown, attached: (socket: WebSocket) => void = () => undefined) {
  const seen: Seen = {};
  server = createServer((req: IncomingMessage, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString()));
    req.on('end', () => {
      Object.assign(seen, { auth: req.headers.authorization, path: req.url, body: JSON.parse(text) as unknown });
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
    });
  });
  wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    Object.assign(seen, { auth: req.headers.authorization, path: req.url });
    attached(socket);
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/live/sessions`, seen };
}

const live = <A, E>(url: string, use: (live: Live['Service']) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* use(yield* Live);
  }).pipe(Effect.provide(Live.layer('sk-test', url)));

describe('sessionConfig', () => {
  it('hands work to the office and lets the browser do nothing but hang up', () => {
    const config = sessionConfig('v=0 offer') as { session: Record<string, unknown>; transport: unknown };
    expect(config.transport).toEqual({ type: 'webrtc', sdp: 'v=0 offer' });
    expect(config.session).toMatchObject({
      model: LIVE_MODEL,
      delegation: { type: 'client' },
      client: { data_channel: { allowed_client_events: ['session.close'] } },
    });
  });
});

describe('readEvent', () => {
  it('reads the events the call acts on, and ignores the rest', () => {
    expect(readEvent('{"type":"session.delegation.created","event_id":"e","offset_ms":10,"delegation":{"id":"item_1","type":"delegation","target":"client"}}')).toEqual({
      type: 'session.delegation.created',
      delegation: { id: 'item_1', target: 'client' },
    });
    expect(readEvent('{"type":"session.input_transcript.delta","delta":" the","start_ms":0,"end_ms":1}')).toEqual({ type: 'session.input_transcript.delta', delta: ' the' });
    expect(readEvent('{"type":"session.usage.updated"}')).toBeUndefined();
    expect(readEvent('not json')).toBeUndefined();
  });
});

describe('Live', () => {
  it('creates a session for the browser’s offer with the key, and returns its id and answer', async () => {
    const api = await stub(200, { session: { id: 'live_123' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } });
    const session = await Effect.runPromise(live(api.url, (l) => l.create('v=0 offer')));
    expect(session).toEqual({ id: 'live_123', sdp: 'v=0 answer' });
    expect(api.seen).toMatchObject({ auth: 'Bearer sk-test', path: '/v1/live/sessions', body: sessionConfig('v=0 offer') });
  });

  it('passes on what OpenAI said went wrong', async () => {
    const api = await stub(400, { error: { message: 'Unknown model' } });
    const error = await Effect.runPromise(Effect.flip(live(api.url, (l) => l.create('v=0 offer'))));
    expect(error.message).toBe("The voice call couldn't start: HTTP 400 (Unknown model)");
  });

  it('attaches the sideband to the session: hears its events, and sends the office’s', async () => {
    const received: unknown[] = [];
    const events: LiveEvent[] = [];
    let closed = false;
    const api = await stub(200, {}, (socket) => {
      socket.on('message', (data: Buffer) => received.push(JSON.parse(data.toString())));
      socket.send(JSON.stringify({ type: 'session.delegation.created', event_id: 'e1', offset_ms: 5, delegation: { id: 'item_1', type: 'delegation', target: 'client' } }));
    });
    const sideband = await Effect.runPromise(live(api.url, (l) => l.attach('live_123', { event: (e) => events.push(e), closed: () => (closed = true) })));
    expect(api.seen).toMatchObject({ auth: 'Bearer sk-test', path: '/v1/live/sessions/live_123/attach' });
    sideband.send({ type: 'session.commentary.append', delegation_id: 'item_1', content: 'All quiet.' });
    await expect.poll(() => received).toEqual([{ type: 'session.commentary.append', delegation_id: 'item_1', content: 'All quiet.' }]);
    await expect.poll(() => events).toEqual([{ type: 'session.delegation.created', delegation: { id: 'item_1', target: 'client' } }]);
    sideband.close();
    await expect.poll(() => closed).toBe(true);
  });
});
