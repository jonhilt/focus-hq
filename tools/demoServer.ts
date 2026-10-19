// `pnpm run demo:start|stop|status`: a demo office that outlives the shell that started it, on a port of its own, which
// only this checkout's own `stop` ever stops (docs/scripts.md). The decisions are in demoServerRules.ts.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, root } from './demoOffice';
import { decodeRecord, demoHealth, describeDemo, parseDemoArgs, startPlan, stopTarget, type DemoHealth, type DemoRecord } from './demoServerRules';

/** Everything a demo started from this checkout keeps: its record, log and data folder (gitignored). */
const home = path.join(root, '.demo');
const recordFile = path.join(home, 'demo.json');
const READY_MS = 120_000;

function readRecord(): DemoRecord | undefined {
  try {
    return decodeRecord(fs.readFileSync(recordFile, 'utf8'));
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it's there, just not ours to signal
    return err instanceof Error && 'code' in err && err.code === 'EPERM';
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(new URL('api/state', url), { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function health(record: DemoRecord | undefined): Promise<DemoHealth> {
  if (!record) return 'none';
  const lives = alive(record.pid);
  return demoHealth(record, lives, lives && (await answers(record.url)));
}

function head(): { commit: string; dirty: boolean } {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
  } catch {
    return { commit: 'unknown', dirty: false };
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch { /* already gone */ }
}

/** SIGTERM to the recorded process group, SIGKILL if it's still there after 5 s; then the record goes. */
async function stop(record: DemoRecord | undefined, state: DemoHealth): Promise<boolean> {
  const pid = stopTarget(state, record);
  if (pid !== undefined) {
    signalGroup(pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (alive(pid)) signalGroup(pid, 'SIGKILL');
  }
  fs.rmSync(recordFile, { force: true });
  return pid !== undefined;
}

function logTail(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(-30).join('\n');
  } catch {
    return '(no log)';
  }
}

async function launch(built: boolean): Promise<DemoRecord> {
  if (built) {
    console.log('Building the client…');
    execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  }
  const port = await freePort();
  const dataDir = path.join(home, 'data');
  const log = path.join(home, 'demo.log');
  fs.mkdirSync(dataDir, { recursive: true });
  const out = fs.openSync(log, 'w');
  // detached: a session and process group of its own, so the shell that ran this can end without taking the demo with it
  const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts', '--demo', ...(built ? [] : ['--dev'])], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FOCUS_DATA_DIR: dataDir },
    stdio: ['ignore', out, out],
    detached: true,
  });
  fs.closeSync(out);
  if (child.pid === undefined) throw new Error(`the demo office didn't start; see ${log}`);
  child.unref();
  const { commit, dirty } = head();
  const record: DemoRecord = { v: 1, pid: child.pid, port, url: `http://127.0.0.1:${port}/`, dataDir, log, commit, dirty, built, startedAt: Date.now() };
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
  return record;
}

async function waitUntilUp(record: DemoRecord): Promise<boolean> {
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    if (!alive(record.pid)) return false;
    if (await answers(record.url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main(): Promise<number> {
  const args = parseDemoArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    return 2;
  }
  fs.mkdirSync(home, { recursive: true });
  const record = readRecord();
  const state = await health(record);

  if (args.command === 'status') {
    console.log(describeDemo(state, record, head()));
    return state === 'up' ? 0 : 1;
  }
  if (args.command === 'stop') {
    console.log((await stop(record, state)) ? `Stopped the demo office (pid ${record?.pid}).` : 'No demo office of this checkout\'s was running.');
    return 0;
  }

  const plan = startPlan(state, record, args.built);
  if (plan === 'reuse' && record) {
    console.log(`Already running.\n${describeDemo(state, record, head())}`);
    return 0;
  }
  if (plan === 'replace') await stop(record, state);
  const started = await launch(args.built);
  if (!(await waitUntilUp(started))) {
    await stop(started, await health(started));
    console.error(`The demo office didn't answer within ${READY_MS / 1000} s. Its log ends:\n${logTail(started.log)}`);
    return 1;
  }
  console.log(describeDemo('up', started, head()));
  return 0;
}

process.exitCode = await main();
