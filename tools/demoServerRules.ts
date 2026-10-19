// The decisions behind `pnpm run demo:start|stop|status` (tools/demoServer.ts), kept pure so they're tested next to it.
import { Option, Schema } from 'effect';

export type DemoCommand = 'start' | 'stop' | 'status';

export interface DemoArgs {
  command: DemoCommand;
  /** Serve a fresh `vite build` instead of Vite's dev server, so edits to the client don't reload the page under test. */
  built: boolean;
}

/** What `start` wrote down about the demo it launched: the one thing `stop` and `status` go by. */
export const DemoRecord = Schema.Struct({
  v: Schema.Literal(1),
  /** The process group's leader: `stop` signals the group, so tsx and Vite's children go too. */
  pid: Schema.Number,
  port: Schema.Number,
  url: Schema.String,
  dataDir: Schema.String,
  log: Schema.String,
  /** The checkout's commit when it started, and whether it had uncommitted changes. */
  commit: Schema.String,
  dirty: Schema.Boolean,
  built: Schema.Boolean,
  startedAt: Schema.Number,
});
export type DemoRecord = typeof DemoRecord.Type;

export const decodeRecord = (text: string): DemoRecord | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(DemoRecord))(text));

export const USAGE = 'usage: pnpm run demo:start [--built] | pnpm run demo:stop | pnpm run demo:status';

/** The command and its flags, or what's wrong with them. */
export function parseDemoArgs(argv: readonly string[]): DemoArgs | { error: string } {
  const words = argv.filter((a) => a !== '--');
  const command = words.find((a) => !a.startsWith('-'));
  if (command !== 'start' && command !== 'stop' && command !== 'status') return { error: command ? `unknown command "${command}"; ${USAGE}` : USAGE };
  const unknown = words.filter((a) => a.startsWith('-') && a !== '--built');
  if (unknown.length) return { error: `unknown option ${unknown.join(', ')}; ${USAGE}` };
  if (words.includes('--built') && command !== 'start') return { error: `--built is for start; ${USAGE}` };
  return { command, built: words.includes('--built') };
}

/** How the demo this checkout started is doing: from its record, whether its process lives and whether it answers. */
export type DemoHealth = 'none' | 'gone' | 'stuck' | 'up';

export function demoHealth(record: DemoRecord | undefined, alive: boolean, answers: boolean): DemoHealth {
  if (!record) return 'none';
  if (!alive) return 'gone';
  return answers ? 'up' : 'stuck';
}

/**
 * What `start` does: keep a demo that's up and serving the client the way it was asked for, else stop this checkout's
 * own (if its process is still there) and launch a new one.
 */
export function startPlan(health: DemoHealth, record: DemoRecord | undefined, built: boolean): 'reuse' | 'replace' | 'launch' {
  if (health === 'up' && record?.built === built) return 'reuse';
  return health === 'up' || health === 'stuck' ? 'replace' : 'launch';
}

/** The process group `stop` may signal: only ever the one this checkout's record names, and only while it's alive. */
export function stopTarget(health: DemoHealth, record: DemoRecord | undefined): number | undefined {
  return record && (health === 'up' || health === 'stuck') ? record.pid : undefined;
}

/** What `start` and `status` print: one fact a line, the URL first. */
export function describeDemo(health: DemoHealth, record: DemoRecord | undefined, head: { commit: string; dirty: boolean }): string {
  if (!record || health === 'none') return 'No demo office started from this checkout. Start one with: pnpm run demo:start';
  const lines = [
    health === 'up' ? `Demo office up at ${record.url}` : health === 'stuck' ? `Demo office not answering at ${record.url} (pid ${record.pid} still running)` : `Demo office gone (pid ${record.pid} has exited)`,
    `pid ${record.pid} (its own process group) · port ${record.port} · data ${record.dataDir}`,
    `log ${record.log}`,
    `client: ${record.built ? 'a build from start (no hot reload)' : "Vite's dev server (hot reload)"}`,
    `started on ${short(record.commit)}${record.dirty ? ' with uncommitted changes' : ''}${sameCode(record, head) ? '' : `; the checkout is at ${short(head.commit)}${head.dirty ? ' with uncommitted changes' : ''} now`}`,
  ];
  if (health === 'gone') lines.push('Start a new one with: pnpm run demo:start');
  return lines.join('\n');
}

const short = (commit: string) => commit.slice(0, 8);
const sameCode = (record: DemoRecord, head: { commit: string; dirty: boolean }) => record.commit === head.commit && record.dirty === head.dirty;
