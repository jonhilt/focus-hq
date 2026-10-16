// The office's side of recording a run's flows (shared/flows.ts, `pnpm run record-flows`): with FOCUS_FLOWS set, each event
// the hub sends is counted against the file that sent it, and each /api request against the browser's file that made
// it (its FLOW_FROM_HEADER), and GET /api/flows hands over what's been counted. Off, it costs nothing.
import type { NextFunction, Request, Response } from 'express';
import { callerOf, FLOW_FROM_HEADER, FlowCounter, type FlowRecording, handlerOf } from '../shared/flows';
import { config } from './config';

/** Every event over /ws lands in the browser's mirror of the office. */
const WS_RECEIVER = 'client/src/net/state.ts';
/** The recorder's own frames, and the hub's, which only pass an event on. */
const PASSING_ON = ['server/flows.ts', 'server/hub.ts'];

export class FlowRecorder {
  private counter = new FlowCounter();
  /** Messages it couldn't put to a file, by how they went. */
  private unattributed = { ws: 0, http: 0 };

  constructor(private root: string) {}

  /** The hub's about to send an event of `type`: whoever asked it to is its sender. */
  ws(type: string): void {
    const from = callerOf(new Error().stack, PASSING_ON, this.root);
    if (from) this.counter.add('ws', type, from, WS_RECEIVER);
    else this.unattributed.ws++;
  }

  /** Counts each /api request once it's answered, against the route that answered it. */
  readonly http = (req: Request, res: Response, next: NextFunction): void => {
    // the API's, not the pages and modules the dev server serves, nor asking for the recording itself
    if (!req.path.startsWith('/api/') || req.path === '/api/flows') return next();
    res.on('finish', () => {
      const route = (req.route as { path?: unknown } | undefined)?.path;
      const from = req.get(FLOW_FROM_HEADER);
      if (typeof route !== 'string' || !from) return void this.unattributed.http++;
      // a route on the API router is relative to /api; the demo's own are on the app
      const routed = !route.startsWith('/api/');
      const full = routed ? `/api${route}` : route;
      this.counter.add('http', `${req.method} ${full}`, from, handlerOf(full, routed));
    });
    next();
  };

  recording(run: string): FlowRecording & { unattributed: { ws: number; http: number } } {
    return { run, flows: this.counter.list(), unattributed: this.unattributed };
  }
}

/** The office's recorder, while FOCUS_FLOWS is set. */
export const flowRecorder = process.env.FOCUS_FLOWS ? new FlowRecorder(config.root) : undefined;
