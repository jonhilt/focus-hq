import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { Jev, JEV_MODEL, type JevQuestion } from './jev';

// Jev's client against a stand-in for TypeSafe's API on this machine: what it sends, and what it makes of the reply.

let server: Server | undefined;
afterEach(() => server?.close());

/** Serves one reply; resolves with the URL and, once asked, the request it got. */
async function stub(status: number, body: string) {
  let request!: { auth?: string; body: unknown };
  server = createServer((req: IncomingMessage, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString()));
    req.on('end', () => {
      request = { auth: req.headers.authorization, body: JSON.parse(text) as unknown };
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(body);
    });
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/systemone`, request: () => request };
}

const questions: Record<string, JevQuestion> = { action: { type: 'choice', instructions: 'What?', criteria: { status: 'Status', other: 'Else' } } };
const ask = (url: string) =>
  Effect.gen(function* () {
    const jev = yield* Jev;
    return yield* jev.ask('The captain said: status', questions);
  }).pipe(Effect.provide(Jev.layer('sk-test', url)));

describe('Jev', () => {
  it('posts the state and typed questions with the key, and reads the answers', async () => {
    const api = await stub(200, JSON.stringify({ model: 'jev-latest', answers: { action: { type: 'choice', choice: 'status', confidence: 0.97, probabilities: { status: 0.97, other: 0.03 } } }, usage: {} }));
    const answers = await Effect.runPromise(ask(api.url));
    expect(answers.action).toEqual({ type: 'choice', choice: 'status', confidence: 0.97, probabilities: { status: 0.97, other: 0.03 } });
    expect(api.request()).toEqual({ auth: 'Bearer sk-test', body: { model: JEV_MODEL, state: 'The captain said: status', questions } });
  });

  it('says a refused key is the trouble', async () => {
    const api = await stub(401, '{"error":"invalid key"}');
    const error = await Effect.runPromise(Effect.flip(ask(api.url)));
    expect(error._tag).toBe('JevFailed');
    expect(error.message).toContain('the TypeSafe API key was refused');
  });

  it("fails clearly on a reply it can't read", async () => {
    const api = await stub(200, '{"answers": "nope"}');
    const error = await Effect.runPromise(Effect.flip(ask(api.url)));
    expect(error._tag).toBe('JevBadReply');
  });

  it("fails clearly when Jev can't be reached", async () => {
    const error = await Effect.runPromise(Effect.flip(ask('http://127.0.0.1:1/v1/systemone')));
    expect(error._tag).toBe('JevUnreachable');
  });
});
