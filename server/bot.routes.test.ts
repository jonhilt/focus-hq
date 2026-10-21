import express from 'express';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { apiRouter } from './routes';

// hoisted above the imports by vitest, so the routes get this inbox
vi.mock('./captainsInbox', () => ({
  Inbox: class {
    autoSend() {}
    view() {
      return { open: [{ id: 't1', kind: 'turn', projectId: 'p', who: 'R', goal: 'G', what: 'W', lane: 'needs-you', shown: [{ title: 'T', html: '/api/artifacts/a/t.html?v=1', image: '/api/artifacts/a/t.jpg?v=1' }] }], decided: [] };
    }
  },
}));

it('GET /api/bot/inbox serves absolute links when FOCUS_PUBLIC_URL is set', async () => {
  const app = express();
  app.use('/api', apiRouter({ agents: { plugins: { routes: () => [] } } } as never, { projects: [], agents: new Map() } as never, { token: 'k', webhook: undefined, publicUrl: 'https://mac.ts.net:4477' }));
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/bot/inbox`, { headers: { authorization: 'Bearer k' } });
    const body = (await res.json()) as { open: { shown: { html: string; image: string }[] }[] };
    expect(body.open[0].shown[0].html).toBe('https://mac.ts.net:4477/api/artifacts/a/t.html?v=1');
    expect(body.open[0].shown[0].image).toBe('https://mac.ts.net:4477/api/artifacts/a/t.jpg?v=1');
  } finally {
    server.close();
  }
});
