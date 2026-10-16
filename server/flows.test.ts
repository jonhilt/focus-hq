import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { config } from './config';
import { FlowRecorder } from './flows';

/** A request the router has answered, as the recorder sees it once it's finished. */
function answered(recorder: FlowRecorder, req: { path: string; method: string; route?: { path: string }; from?: string }): void {
  const res = new EventEmitter();
  const request = { ...req, get: (h: string) => (h === 'x-focus-from' ? req.from : undefined) };
  let passed = false;
  recorder.http(request as unknown as Request, res as unknown as Response, (() => (passed = true)) as NextFunction);
  expect(passed).toBe(true);
  res.emit('finish');
}

describe('FlowRecorder', () => {
  it('puts an event to the file that asked the hub to send it', () => {
    const recorder = new FlowRecorder(config.root);
    const sendFromHere = () => recorder.ws('agent');
    sendFromHere();
    sendFromHere();
    expect(recorder.recording('a test').flows).toEqual([{ via: 'ws', name: 'agent', from: 'server/flows.test.ts', to: 'client/src/net/state.ts', count: 2 }]);
  });

  it('puts an /api request to the browser’s file that made it, and the route that answered it', () => {
    const recorder = new FlowRecorder(config.root);
    answered(recorder, { path: '/api/goals/7/message', method: 'POST', route: { path: '/goals/:id/message' }, from: 'client/src/ui/goalPanel.ts' });
    answered(recorder, { path: '/api/plugins/cartography/map', method: 'POST', route: { path: '/plugins/cartography/map' }, from: 'plugins/cartography/client.ts' });
    // without a file to put it to; and the dev server's own, which aren't the API's
    answered(recorder, { path: '/api/ledger', method: 'GET', route: { path: '/ledger' } });
    answered(recorder, { path: '/src/main.ts', method: 'GET' });
    const { flows, unattributed } = recorder.recording('a test');
    expect(flows).toEqual([
      { via: 'http', name: 'POST /api/goals/:id/message', from: 'client/src/ui/goalPanel.ts', to: 'server/routes.ts', count: 1 },
      { via: 'http', name: 'POST /api/plugins/cartography/map', from: 'plugins/cartography/client.ts', to: 'plugins/cartography/server.ts', count: 1 },
    ]);
    expect(unattributed).toEqual({ ws: 0, http: 1 });
  });
});
