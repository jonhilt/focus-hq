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

/** One function in a call chain: its file from the repo's root, and its name when the stack says one. */
export interface Frame {
  file: string;
  fn?: string;
}

/**
 * One path a kind of message took through the code before it went: the repo's frames on the stack as it was sent,
 * outermost first, so the last is its sender. It's the order imports can't give: who called whom to send it.
 */
export interface Trace {
  via: Flow['via'];
  name: string;
  chain: Frame[];
  count: number;
}

export interface FlowRecording {
  /** What was run, in a few words. */
  run: string;
  /** The commit it was recorded on. */
  commit?: string;
  flows: Flow[];
  /** The call chains its messages were sent from, the busiest first (older recordings have none). */
  traces?: Trace[];
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
/** A frame's function: V8's `at [async ]Name.method (` or Firefox's `name@`. */
const FN = /^(?:at (?:async )?([^\s(]+) \(|([^\s@]+)@)/;

/**
 * The repo's frames in `stack` (an Error's), but `skip`'s, outermost first: the call chain that reached the recorder.
 * A function calling itself, or one frame after another in the same place, counts once.
 */
export function chainOf(stack: string | undefined, skip: readonly string[], root?: string): Frame[] {
  const chain: Frame[] = [];
  for (const line of (stack ?? '').split('\n').reverse()) {
    const text = line.trim();
    const at = FRAME.exec(text)?.[1];
    const file = at && repoPath(at, root);
    if (!file || skip.includes(file)) continue;
    const m = FN.exec(text);
    const fn = (m?.[1] ?? m?.[2])?.replace(/^Object\./, '');
    const last = chain[chain.length - 1];
    if (last && last.file === file && last.fn === fn) continue;
    chain.push(fn && fn !== '<anonymous>' ? { file, fn } : { file });
  }
  return chain;
}

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

/** Counts a run's call chains as they happen, each kind of message's own. */
export class TraceCounter {
  private counts = new Map<string, Trace>();

  add(via: Trace['via'], name: string, chain: Frame[]): void {
    if (!chain.length) return;
    const key = [via, name, ...chain.map((f) => `${f.file}#${f.fn ?? ''}`)].join('\u0000');
    const trace = this.counts.get(key) ?? { via, name, chain, count: 0 };
    trace.count++;
    this.counts.set(key, trace);
  }

  /** The `max` busiest chains so far. */
  list(max = 400): Trace[] {
    return [...this.counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, max);
  }
}

/** Where an `/api` request was handled: a plugin's route in its server, the demo's own in the office's start, the rest in the router. */
export function handlerOf(path: string, routed: boolean): string {
  const plugin = /^\/api\/plugins\/([^/]+)\//.exec(path)?.[1];
  if (plugin) return `plugins/${plugin}/server.ts`;
  return routed ? 'server/routes.ts' : 'server/index.ts';
}
