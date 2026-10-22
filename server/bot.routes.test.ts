import express from 'express';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import type { PluginRoute } from './plugins/contract';
import { apiRouter } from './routes';

/** Focus's API with one plugin's routes, a bot token of `k`, and a request to it. */
async function withRoutes(routes: PluginRoute[], ask: (url: (path: string) => string) => Promise<void>) {
  const app = express();
  app.use('/api', apiRouter({ agents: { plugins: { routes: () => routes.map((route) => ({ plugin: 'inbox', route })) } } } as never, { projects: [], agents: new Map() } as never, () => 'k'));
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    await ask((path) => `http://127.0.0.1:${port}${path}`);
  } finally {
    server.close();
  }
}

const echo = (bot: boolean): PluginRoute => ({ method: 'post', path: '/items/:id/decide', bot, handle: ({ params, body }) => ({ id: params.id, body }) });

it('mounts a plugin’s route for bots at /api/bot<path>, open only to the bot token, with its path’s named parts', async () => {
  await withRoutes([echo(true)], async (url) => {
    const post = (headers: Record<string, string>) => fetch(url('/api/bot/items/t1/decide'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"send":true}' });
    expect((await post({})).status).toBe(401);
    const res = await post({ authorization: 'Bearer k' });
    expect(await res.json()).toEqual({ id: 't1', body: { send: true } });
    // not under the plugin's own prefix
    expect((await fetch(url('/api/plugins/inbox/items/t1/decide'), { method: 'POST' })).status).toBe(404);
  });
});

it('mounts a plugin’s other routes under /api/plugins/<id>, with their named parts', async () => {
  await withRoutes([echo(false)], async (url) => {
    const res = await fetch(url('/api/plugins/inbox/items/t2/decide'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(await res.json()).toEqual({ id: 't2', body: {} });
  });
});
