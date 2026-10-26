// pnpm run scale: a big demo ship, busy, watched from one tab for a while: what each event type costs down /ws, and
// the snapshot a tab gets on connecting. (The demo saves nothing, so state.json's saves aren't measured.) It fails when a number is past
// its budget (scaleRules.ts, where the budgets and the sums are). On demand, like perf: it isn't part of the gate.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { keysOf } from '../shared/records';
import { CheckFailed, freePort, startDemo, stopDemo, waitForServer } from './demoShip';
import { measure, verdict, BUDGETS, type Measured, type Sent } from './scaleRules';

const DEMO_REPOS = ['demo/webshop-frontend', 'demo/webshop-api', 'demo/space-dodger'];

const { values: opts } = parseArgs({
  options: {
    projects: { type: 'string', default: '8' },
    seconds: { type: 'string', default: '60' },
    speed: { type: 'string', default: '3' },
  },
});

type Api = (p: string, body?: unknown) => Promise<unknown>;

function apiAt(url: string): Api {
  return async (p, body) => {
    const res = await fetch(`${url}api${p}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new CheckFailed(`${p} answers (${res.status}: ${await res.text()})`);
    const answer: unknown = await res.json();
    return answer;
  };
}

interface ShipState {
  projects: { id: string }[];
  agents: { id: string }[];
  boards: { projectId: string; issues: { repo: string; number: number; title: string }[] }[];
}

const isShipState = (v: unknown): v is ShipState =>
  typeof v === 'object' && v !== null && 'projects' in v && Array.isArray(v.projects) && 'agents' in v && Array.isArray(v.agents) && 'boards' in v && Array.isArray(v.boards);

async function shipState(api: Api): Promise<ShipState> {
  const state = await api('/state');
  if (!isShipState(state)) throw new CheckFailed('/state gives the ship');
  return state;
}

/** More projects on the demo's repos, each team station with a goal, and developers on the boards' first issues. */
async function grow(api: Api, projects: number): Promise<void> {
  for (let i = 0; i < projects; i++) {
    const repos = [DEMO_REPOS[i % DEMO_REPOS.length], DEMO_REPOS[(i + 1) % DEMO_REPOS.length]];
    await api('/projects', { name: `Scale ${i + 1}`, repos });
  }
  const state = await shipState(api);
  for (const project of state.projects) {
    // a project's stations fill up, then a goal is queued: that's where its goals stop
    for (let g = 0; ; g++) {
      const started = await api(`/projects/${project.id}/goals`, { text: `Scale goal ${g + 1}: tidy up the checkout flow` });
      if (typeof started !== 'object' || started === null || 'queued' in started) break;
    }
    const issues = state.boards.find((b) => b.projectId === project.id)?.issues ?? [];
    for (const issue of issues.slice(0, 2)) {
      await api('/agents', { projectId: project.id, repo: issue.repo, number: issue.number, title: issue.title }).catch(() => undefined); // past the project's crew limit
    }
  }
}

/** One tab on /ws: the snapshot's size, then every event after it until `seconds` are up. */
function watch(url: string, seconds: number): Promise<{ snapshotBytes: number; sent: Sent[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}ws`);
    let snapshotBytes = 0;
    const sent: Sent[] = [];
    ws.on('message', (data) => {
      const text = data.toString();
      const parsed: unknown = JSON.parse(text);
      const type = typeof parsed === 'object' && parsed !== null && 'type' in parsed && typeof parsed.type === 'string' ? parsed.type : 'unknown';
      if (type === 'snapshot' && !snapshotBytes) snapshotBytes = Buffer.byteLength(text);
      else sent.push({ type, bytes: Buffer.byteLength(text) });
    });
    ws.on('error', reject);
    ws.on('open', () => setTimeout(() => { ws.close(); resolve({ snapshotBytes, sent }); }, seconds * 1000));
  });
}

function report(m: Measured): void {
  console.log(`agents on the ship: ${m.agents}\n`);
  const rows = m.events.map((e) => [e.type, String(e.count), String(e.bytes), String(e.largest)]);
  const cols = ['event', 'count', 'bytes', 'largest'];
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((v, i) => (i ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('  ');
  console.log(line(cols));
  for (const r of rows) console.log(line(r));
  console.log('');
  for (const key of keysOf(BUDGETS)) console.log(`${key.padEnd(22)} ${String(m[key]).padStart(8)}  (budget ${BUDGETS[key]})`);
}

async function main(): Promise<number> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'focus-scale-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const seconds = Number(opts.seconds);
  const server = startDemo(port, dataDir, { env: { FOCUS_DEMO_SPEED: opts.speed } });
  try {
    await waitForServer(url, server, 90_000);
    const api = apiAt(url);
    await grow(api, Number(opts.projects));
    const { snapshotBytes, sent } = await watch(url, seconds);
    const agents = (await shipState(api)).agents.length;
    const m = measure({ seconds, agents, snapshotBytes, sent });
    report(m);
    const v = verdict(m);
    if (v.kind === 'over') {
      console.error(`\nScale run FAILED, over budget:\n${v.reasons.map((r) => `  ${r}`).join('\n')}`);
      return 1;
    }
    console.log('\nWithin budget.');
    return 0;
  } catch (err) {
    console.error(err instanceof CheckFailed ? `Scale run FAILED: ${err.message}` : err);
    return 1;
  } finally {
    await stopDemo(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
