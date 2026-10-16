// A recorded run's traffic between the browser and the office (`pnpm run record-flows`): each kind of request or event, which
// file sent it and which received it, and how often. The cartography plugin draws it as the flows imports can't show.
// Pure: the browser (net/api.ts) and the office (server/flows.ts) both record with it.

/** One kind of message from one file to another in a recorded run: an `/api` request, or an event over `/ws`. */
export interface Flow {
  via: 'http' | 'ws';
  /** `POST /api/goals/:id/message`, or a `ServerEvent`'s type. */
  name: string;
  /** Files from the repo's root. */
  from: string;
  to: string;
  count: number;
}

export interface FlowRecording {
  /** What was run, in a few words. */
  run: string;
  /** The commit it was recorded on. */
  commit?: string;
  flows: Flow[];
}

/** Where a recording is kept in a repo, beside its model (plugins/cartography). */
export const FLOWS_FILE = '.focus/cartography-flows.json';
/** The header the browser names the file making an `/api` request in, while it records. */
export const FLOW_FROM_HEADER = 'x-focus-from';
/** The browser asks for it with this in its address (`?flows`). */
export const FLOWS_PARAM = 'flows';

/**
 * A file in the repo, from a stack frame's location: a path on disk (from `root`), or a URL the dev server served
 * (`/src/…` from the client's root, `/@fs/…/plugins/…` or `/shared/…` outside it). Undefined for a package's file.
 */
export function repoPath(location: string, root?: string): string | undefined {
  let p = location.replace(/^file:\/\//, '');
  const served = /^https?:\/\//.test(p);
  if (served) {
    p = decodeURIComponent(new URL(p).pathname);
    if (p.startsWith('/src/')) return `client${p}`;
    if (p.startsWith('/@fs/')) p = p.slice('/@fs'.length);
  }
  p = p.replace(/\?.*$/, '');
  if (p.includes('/node_modules/') || p.startsWith('node:')) return undefined;
  if (root && p.startsWith(`${root}/`)) return p.slice(root.length + 1);
  for (const marker of ['/plugins/', '/shared/']) {
    const at = p.lastIndexOf(marker);
    if (at >= 0) return p.slice(at + 1);
  }
  return undefined;
}

const FRAME = /(?:\(|@|at )((?:file:\/\/|https?:\/\/|\/)[^\s()]+?):\d+:\d+\)?\s*$/;

/** The first file in `stack` (an Error's) that's in the repo and not one of `skip`: whoever called the recorder. */
export function callerOf(stack: string | undefined, skip: readonly string[], root?: string): string | undefined {
  for (const line of (stack ?? '').split('\n')) {
    const at = FRAME.exec(line.trim())?.[1];
    const file = at && repoPath(at, root);
    if (file && !skip.includes(file)) return file;
  }
  return undefined;
}

/** Counts a run's flows as they happen. */
export class FlowCounter {
  private counts = new Map<string, Flow>();

  add(via: Flow['via'], name: string, from: string, to: string): void {
    const key = [via, name, from, to].join('\u0000');
    const flow = this.counts.get(key) ?? { via, name, from, to, count: 0 };
    flow.count++;
    this.counts.set(key, flow);
  }

  /** The flows so far, the busiest first. */
  list(): Flow[] {
    return [...this.counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.from.localeCompare(b.from));
  }
}

/** Where an `/api` request was handled: a plugin's route in its server, the demo's own in the office's start, the rest in the router. */
export function handlerOf(path: string, routed: boolean): string {
  const plugin = /^\/api\/plugins\/([^/]+)\//.exec(path)?.[1];
  if (plugin) return `plugins/${plugin}/server.ts`;
  return routed ? 'server/routes.ts' : 'server/index.ts';
}
