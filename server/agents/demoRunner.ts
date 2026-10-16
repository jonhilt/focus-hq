import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readScenario, type Scenario, turnParts } from '../../shared/scenarios';
import type { ModelCite, SystemModel, TermLine } from '../../shared/types';
import { config } from '../config';
import { demoSinceVerdict } from '../demoGit';
import { randomHex, sleep } from '../util';
import type { Transcript } from './transcript';
import type { Staged, StudioOfficer, StudioReply, StudioTurn } from './studioComputer';
import { currentTake } from '../../shared/takeScript';
import type { Drafter, DraftRequest, DraftResult } from './planner';
import type { ExplainerInput } from './explainer';
import { renderText, renderToolUse } from './render';
import { workflowProgress } from './workflows';
import { briefingBeats, type QuickAnswerer, type QuickQuestion } from './quickAnswer';
import type { TriageDecision, Triager, TriageRequest } from './triage';
import { type AgentRunner, type AgentSession, type CloudTerminal, type CloudTerminalRequest, type RunHooks, type RunOutcome, type RunRequest, type WorkspaceOps, STOPPED_BY_CAPTAIN } from './types';

/** The made-up files of each kind of demo repo: a web app's, an API's, a game's. */
export const FILES: Record<string, string[]> = {
  web: ['src/App.tsx', 'src/components/Header.tsx', 'src/components/CartBadge.tsx', 'src/pages/Product.tsx', 'src/store/cart.ts', 'src/styles/theme.css'],
  api: ['src/server.ts', 'src/routes/auth.ts', 'src/routes/products.ts', 'src/routes/orders.ts', 'src/middleware/rateLimit.ts', 'test/orders.test.ts'],
  game: ['index.html', 'src/game.ts', 'src/ship.ts', 'src/asteroids.ts', 'src/audio.ts', 'src/hud.ts'],
};

const pick = <T>(list: T[], n: number) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

const xml = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A placeholder for a screenshot QA takes in demo mode: a pretend page, as an SVG data URL. */
function placeholderShot(url: string, heading: string, caption: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="700" viewBox="0 0 1100 700">
<rect width="1100" height="700" fill="#f4f6fb"/><rect width="1100" height="44" fill="#dfe3ec"/>
<rect x="16" y="10" width="760" height="24" rx="12" fill="#fff"/><text x="32" y="27" font-family="sans-serif" font-size="14" fill="#555">${xml(url)}</text>
<rect y="44" width="1100" height="90" fill="${accent}"/><text x="40" y="100" font-family="sans-serif" font-size="30" font-weight="bold" fill="#fff">${xml(heading)}</text>
<rect x="40" y="170" width="480" height="300" rx="12" fill="#fff" stroke="#d5d9e2"/><rect x="580" y="170" width="480" height="300" rx="12" fill="#fff" stroke="#d5d9e2"/>
<rect x="70" y="200" width="300" height="18" rx="9" fill="#d5d9e2"/><rect x="70" y="236" width="400" height="14" rx="7" fill="#e6e9f0"/>
<rect x="610" y="200" width="260" height="18" rx="9" fill="#d5d9e2"/><rect x="610" y="236" width="380" height="14" rx="7" fill="#e6e9f0"/>
<text x="550" y="560" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#333">${xml(caption)}</text>
<text x="550" y="600" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#888">Demo placeholder screenshot</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Pretend agents for `npm run demo`: realistic-looking terminal output, browser testing and the odd raised hand. */
export class DemoRunner implements AgentRunner {
  /** How fast the pretend agents go: the training console sets it, and changes it as the captain asks (docs/studio.md). */
  speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);
  /** How full each pretend session's context is. */
  private context = new Map<string, number>();
  /** Each lead's repos and goal, by session: a resumed turn doesn't hear them again. */
  private leads = new Map<string, { repos: { folder: string; repo: string }[]; goal: string; scenario: Scenario }>();
  /**
   * Each pretend lead's session as Claude Code's transcript would have it, by session: the messages that started its
   * turns, what it said and the tools it called, so what reads a real session's transcript (plugins, through
   * `PluginHost.transcript`) has something to read in the demo.
   */
  private journals = new Map<string, string[]>();
  /** Which parts of its story a new goal's lead plays (shared/scenarios.ts): a goal keeps the one it started with. */
  scenario: Scenario = readScenario(process.env.FOCUS_DEMO_SCENARIO);

  /** A pretend lead's transcript so far, as JSONL, to read as a real one would be. */
  transcript(sessionId: string): string | undefined {
    return this.journals.get(sessionId)?.join('\n');
  }

  /** A pretend terminal: the cloud session's link shows up in it after a few seconds. */
  cloudTerminal(_req: CloudTerminalRequest): Promise<CloudTerminal> {
    const opened = Date.now();
    const id = `session_demo${randomHex(4)}`;
    return Promise.resolve({
      read: () => Promise.resolve(Date.now() - opened < 4000 / this.speed ? 'Starting a cloud session…' : `Starting a cloud session…\n\x1b[2m☁ https://claude.ai/code/${id}\x1b[0m`),
    });
  }

  start(req: RunRequest, given: RunHooks): AgentSession {
    // which pretend session this is, once the script says: its context fills a little more each turn
    let session = req.resumeSessionId ?? '';
    const hooks: RunHooks = { ...given, session: (id) => ((session = id), given.session(id)) };
    const inbox: string[] = [];
    let stopped = false;
    let finished = false;
    // the captain can change it while the session runs, as in a real one
    let autonomy = req.autonomy;
    const abort = new AbortController();

    // a lead's turn as its transcript would have it, starting with the message that began it
    const began = new Date().toISOString();
    const journal = (type: 'user' | 'assistant', content: unknown[]) => {
      if (!session.startsWith('demo-lead-')) return;
      const lines = this.journals.get(session) ?? [];
      if (!lines.some((l) => l.includes(`"began":"${began}"`))) lines.push(JSON.stringify({ type: 'user', timestamp: began, began, message: { content: req.prompt } }));
      lines.push(JSON.stringify({ type, timestamp: new Date().toISOString(), message: { content } }));
      this.journals.set(session, lines);
    };
    let calls = 0;
    const journalCall = (name: string, input: unknown, output: string) => {
      const id = `demo_call_${++calls}`;
      journal('assistant', [{ type: 'tool_use', id, name, input }]);
      return () => journal('user', [{ type: 'tool_result', tool_use_id: id, content: output }]);
    };

    const wait = async (min: number, max: number) => {
      await sleep(((min + Math.random() * (max - min)) * 1000) / this.speed);
      if (stopped) throw new Error('stopped');
    };
    const tool = async (name: string, input: Record<string, unknown>, output: string[] = []) => {
      const r = renderToolUse(name, input, '/work');
      hooks.lines(r.lines);
      const answered = journalCall(name, input, output.join('\n'));
      // the agent's own task list, as Claude Code's task tools would report it
      if (name === 'TodoWrite') hooks.taskTool?.(name, input, undefined, '');
      if (r.activity || r.status) hooks.activity(r.status ?? null, r.activity ?? '');
      await wait(1.2, 3.2);
      answered();
      if (output.length) {
        hooks.lines(output.slice(0, 4).map((text, i) => ({ kind: 'output', text: `  ${i === 0 ? '⎿' : ' '}  ${text}` })));
      }
    };
    const say = async (text: string) => {
      hooks.lines(renderText(text));
      journal('assistant', [{ type: 'text', text }]);
      hooks.activity(null, text.split('\n')[0].slice(0, 80));
      await wait(1, 2.5);
    };
    const think = async () => {
      hooks.lines([{ kind: 'thinking', text: '✻ Thinking…' }]);
      journal('assistant', [{ type: 'thinking', thinking: '' }]);
      hooks.activity('working', 'Thinking…');
      await wait(1.5, 3.5);
    };

    const titleMatch = /issue #(\d+) in (\S+)\.\s*\n\s*\nTitle: (.+)/.exec(req.prompt);
    const issueNumber = Number(titleMatch?.[1] ?? 0);
    const repo = titleMatch?.[2] ?? 'demo/app';
    // a plugin's brief comes with what its stand-in writes up, rather than an issue
    const scripted = req.scripted;
    const title = scripted?.title ?? titleMatch?.[3]?.trim() ?? 'the task';
    const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
    const files = FILES[kind];
    const accent = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#c879ff'][issueNumber % 4];

    // a cloud agent pushes its own branch: that's how its work reaches the office
    const push = async () => {
      if (req.cloud) await tool('Bash', { command: `git push origin HEAD:${req.cloud.branch}` }, [`To github.com:${repo}.git`, `   4f2a91c..9e1d0b7  HEAD -> ${req.cloud.branch}`]);
    };

    const handleInbox = async () => {
      for (let message = inbox.shift(); message !== undefined; message = inbox.shift()) {
        await think();
        await say(`Good call – ${message.length > 60 ? 'I\'ll take that into account' : `"${message}"`}. Updating my changes.`);
        const file = pick(files, 1)[0];
        await tool('Edit', { file_path: `/work/${file}`, old_string: '// TODO: handle edge case', new_string: '// Handles the edge case the manager pointed out\nif (!input) return fallback;' }, ['Updated 1 file']);
        await tool('Bash', { command: 'npm test' }, ['Tests: 44 passed, 44 total']);
        await tool('Bash', { command: 'git commit -am "Address manager feedback"' }, ['[branch 4f2a91c] Address manager feedback', ' 1 file changed, 3 insertions(+)']);
        await push();
      }
    };

    // the QA officer: review the diff, run the tests, click through the UI, report a verdict
    const qaScript = async (): Promise<RunOutcome> => {
      hooks.session(req.resumeSessionId ?? `demo-qa-${randomHex(4)}`);
      hooks.lines([{ kind: 'system', text: '✻ Claude Code (demo) · pretend model · QA' }]);
      const match = /pull request #(\d+) in (\S+): (.+)/.exec(req.prompt);
      const pr = Number(match?.[1] ?? 0);
      const prRepo = match?.[2] ?? repo;
      const prTitle = match?.[3]?.trim() ?? 'the change';
      const prKind = /api/.test(prRepo) ? 'api' : /game|dodger/.test(prRepo) ? 'game' : 'web';
      const changed = pick(FILES[prKind], 2);
      // every third PR has a problem the first time round; a re-test, or a re-check after a message, finds it fixed. Every
      // sixth (PR 9, 15, …) is stubborn: QA keeps failing it until the operations officer looks into why it's stuck
      const retest = /This is a re-test/.test(req.prompt);
      const stubborn = pr % 6 === 3 && !/operations officer/.test(req.prompt);
      const fails = !req.resumeSessionId && (stubborn || (!retest && pr % 3 === 0));
      if (req.resumeSessionId) {
        await say('Re-checking after your message.');
      } else if (retest) {
        const since = /git diff (\w+)\.\.HEAD/.exec(req.prompt)?.[1] ?? 'last round';
        await say(`Re-test of PR #${pr}: checking last round's findings first, then what changed since ${since}.`);
        await tool('Bash', { command: `git diff ${since}..HEAD --stat` }, [`${changed[0]} | 6 ++++--`, '1 file changed']);
      } else {
        await say(`I'll review PR #${pr} and test it against the linked issue.`);
        await tool('Bash', { command: 'git diff origin/main...HEAD --stat' }, [`${changed[0]} | 24 ++++--`, `${changed[1]} | 9 +++`, '2 files changed']);
        for (const file of changed) await tool('Read', { file_path: `/work/${file}` }, [`Read ${60 + Math.floor(Math.random() * 120)} lines`]);
        await think();
      }
      const captions = prKind === 'api' ? [] : [
        `${prTitle}: the page loads with the change`,
        fails ? 'With an empty list the page goes blank' : `${prKind === 'game' ? 'Playing' : 'Checking out'} works end to end`,
      ];
      await tool('Bash', { command: 'npm ci' }, ['added 412 packages in 9s']);
      await tool('Bash', { command: prKind === 'api' ? 'npm test' : 'npx vitest run' }, [`Tests  ${30 + pr} passed`]);
      await tool('Bash', { command: 'npx tsc --noEmit' }, ['(no output)']);
      if (prKind !== 'api') {
        await tool('Bash', { command: 'npm run dev &', run_in_background: true }, ['VITE ready on http://localhost:5173']);
        const pages = ['/', prKind === 'game' ? '/play' : '/cart'];
        for (let step = 0; step < 2; step++) {
          const url = `http://localhost:5173${pages[step]}`;
          await tool(`mcp__browser__${step === 0 ? 'open' : 'click'}`, step === 0 ? { url } : { text: prKind === 'game' ? 'Start' : 'Checkout' }, [`URL: ${url}`, '[screenshot]']);
          hooks.browser({ url, title: prTitle.slice(0, 40), mock: { heading: `QA: ${prTitle}`, accent: '#4f8fd6', step }, at: Date.now() });
          await wait(1.5, 3);
          await tool('mcp__browser__screenshot', {}, ['Screenshot', `URL: ${url}`, '[screenshot]']);
          hooks.screenshot({ url, title: prTitle.slice(0, 40), image: placeholderShot(url, prTitle, captions[step], fails && step === 1 ? '#c94f4f' : '#4f8fd6'), at: Date.now() });
        }
        await tool('mcp__browser__console', {}, [fails ? 'TypeError: Cannot read properties of undefined (reading \'length\')' : '(no console output)']);
      }
      const report = {
        verdict: fails ? 'fail' : 'pass',
        summary: fails
          ? `The happy path works, but the change breaks when the list is empty: the page throws in ${changed[0]} and renders nothing. Tests and type checks pass, so nothing covers that case yet.`
          : `${prTitle} works as the issue describes. Tests, type checks and a click-through in the browser all pass, and I found nothing in the diff to worry about.`,
        checks: [
          { name: 'Does what the issue asks', result: 'pass', details: `Exercised "${prTitle}" end to end.` },
          { name: 'Empty state', result: fails ? 'fail' : 'pass', details: fails ? `With nothing saved, ${changed[0]} reads .length of undefined and the page goes blank.` : 'Shows a friendly empty message.' },
          { name: 'Code review', result: 'pass', details: `Read the diff in ${changed.join(' and ')}: no leftover debug code, errors handled.` },
          { name: 'Tests cover the new logic', result: fails ? 'fail' : 'pass', details: fails ? 'No test for the empty case.' : 'New tests cover the main path and the empty case.' },
        ],
        commands: [
          { command: 'npm ci', result: 'ok' },
          { command: prKind === 'api' ? 'npm test' : 'npx vitest run', result: `${30 + pr} passed, 0 failed` },
          { command: 'npx tsc --noEmit', result: 'no errors' },
        ],
        screenshots: captions,
        fixInstructions: fails ? `Guard the empty case in \`${changed[0]}\` (treat a missing list as []), show the empty message instead, and add a test for it.` : undefined,
        files: changed.map((file, i) => ({
          file,
          tests: i === 0 && fails ? 'none' : `${file.replace(/\.(\w+)$/, '.test.$1')}`,
          checked: i === 0 && fails ? 'Read every changed line; the empty list isn\'t handled' : 'Read every changed line; ran its tests',
        })),
        spotChecks: [
          { file: changed[0], line: 12 + (pr % 30), why: 'Reads the saved list straight from storage: a malformed entry would throw before anything renders.' },
          { file: changed[1], line: 40 + (pr % 20), why: 'New request handler: check it only returns the signed-in shopper\'s items.' },
        ],
      };
      await say(fails ? 'Found a problem with the empty state. Writing up the report.' : 'All good. Writing up the report.');
      return { ok: true, summary: JSON.stringify(report), structured: report };
    };

    // a workflow (Claude Code's Workflow tool), played out as Claude Code reports one: at most `cap` agents at work at once
    // and the rest queued, a pipeline's stages overlapping, agents queued as the script reaches them, some failing. Its
    // progress goes through the same reading as a real session's
    type Job = { label: string; phase: number; ask: string; result?: string; after?: string; secs: [number, number] };
    const runWorkflow = async (name: string, description: string, script: string, phases: { title: string; child?: boolean }[], jobs: Job[], logs: (done: number, of: number) => string[], cap = 8) => {
      const id = `demo-wf-${randomHex(3)}`;
      // laid out as Claude Code lays out a session's folder: each agent's transcript, agent-<agentId>.jsonl, in the
      // run's folder under subagents/workflows/, the script saved under workflows/scripts/, and the run under
      // workflows/ once it's over
      const session = path.join(os.tmpdir(), 'focus-demo-workflows', `session-${id}`);
      const dir = path.join(session, 'subagents', 'workflows', id);
      const scriptPath = path.join(session, 'workflows', 'scripts', `${name}.js`);
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
      fs.writeFileSync(scriptPath, script);
      const agentId = (e: { index: number }) => `${id.slice(-6)}a${e.index}`;
      // the journal Claude Code appends to as the run goes: each agent as it starts, and what it returned
      const journal = (entry: object) => fs.appendFileSync(path.join(dir, 'journal.jsonl'), `${JSON.stringify(entry)}\n`);
      journal({ type: 'launched' });
      const transcript = (e: { index: number }, ...entries: unknown[]) =>
        fs.appendFileSync(path.join(dir, `agent-${agentId(e)}.jsonl`), entries.map((x) => `${JSON.stringify(x)}\n`).join(''));
      type Entry = { job: Job; index: number; queuedAt: number; startedAt?: number; doneAt?: number; state: 'start' | 'done' | 'error' };
      const entries: Entry[] = [];
      const ready = (job: Job) => !job.after || entries.some((e) => e.job.label === job.after && e.state !== 'start');
      const report = () => {
        const raw = [
          ...phases.map((p, i) => ({ type: 'workflow_phase', index: i + 1, title: p.title, ...(p.child && { kind: 'child' }) })),
          ...entries.map((e) => ({
            type: 'workflow_agent', index: e.index, label: e.job.label, phaseIndex: e.job.phase, phaseTitle: phases[e.job.phase - 1]?.title, state: e.state,
            model: 'claude-sonnet-5-5', queuedAt: e.queuedAt, startedAt: e.startedAt, promptPreview: e.job.ask, ...(e.startedAt && { agentId: agentId(e) }),
            ...(e.doneAt && e.startedAt && { durationMs: e.doneAt - e.startedAt }),
            ...(e.state === 'done' && { resultPreview: e.job.result }),
            ...(e.state === 'error' && { error: 'The agent hit an error' }),
          })),
        ];
        const progress = workflowProgress(raw);
        if (progress) hooks.workflow?.({ kind: 'progress', id, ...progress, usage: usage() });
      };
      // what it's used: tokens as each agent works, and a few tool calls each
      const usage = () => {
        const now = Date.now();
        const started = entries.filter((e) => e.startedAt !== undefined);
        const tokens = started.reduce((n, e) => n + Math.round((((e.doneAt ?? now) - (e.startedAt ?? now)) / 1000) * this.speed * 1800), 0);
        return { tokens, toolUses: started.length * 2 + entries.filter((e) => e.doneAt).length * 2 };
      };
      hooks.lines([{ kind: 'tool', text: `⏺ Workflow(${name})` }, { kind: 'output', text: '  ⎿  Launched in the background' }]);
      hooks.workflow?.({ kind: 'started', id, name, description, script });
      hooks.workflow?.({ kind: 'transcripts', id, dir, scriptPath });
      const pending = [...jobs];
      const ends = new Map<Entry, number>();
      while (pending.length || entries.some((e) => e.state === 'start')) {
        const now = Date.now();
        // the script reaches each agent once what it waits on has finished: queued, then started when a slot is free
        for (const job of pending.filter(ready)) {
          pending.splice(pending.indexOf(job), 1);
          entries.push({ job, index: entries.length + 1, queuedAt: now, state: 'start' });
        }
        for (const e of entries) {
          if (e.state !== 'start') continue;
          if (e.startedAt === undefined && entries.filter((x) => x.state === 'start' && x.startedAt !== undefined).length < cap) {
            e.startedAt = now;
            journal({ type: 'started', key: `k${e.index}`, agentId: agentId(e), label: e.job.label, phase: phases[e.job.phase - 1]?.title ?? null });
            const file = `src/${e.job.label.split(':')[1] ?? 'index'}.ts`;
            transcript(e,
              { type: 'user', message: { content: e.job.ask } },
              { type: 'assistant', message: { content: [{ type: 'text', text: `I'll start with ${file}.` }, { type: 'tool_use', name: 'Read', input: { file_path: file } }] } },
              { type: 'user', message: { content: [{ type: 'tool_result', content: `export function ${e.job.label.replace(/\W/g, '_')}() {}\n// ${30 + e.index * 7} lines` }] } },
              { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] } },
            );
            ends.set(e, now + ((e.job.secs[0] + Math.random() * (e.job.secs[1] - e.job.secs[0])) * 1000) / this.speed);
          } else if (e.startedAt !== undefined && now >= (ends.get(e) ?? Infinity)) {
            e.doneAt = now;
            e.state = e.job.result === undefined ? 'error' : 'done';
            if (e.job.result !== undefined) journal({ type: 'result', key: `k${e.index}`, agentId: agentId(e), result: e.job.result });
            transcript(e,
              { type: 'user', message: { content: [{ type: 'tool_result', content: e.state === 'done' ? 'Tests: 44 passed, 44 total' : 'Tests: 2 failed, 42 passed' }] } },
              { type: 'assistant', message: { content: [{ type: 'text', text: e.job.result ?? 'Two tests fail here: stopping so the lead can look.' }] } },
            );
          }
        }
        report();
        await wait(0.5, 0.9);
      }
      const done = entries.filter((e) => e.state === 'done').length;
      const result = Object.fromEntries(entries.map((e) => [e.job.label, e.job.result ?? null]));
      fs.writeFileSync(path.join(session, 'workflows', `${id}.json`), JSON.stringify({ runId: id, workflowName: name, logs: logs(done, entries.length), result, status: 'completed' }));
      hooks.workflow?.({ kind: 'ended', id, ok: true, usage: usage() });
      hooks.lines([{ kind: 'output', text: `  ⎿  ${name}: ${done} of ${entries.length} agents finished, ${entries.length - done} failed` }]);
    };

    // reviewing the slice before it ships: a pipeline of scans and checks, a fan-out bigger than the workflow can run at
    // once, and a child workflow; alongside it, a smaller one mapping the repos
    // commands and monitors left running in the background: each writes its output to a file as it goes, and stops
    // when the captain stops it, or when the lead's turn is over
    const jobs = new Map<string, { timer: ReturnType<typeof setInterval>; task: 'shell' | 'monitor' }>();
    const runInBackground = (task: 'shell' | 'monitor', description: string, line: (n: number) => string) => {
      const id = `b${randomHex(4)}`;
      const file = path.join(os.tmpdir(), 'focus-demo-tasks', `${id}.output`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      let n = 0;
      const timer = setInterval(() => fs.appendFileSync(file, `${line(++n)}\n`), 1000 / this.speed);
      jobs.set(id, { timer, task });
      hooks.lines([{ kind: 'tool', text: task === 'monitor' ? `⏺ Monitor(${description})` : `⏺ Bash(${description})` }, { kind: 'output', text: `  ⎿  Running in the background (${id})` }]);
      hooks.background?.({ kind: 'started', id, task, description });
      hooks.background?.({ kind: 'output', id, file });
      return id;
    };
    const endJob = (id: string, status: 'done' | 'stopped', summary: string) => {
      const job = jobs.get(id);
      if (!job) return false;
      clearInterval(job.timer);
      jobs.delete(id);
      hooks.background?.({ kind: 'ended', id, status, summary });
      return true;
    };

    const reviewWorkflows = async (folders: string[], goal: string) => {
      const areas = ['store', 'routes', 'views', 'tests', 'styles', 'config'];
      const review: Job[] = [
        ...areas.flatMap((a, i): Job[] => [
          { label: `scan:${a}`, phase: 1, ask: `Scan the ${a} for anything ${goal} breaks`, result: i === 3 ? undefined : `${a}: nothing broken`, secs: [3, 7] },
          { label: `check:${a}`, phase: 2, ask: `Check what the scan of the ${a} found`, result: 'Confirmed', after: `scan:${a}`, secs: [2, 5] },
        ]),
        ...Array.from({ length: 24 }, (_, i): Job => ({ label: `fan:${i}`, phase: 3, ask: `Try ${goal} with case ${i}`, result: i === 17 ? undefined : `Case ${i} passes`, after: 'check:config', secs: [2, 5] })),
        { label: 'child:1', phase: 4, ask: 'Summarise the findings', result: 'Summary written', after: 'fan:23', secs: [2, 3] },
        { label: 'child:2', phase: 4, ask: 'Draft the PR notes', result: 'Notes drafted', after: 'fan:23', secs: [2, 3] },
      ];
      const map: Job[] = folders.map((f) => ({ label: `map:${f}`, phase: 1, ask: `Map ./${f} for ${goal}`, result: `./${f} mapped`, secs: [4, 9] }));
      hooks.activity('working', 'Waiting on 2 workflows');
      await Promise.all([
        runWorkflow('review-slice', `Review ${goal} before it ships`, DEMO_REVIEW_SCRIPT, [{ title: 'Scan' }, { title: 'Check' }, { title: 'Fan' }, { title: '▸ summarise', child: true }], review,
          (done, of) => [`${areas.length}/${areas.length} areas scanned and checked`, `${review.filter((j) => j.phase === 3 && j.result).length}/24 cases pass`, `${done} of ${of} agents finished`]),
        wait(2, 3).then(() => runWorkflow('map-repos', `Map each repo for ${goal}`, DEMO_MAP_SCRIPT, [{ title: 'Map' }], map, (done) => [`${done} repos mapped`])),
      ]);
    };

    // a goal's lead: talks the goal through, builds a slice across every repo, ships it, and hears back
    const leadScript = async (tools: NonNullable<RunRequest['tools']>): Promise<RunOutcome> => {
      const sessionId = req.resumeSessionId ?? `demo-lead-${randomHex(4)}`;
      hooks.session(sessionId);
      if (!req.resumeSessionId) hooks.lines([{ kind: 'system', text: '✻ Claude Code (demo) · pretend model · acceptEdits' }]);
      // where the repos are comes in the goal's first message and with each new slice; a resumed turn remembers it
      const listed = [...req.prompt.matchAll(/^- \.\/(\S+): (\S+), on branch/gm)].map((m) => ({ folder: m[1], repo: m[2] }));
      const known = this.leads.get(sessionId);
      const repos = listed.length ? listed : (known?.repos ?? []);
      const kindOf = (repo: string) => (/api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web');
      // the captain's words, without the office's note about the workspace in front of them
      const message = req.prompt.replace(/^(Your workspace|Slice \d+ starts)[^\n]*\n(- [^\n]*(\n|$))*/, '').replace(/\s+/g, ' ').trim();
      // a resumed session doesn't hear the goal again, and a goal's lead keeps the one goal
      const goal = known?.goal ?? (message.replace(/[.!?]$/, '').slice(0, 60) || 'saved items');
      const scenario = known?.scenario ?? this.scenario;
      // the captain can ask for a workflow in their own words, as with real Claude Code: the turn runs them whatever the scenario
      const parts = turnParts(scenario, message);
      this.leads.set(sessionId, { repos, goal, scenario });
      const ship = async (title: string, summary: string): Promise<boolean> => {
        hooks.lines([{ kind: 'tool', text: `⏺ mcp__office__ship(${title})` }]);
        hooks.activity('pushing', 'Shipping the slice');
        if (autonomy === 'ask' && !(await hooks.permission('mcp__office__ship', `Ship the slice: ${title}`, abort.signal))) {
          if (stopped) throw new Error('stopped');
          hooks.lines([{ kind: 'error', text: '  ⎿  Declined by the captain' }]);
          await say('Holding off on shipping. Tell me what you’d like changed first.');
          return false;
        }
        const result = await tools.ship({ title, summary });
        journalCall('mcp__office__ship', { title, summary }, result)();
        hooks.lines(result.split('\n').filter((l) => l.trim()).slice(0, 4).map((text, i) => ({ kind: 'output', text: `  ${i === 0 ? '⎿' : ' '}  ${text}` })));
        return true;
      };
      const note = async (input: Parameters<typeof tools.note>[0]) => {
        hooks.lines([{ kind: 'tool', text: `⏺ mcp__office__note(${Object.keys(input).join(', ')})` }]);
        const result = await tools.note(input).catch((err: Error) => err.message);
        hooks.lines([{ kind: 'output', text: `  ⎿  ${result}` }]);
      };
      const show = async (input: Parameters<typeof tools.show>[0]) => {
        hooks.lines([{ kind: 'tool', text: `⏺ mcp__office__show(${input.title})` }]);
        const result = await tools.show(input).catch((err: Error) => err.message);
        hooks.lines([{ kind: 'output', text: `  ⎿  ${result}` }]);
      };
      const commit = async (folder: string, text: string) => {
        await tool('Bash', { command: `git -C ${folder} add -A && git -C ${folder} commit -m "${text}"` }, [`[${folder} 4f2a91c] ${text}`, ' 2 files changed, 41 insertions(+)']);
        // as the real runner reports a commit once git says it worked
        hooks.commit?.(text);
      };

      // asked about a briefing up close: a line straight away, a look at the code, then a spoken answer about that beat
      const briefing = /^A question about your briefing “([^”]*)”[^)]*?(?:at beat (\d+), “([^”]*)”)?\): ([^\n]*)/.exec(req.prompt);
      if (briefing) {
        const [, title, beat, beatTitle, asked] = briefing;
        await say('Good question. Let me check the code on that.');
        await tool('Read', { file_path: `/work/${repos[0]?.folder ?? 'web'}/${FILES[kindOf(repos[0]?.repo ?? 'web')][0]}` }, ['Read 84 lines']);
        // asked for more on it: an answer aloud first, then the briefing again under its id, that beat in more detail
        if (/\b(more|detail|redraw|show me)\b/i.test(asked)) {
          await say(`Short answer: it retries three times, a second apart, then tells the shopper. I'll redraw ${beat ? `beat ${beat}` : 'that part'} with the retries in it.`);
          hooks.lines([{ kind: 'tool', text: '⏺ mcp__office__explain(How a save travels)' }]);
          const explained = await tools.explain(demoExplainer(repos.map((r) => r.folder), true)).then((reply) => reply.text, (err: Error) => err.message);
          hooks.lines([{ kind: 'output', text: `  ⎿  ${explained}` }]);
          await say('It’s updated on the screen: the outage beat now shows the three retries.');
          return { ok: true, summary: 'Redrew a briefing in more detail.' };
        }
        await say(`${beat ? `In beat ${beat}, ${beatTitle}, ` : `In ${title}, `}the save waits for the database to answer before the page says it's done. If the database is down, it retries three times, a second apart, then tells the shopper it couldn't save. Want me to redraw that part of the briefing in more detail?`);
        return { ok: true, summary: 'Answered a question about a briefing.' };
      }
      if (/^\[QA officer/.test(req.prompt)) {
        await think();
        if (/^\[QA officer [^\]]+\] QA failed/.test(req.prompt)) {
          const target = repos.find((r) => req.prompt.includes(r.repo)) ?? repos[0];
          await say(`QA found a gap in ${target.folder}. Fixing it before anything else.`);
          await tool('Edit', { file_path: `/work/${target.folder}/${FILES[kindOf(target.repo)][0]}`, old_string: 'items.length', new_string: '(items ?? []).length' }, ['Updated 1 file']);
          await tool('Bash', { command: `npm --prefix ${target.folder} test` }, ['Tests: 46 passed, 46 total']);
          await commit(target.folder, 'Handle an empty list');
          if (await ship('Fix what QA found', 'Handles the empty case QA found, with a test.')) await say('Shipped the fix; QA will look again. The rest of the slice is unchanged.');
        } else {
          await say(`QA passed it. It's ready for you to merge whenever you're happy with it.`);
        }
        return { ok: true, summary: 'Heard back from QA.' };
      }
      // asked to run a workflow: the review plays out in the transporter rooms there and then, to watch
      if (/\brun a workflow\b/i.test(req.prompt)) {
        await say('Running the review workflow now: beam into a transporter room to watch it.');
        await reviewWorkflows(repos.map((r) => r.folder), goal);
        await say('The workflow is done: its results are on the transporter console.');
        return { ok: true, summary: 'Ran a workflow.' };
      }
      const landed = /Slice (\d+) has landed/.exec(req.prompt);
      if (landed) {
        await think();
        // a loose thread noticed on the way, logged as a contact on the chart; by the next landing it's been dropped
        const thread = landed[1] === '1' ? { contact: 'Should saved items follow a shopper who signs in on another device?' } : { closeContact: { id: 'c1', as: 'dropped' as const, why: 'Signing in already brings them along' } };
        await note({ learned: `Slice ${landed[1]}: the data side holds up; the store code needs tidying`, next: ['Show it in the header', 'Tidy the store code it exposed'], ...thread });
        // by the second slice the goal's done: the captain closes it, or carries on
        if (Number(landed[1]) >= 2) {
          hooks.lines([{ kind: 'tool', text: '⏺ mcp__office__propose_close(What done looks like is met)' }]);
          await tools.proposeClose({ reason: `${goal} works end to end, on every device, which is what we said done looks like` });
          journalCall('mcp__office__propose_close', {}, 'The captain will see it')();
          await say(`That's what we said done looks like: ${goal} works end to end. I think we can wrap this goal up. Close it if you agree, or tell me what's next.`);
          return { ok: true, summary: 'Proposed closing the goal.' };
        }
        await say(`That slice is in, and it taught us the data side holds up fine. The open question now is whether people find it from the header. Next I'd add it there and tidy the store code it exposed. Shall I go?`);
        return { ok: true, summary: 'The slice landed.' };
      }
      if (!req.resumeSessionId) {
        for (const r of repos) {
          await tool('Read', { file_path: `/work/${r.folder}/CLAUDE.md` }, [`Read ${30 + r.folder.length * 3} lines`]);
          await tool('Glob', { pattern: `${r.folder}/src/**/*` }, [`Found ${14 + r.folder.length} files`]);
        }
        await think();
        await note({ done: `${goal}: it works end to end, and survives a reload on another device.`, next: ['A thin slice end to end'] });
        await show({ id: 'data-flow', title: 'The data flow', html: demoFlowPage(goal, repos.map((r) => r.folder)) });
        hooks.lines([{ kind: 'tool', text: '⏺ mcp__office__ask(Which layout should it start with?)' }]);
        const asked = await tools.ask({
          question: 'Which layout should it start with?',
          context: 'The first slice only needs one. It decides how much the API sends per item, so it is cheaper to pick now than to change later.',
          options: [
            { label: 'Cards with pictures', html: demoMockupPage(goal), detail: 'Friendlier and easier to scan by eye, but it needs a picture of every item, and fits fewer on a screen.' },
            { label: 'A plain list', html: demoListPage(goal), detail: 'Quick to build and dense: the API sends names and prices only. Plainer to look at.' },
          ],
        }).catch((err: Error) => err.message);
        journalCall('mcp__office__ask', { question: 'Which layout should it start with?' }, asked)();
        hooks.lines([{ kind: 'output', text: `  ⎿  ${asked}` }]);
        await say(`I've had a look around ${repos.map((r) => `./${r.folder}`).join(' and ')}. For "${goal}", I'd start with a thin slice end to end${repos.length > 1 ? ` through ${repos.map((r) => r.folder).join(' and ')}` : ''}: the simplest version that works, so we find out early whether the data model holds. Shall I go ahead?`);
        return { ok: true, summary: 'Proposed the first slice.' };
      }
      await say('On it: a thin slice first.');
      await show({ id: 'mockup', title: 'A first mockup', html: demoMockupPage(goal) });
      // the explainer goes up last, so the screen plays it while the slice is built
      if (parts.explain) {
        hooks.lines([{ kind: 'tool', text: '⏺ mcp__office__explain(How a save travels)' }]);
        const explained = await tools.explain(demoExplainer(repos.map((r) => r.folder))).then((reply) => reply.text, (err: Error) => err.message);
        hooks.lines([{ kind: 'output', text: `  ⎿  ${explained}` }]);
      }
      const leadTodos = (done: number) => ({
        todos: [...repos.map((r) => [`Build ${goal} in ./${r.folder}`, `Building it in ./${r.folder}`]), ['Ship the slice', 'Shipping the slice']].map(([content, activeForm], i) => ({
          content,
          activeForm,
          status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending',
        })),
      });
      await tool('TodoWrite', leadTodos(0));
      // two helpers map the repos side by side while the lead plans: they sit down at the team station while they work
      if (parts.helpers && repos.length > 1) {
        const helpers = repos.map((r) => ({ ...r, id: `demo-helper-${r.folder}-${randomHex(2)}`, files: FILES[kindOf(r.repo)] }));
        // each helper's lines are its own transcript, as the real runner keeps them
        const helperLines = (id: string, lines: Omit<TermLine, 't'>[]) =>
          hooks.helperLines ? hooks.helperLines(id, lines) : hooks.lines(lines.map((l) => ({ ...l, text: `    ${l.text}` })));
        for (const h of helpers) {
          hooks.lines([{ kind: 'tool', text: `⏺ Agent(Map ./${h.folder} for ${goal})` }]);
          hooks.helper?.({ kind: 'started', id: h.id, description: `Map ./${h.folder} for ${goal}`, type: 'Explore' });
          hooks.helper?.({ kind: 'model', id: h.id, model: 'claude-haiku-4-5-20251001' });
          helperLines(h.id, [
            { kind: 'system', text: `✻ Map ./${h.folder} for ${goal}` },
            { kind: 'manager', text: `▶ Read through ./${h.folder} and tell me where ${goal} would fit: the files to change, and anything in the way.` },
          ]);
        }
        hooks.activity('working', `Waiting on ${helpers.length} helpers`);
        for (let step = 0; step < 3; step++) {
          await wait(2, 3.5);
          for (const h of helpers) {
            const file = `${h.folder}/${h.files[step % h.files.length]}`;
            helperLines(h.id, [{ kind: 'tool', text: `⏺ Read(${file})` }, { kind: 'output', text: `  ⎿  Read ${40 + step * 17} lines` }]);
            hooks.helper?.({ kind: 'activity', id: h.id, activity: `Reading ${file}` });
          }
        }
        for (const h of helpers) {
          await wait(1, 2);
          helperLines(h.id, [{ kind: 'text', text: `${h.folder}: ${goal} fits in ${h.files[1]}` }]);
          hooks.helper?.({ kind: 'ended', id: h.id, ok: true, summary: `${h.folder}: ${goal} fits in ${h.files[1]}` });
          helperLines(h.id, [{ kind: 'success', text: '✔ Done' }]);
          hooks.lines([{ kind: 'output', text: `  ⎿  ${h.folder}: ${goal} fits in ${h.files[1]}` }]);
        }
      }
      // a quick script from the scratch dir to try the idea first: a probe on the goal's chart, as the real runner reports one
      if (parts.background) {
        const probe = `demo-probe-${randomHex(3)}`;
        const found = `${goal}: the first try works`;
        hooks.probe?.({ kind: 'started', id: probe, description: 'Script probe.mjs', type: 'script' });
        await tool('Bash', { command: 'node "$FOCUS_SCRATCH/probe.mjs"' }, [found]);
        hooks.probe?.({ kind: 'ended', id: probe, ok: true, summary: found });
      }
      for (const r of repos) {
        const files = FILES[kindOf(r.repo)];
        await tool('Read', { file_path: `/work/${r.folder}/${files[0]}` }, [`Read ${60 + files[0].length} lines`]);
        await tool('Edit', { file_path: `/work/${r.folder}/${files[1]}`, old_string: '// TODO', new_string: `// ${goal}` }, ['Updated 1 file']);
        await tool('Bash', { command: `npm --prefix ${r.folder} test` }, ['Tests: 44 passed, 44 total']);
        await commit(r.folder, `Thin slice: ${goal}`);
        await tool('TodoWrite', leadTodos(repos.indexOf(r) + 1));
      }
      // the app running in the background while the slice is reviewed, and a monitor waiting on the reviews
      const server = parts.background && runInBackground('shell', 'pnpm run dev', (n) => (n === 1 ? '  VITE v7.1.2  ready in 412 ms' : n === 2 ? '  ➜  Local:   http://localhost:5173/' : `  [vite] hmr update /src/App.tsx (x${n - 2})`));
      const monitor = parts.background && parts.workflows && runInBackground('monitor', 'watch for the review workflow to finish', (n) => `waiting… (${n}s)`);
      // a workflow reviews the slice before it ships: its away team beams into the briefing room a phase at a time
      if (parts.workflows) await reviewWorkflows(repos.map((r) => r.folder), goal);
      if (monitor) endJob(monitor, 'done', 'The review workflow finished');
      if (server) endJob(server, 'done', 'Background command "pnpm run dev" completed (exit code 0)');
      await handleInbox();
      const title = `Thin slice: ${goal}`.slice(0, 70);
      if (await ship(title, `## Summary\n\nA first, thin version of ${goal}, end to end.\n\n## Testing\n\n- Tests pass in every repo`)) {
        await tool('TodoWrite', leadTodos(repos.length + 1));
        await say(`Shipped: ${repos.length > 1 ? `a pull request in each of ${repos.map((r) => r.folder).join(' and ')}` : 'a pull request'}. It works end to end in the simplest way; the store code is a bit tangled now, so I'd tidy it in the next slice. Have a look and merge when you're happy.`);
      }
      return { ok: true, summary: 'Shipped the slice.' };
    };

    // the office compacting a conversation: what Claude Code's /compact does, in brief
    const compactScript = async (): Promise<RunOutcome> => {
      hooks.session(req.resumeSessionId ?? `demo-${randomHex(4)}`);
      hooks.activity('working', 'Compacting the conversation');
      await wait(2, 4);
      hooks.lines([{ kind: 'system', text: '✻ Conversation compacted' }]);
      this.context.set(req.resumeSessionId ?? '', 9);
      return { ok: true, summary: '' };
    };

    const script = async (): Promise<RunOutcome> => {
      if (req.prompt.startsWith('/compact')) return compactScript();
      if (req.outputSchema) return qaScript();
      if (req.tools) return leadScript(req.tools);
      const sessionId = req.resumeSessionId ?? `${req.cloud ? 'session_demo' : 'demo-'}${randomHex(4)}`;
      hooks.session(sessionId);
      hooks.lines([{ kind: 'system', text: `✻ Claude Code (demo) · ${req.model || req.settings.model || 'pretend model'} · acceptEdits${req.cloud ? ' · ☁ cloud' : ''}` }]);
      if (req.cloud) hooks.lines([{ kind: 'system', text: `☁ Cloud session: https://claude.ai/code/${sessionId}` }]);
      // a follow-up message, or QA's findings handed to an agent seated on the PR to fix them
      if (req.resumeSessionId || /^QA failed/.test(req.prompt)) {
        inbox.unshift(req.prompt);
        await handleInbox();
        await say('All set. The pull request has been updated with these changes.');
        return { ok: true, summary: 'Addressed the manager\'s feedback.' };
      }

      await say(`I'll start by getting familiar with the codebase for "${title}".`);
      await tool('Glob', { pattern: 'src/**/*.{ts,tsx}' }, [`Found ${12 + (issueNumber % 7)} files`]);
      for (const file of pick(files, 2)) {
        await tool('Read', { file_path: `/work/${file}` }, [`Read ${40 + Math.floor(Math.random() * 160)} lines`]);
      }
      await think();
      // the developer's own task list, moving along as they work
      const todos = (step: number) => ({
        todos: [
          ['Understand the current behaviour', 'Reading the code'],
          [`Implement: ${title}`, 'Implementing it'],
          ['Add tests', 'Adding tests'],
          [kind === 'api' ? 'Run the test suite' : 'Check it in the browser', kind === 'api' ? 'Running the tests' : 'Checking it in the browser'],
        ].map(([content, activeForm], i) => ({ content, activeForm, status: i < step ? 'completed' : i === step ? 'in_progress' : 'pending' })),
      });
      await tool('TodoWrite', todos(1));
      await handleInbox();

      for (const file of pick(files, 2)) {
        await tool('Edit', {
          file_path: `/work/${file}`,
          old_string: 'export function render(state) {\n  return view(state);',
          new_string: `export function render(state) {\n  // ${title}\n  return view(withFix(state));`,
        }, ['Updated 1 file']);
      }
      await tool('TodoWrite', todos(2));
      await tool('Write', {
        file_path: `/work/test/issue-${issueNumber}.test.ts`,
        content: `import { describe, it, expect } from 'vitest';\n\ndescribe('${title.replace(/'/g, '')}', () => {\n  it('works', () => {\n    expect(run()).toBe(true);\n  });\n});`,
      }, ['Created file']);

      if (issueNumber % 4 === 2) {
        hooks.lines([{ kind: 'tool', text: '⏺ Bash(rm -rf dist && npm run build)' }]);
        const ok = await hooks.permission('Bash', 'Bash(rm -rf dist && npm run build)', abort.signal);
        if (stopped) throw new Error('stopped');
        hooks.activity('working', ok ? 'Rebuilding' : 'Finding another way');
        hooks.lines([{ kind: ok ? 'output' : 'error', text: ok ? '  ⎿  built in 2.31s' : '  ⎿  Declined by the captain' }]);
        await wait(1, 2);
      }

      await tool('Bash', { command: kind === 'api' ? 'npm test' : 'npx vitest run' }, [
        `✓ test/issue-${issueNumber}.test.ts (3 tests)`,
        `Test Files  ${6 + (issueNumber % 3)} passed`,
        `Tests  ${41 + issueNumber} passed`,
      ]);

      await tool('TodoWrite', todos(3));
      if (kind !== 'api') {
        await tool('Bash', { command: 'npm run dev &', run_in_background: true }, ['VITE ready on http://localhost:5173']);
        const pages = ['/', kind === 'game' ? '/play' : '/products/42', kind === 'game' ? '/scores' : '/cart'];
        for (let step = 0; step < 3; step++) {
          const url = `http://localhost:5173${pages[step]}`;
          if (req.cloud) {
            // in the cloud there's no office browser: a Playwright script saves a screenshot, and reading it puts it on the laptop
            const file = `/tmp/shots/${step + 1}.png`;
            await tool('Bash', { command: `node shot.mjs ${url} ${file}` }, [`Saved ${file}`]);
            await tool('Read', { file_path: file }, ['[screenshot]']);
            hooks.browser({ url, title: `${step + 1}.png`, mock: { heading: title, accent, step }, at: Date.now() });
            hooks.activity('testing', `Checking a screenshot of ${url}`);
          } else {
            const name = step === 0 ? 'open' : step === 1 ? 'click' : 'screenshot';
            await tool(`mcp__browser__${name}`, step === 1 ? { text: 'Add to cart' } : { url }, [`URL: ${url}`, '[screenshot]']);
            hooks.browser({ url, title: title.slice(0, 40), mock: { heading: title, accent, step }, at: Date.now() });
          }
          await wait(1.5, 3);
        }
      }
      await tool('TodoWrite', todos(4));
      await handleInbox();
      await tool('Bash', { command: `git add -A && git commit -m "${title.replace(/"/g, '')} (#${issueNumber})"` }, [
        `[focus/issue-${issueNumber} a1b2c3d] ${title}`,
        ' 3 files changed, 58 insertions(+), 9 deletions(-)',
      ]);
      await push();
      const summary = scripted
        ? scripted.summary
        : `## Summary\n\nResolves "${title}".\n\n- Updated ${pick(files, 2).join(' and ')}\n- Added tests in \`test/issue-${issueNumber}.test.ts\`\n\n## Testing\n\n- \`npm test\` passes${kind !== 'api' ? '\n- Checked the flow in the browser' : ''}`;
      await say('Done! Committed the change with tests. Summary for the pull request:');
      hooks.lines(summary.split('\n').map((text) => ({ kind: 'text', text: `  ${text}` })));
      return { ok: true, summary };
    };

    // each turn fills the pretend context a little more, as a real session's would
    const done = script()
      .then((outcome) => {
        const percent = Math.min(97, (this.context.get(session) ?? 4) + (req.prompt.startsWith('/compact') ? 0 : 8 + Math.round(Math.random() * 10)));
        this.context.set(session, percent);
        hooks.context?.({ percent, tokens: percent * 2000, max: 200_000 });
        return outcome;
      })
      .catch((err): RunOutcome => (stopped ? { ok: false, summary: '', error: STOPPED_BY_CAPTAIN, aborted: true } : { ok: false, summary: '', error: String(err) }))
      .finally(() => {
        finished = true;
      });

    return {
      send: (text) => {
        if (finished) return false;
        inbox.push(text);
        return true;
      },
      stopTask: (taskId) => Promise.resolve(endJob(taskId, 'stopped', 'Stopped')),
      setAutonomy: (mode) => {
        autonomy = mode;
        return true;
      },
      stop: () => {
        stopped = true;
        abort.abort();
        for (const id of [...jobs.keys()]) endJob(id, 'stopped', 'Stopped');
      },
      done,
    };
  }
}

/** Demo agents don't touch git. */
export const demoWorkspace: WorkspaceOps = {
  create: async (_repo, agentId) => `/demo/${agentId}`,
  remove: async () => undefined,
  install: async () => undefined,
  dir: (agentId) => `/demo/${agentId}`,
  hasUncommittedChanges: async () => false,
  commitsAhead: async () => 2,
  // demo agents always commit something, so every session ends on a new commit
  head: async () => randomHex(5),
  // ...and ship everything they commit
  unshippedCommits: async () => [],
  freshBranch: async () => undefined,
  renameBranch: async () => undefined,
  cherryPick: async () => undefined,
  push: async () => sleep(800),
  publish: async () => sleep(400),
  pull: async () => sleep(400),
  // no real checkout: the manager falls back to the PR's head as GitHub reports it
  checkoutPullRequest: async () => {
    await sleep(600);
    return '';
  },
  // the demo's conflicting PR always needs an agent, so there's someone to watch resolving it
  mergeBase: async () => {
    await sleep(600);
    return { kind: 'conflicts', files: ['src/header.ts'] };
  },
  missingRemoteCommits: async () => false,
  reopen: async (_repo, agentId) => `/demo/${agentId}`,
  snapshot: async () => false,
  // everything the demo's leads commit, they ship
  branchState: async () => ({ onOrigin: true, unpushed: 0 }),
  sinceVerdict: async (_repo, _number, _baseBranch, sha: string) => {
    await sleep(400);
    return demoSinceVerdict(sha);
  },
  // the demo's projects pass their checks after a pretend run
  runChecks: async (_repo, _number, head) => {
    await sleep(1500);
    return { sha: head, results: ['npm ci', 'npm run typecheck', 'npm run lint', 'npm test'].map((command) => ({ command, ok: true })) };
  },
};

/** The demo planner's judgement of an idea too big for one issue: a rebuild, or a list of three or more features. */
export function demoTooBig(idea: string): string | undefined {
  const rebuild = /\b(rebuild|rewrite|overhaul|redesign|replatform|migrate)\b/i.exec(idea);
  const features = idea.split(/,|\band\b|\bplus\b/i).filter((part) => part.trim()).length;
  if (rebuild && features >= 3) return `A ${rebuild[0].toLowerCase()} with ${features} separate features is several issues' worth of work.`;
  if (rebuild) return `A ${rebuild[0].toLowerCase()} is more than one agent can finish in one sitting.`;
  if (features >= 3) return `That's ${features} separate features, more than one agent can build in one sitting.`;
  return undefined;
}

/** The demo planner: pretends to read the code, then writes a plausible issue from the idea. */
export class DemoDrafter implements Drafter {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async draft(req: DraftRequest, activity: (text: string) => void): Promise<DraftResult> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Discarded');
    };
    const idea = req.idea || req.revise?.title || 'the change';
    const backend = /\b(api|endpoint|server|order|auth|login|rate|database|email)\b/i.test(idea);
    const repo = req.revise?.repo ?? (req.repos.find((r) => (backend ? /api|server|backend/ : /web|front|app|game|dodger/).test(r)) ?? req.repos[0]);
    const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
    const files = pick(FILES[kind], 3);
    const folder = repo.split('/')[1];

    activity('Pulling the latest code');
    await wait(1);
    if (req.revise) {
      activity('Rereading my draft');
      await wait(1.5);
      activity(`Reading ${folder}/${files[0]}`);
      await wait(2);
      activity('Thinking…');
      await wait(2);
      const note = req.revise.notes.trim().replace(/\.$/, '');
      const body = req.revise.body.replace(/\n+## Out of scope/, `\n- [ ] ${note.charAt(0).toUpperCase()}${note.slice(1)}\n\n## Out of scope`);
      return { repo, title: req.revise.title, body, tooBig: demoTooBig(req.idea), sessionId: req.resumeSessionId, costUsd: 0.04 };
    }
    for (const step of [`Reading ${folder}/CLAUDE.md`, `Searching ${folder} for related code`, ...files.map((f) => `Reading ${folder}/${f}`), 'Thinking…']) {
      activity(step);
      await wait(1.6 + Math.random() * 1.4);
    }
    const clean = idea.replace(/\s+/g, ' ').trim().replace(/[.!]$/, '');
    const title = clean.charAt(0).toUpperCase() + clean.slice(1, 70);
    const body = [
      '## Context',
      '',
      `The captain asked for: "${clean}". Today the relevant behaviour lives in \`${files[0]}\`, with supporting code in \`${files[1]}\`.`,
      '',
      '## What to build',
      '',
      `- ${title}, following the existing patterns in \`${files[0]}\`.`,
      `- Keep the change contained to ${folder}; update \`${files[2]}\` only where it has to change.`,
      '',
      '## Acceptance criteria',
      '',
      `- [ ] ${title} works end to end${kind === 'api' ? ' (covered by a test against the endpoint)' : ' in the browser'}.`,
      '- [ ] Empty and error states are handled (no blank screen or unhandled exception).',
      kind === 'api' ? '- [ ] Invalid input returns a 4xx with a helpful message.' : '- [ ] It looks right at phone width (375px).',
      '- [ ] Existing tests still pass, and new behaviour has a test.',
      '',
      '## Out of scope',
      '',
      '- Redesigning anything beyond what this change needs.',
      '',
      '## Assumptions',
      '',
      `- This belongs in ${repo}${req.repos.length > 1 ? ' rather than the other repos in the project' : ''}.`,
    ].join('\n');
    return { repo, title, body, tooBig: demoTooBig(idea), sessionId: `demo-plan-${randomHex(3)}`, costUsd: 0.11 };
  }
}

/** Demo mode: the quick answerer, answering about the beat the captain's on in a second or so, as Haiku would. */
export class DemoQuickAnswerer implements QuickAnswerer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async answer(req: QuickQuestion): Promise<{ text: string }> {
    await sleep((800 + Math.random() * 600) / this.speed);
    const beat = req.spot ? briefingBeats(req.briefing.html)?.[req.spot.beat] : undefined;
    const about = beat ? `On “${beat.title}”: ${beat.text}` : `From “${req.briefing.title}”, as far as I can tell:`;
    return { text: `${about} ${req.leadName} is busy building the slice, so I've answered for now, and passed your question on in case there's more to it.` };
  }
}

/**
 * The demo operations officer at a stuck PR: re-runs a red check, retries QA when its fixes have landed (the demo's
 * stubborn PRs), sends a fix that pushed nothing back with a different plan, and escalates the second time round.
 */
export class DemoTriager implements Triager {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async triage(req: TriageRequest, activity: (text: string) => void): Promise<TriageDecision> {
    const folder = req.repo.split('/')[1];
    const file = /`([^`]+)`/.exec(req.review.report?.fixInstructions ?? '')?.[1] ?? 'src/App.tsx';
    for (const step of ["Reading QA's reports", `Reading ${folder}/${file}`, 'Reading the diff', "Checking GitHub's checks", 'Thinking…']) {
      activity(step);
      await sleep((1500 + Math.random() * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    }
    const red = req.checks[0];
    if (req.review.triage) return { action: 'escalate', note: `I already tried ${req.review.triage.action} and it's still stuck: this needs your call on what ${req.pr.title} should do.` };
    if (red) return { action: 'rerun-checks', note: `${red.name} timed out fetching dependencies, which looks like a runner outage rather than this change.` };
    if (req.review.report && (req.review.failedRounds ?? 0) > 1) {
      return {
        action: 'retry-qa',
        note: `The empty-state guard in \`${file}\` landed in the last fix, but QA keeps testing a stale dev server. Restart it from a clean install before checking the empty state.`,
      };
    }
    return { action: 'send-back', note: `Don't patch the symptom in ${file}: default the list to [] where it's loaded, and add the test QA asked for.` };
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Demo mode: the diagram a lead puts on the screen while proposing the first slice, a box per repo. */
function demoFlowPage(goal: string, folders: string[]): string {
  const boxes = ['shopper', ...folders, 'database'];
  const step = 1180 / boxes.length;
  const boxW = step - 70;
  const svg = boxes.map((b, i) => {
    const x = 50 + i * step;
    const arrow = i < boxes.length - 1 ? `<path d="M${x + boxW + 10} 260 H${x + step - 14}" stroke="#ffcc66" stroke-width="6" marker-end="url(#a)"/>` : '';
    const fill = i === 0 || i === boxes.length - 1 ? '#3a4a6b' : '#cc6699';
    return `<rect x="${x}" y="190" width="${boxW}" height="140" rx="24" fill="${fill}"/><text x="${x + boxW / 2}" y="270" fill="#fff" font-size="24" text-anchor="middle">${escapeHtml(b)}</text>${arrow}`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:system-ui;color:#eee"><div style="padding:50px 60px 0"><h1 style="font-size:48px;margin:0">The data flow</h1><p style="font-size:26px;color:#99ccff;margin:10px 0 0">${escapeHtml(goal)}</p></div>
<svg viewBox="0 0 1280 500" style="width:100%"><defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#ffcc66"/></marker></defs>${svg}</svg></body></html>`;
}

/**
 * Demo mode: the explainer a lead walks the captain through first, a save travelling from the shopper through each repo
 * to the database and waiting out an outage. Its script is written for the explain tool, as a lead's would be.
 */
function demoExplainer(folders: string[], detailed = false): ExplainerInput {
  const boxes = ['shopper', ...folders, 'database'];
  const step = 1050 / boxes.length;
  const html = boxes.map((b, i) =>
    `<div class="panel box" style="left:${Math.round(i * step)}px;top:150px;width:${Math.round(step - 40)}px;--c:var(--${i === 0 ? 'lilac' : i === boxes.length - 1 ? 'sky' : 'peach'})"><div class="hd"><span>${escapeHtml(b)}</span><span>0${i + 1}</span></div><div class="bd"><span class="state"></span></div></div>`,
  ).join('') + '<span class="lbl" style="left:0;top:40px">The journey of one save</span><div class="pill" id="save" style="top:330px;--c:var(--gold)">♥ save</div>';
  const script = `
const boxes = $$('.box'), last = boxes.length - 1;
const colours = boxes.map(b => b.style.getPropertyValue('--c'));
const centre = i => boxes[i].offsetLeft + boxes[i].offsetWidth / 2 - 50;
// where the save is at t: hops along the boxes in beats 1 and 2, waits at the last repo in beat 3 until the database is back
function at(t) {
  if (t < B[1]) return p(t, 1, B[1] - .5);
  if (t < B[2]) return 1 + (last - 2) * p(t, B[1] + .3, B[2] - .5);
  return last - 1 + p(t, B[2] + 3.2, B[2] + 4.2);
}
function render(t) {
  const x = at(t), i = Math.floor(x), k = x - i;
  const pos = i >= last ? centre(last) : centre(i) + (centre(i + 1) - centre(i)) * k;
  $('#save').style.transform = 'translateX(' + pos + 'px)';
  const down = t > B[2] + .3 && t < B[2] + 3.2;
  boxes.forEach((b, n) => {
    const reached = x >= n - .01;
    b.style.setProperty('--c', n === last && down ? 'var(--red)' : colours[n]);
    b.querySelector('.state').innerHTML = n === last ? (down ? tag('offline', 'red') : reached ? tag('saved ✓', 'green') : '') : n === last - 1 && down ? tag('retry queued', 'gold') : reached ? tag('passed on', 'green') : '';
  });
}`;
  return {
    id: 'save-journey',
    title: 'How a save travels',
    beats: [
      { title: 'The shopper saves an item', text: 'Pressing save sends one small request: which item, and who is saving it. Nothing else changes on the page until it is safely stored.', seconds: 4, label: 'Save', narration: 'On the far left is the shopper. When they press save, that gold pill sets off: one small request saying which item, and who is saving it.' },
      { title: 'Each repo passes it on', text: `It travels through ${folders.join(' and ')}, each checking what it owns before handing it to the next, and lands as one row in the database.`, seconds: 5, label: 'Pass it on', narration: 'Watch it hop along the boxes in the middle. Each one is a repo, and each checks the part it owns before handing the save on, until it lands as a row in the database on the right.' },
      detailed
        ? { title: 'If the database is down, it retries', text: 'The last repo keeps the save in a retry queue and tries again three times, a second apart. If the database is still down after the third, the page tells the shopper it couldn’t save, and the item stays in the queue.', seconds: 6, label: 'Outage', narration: 'Here is that part in more detail. The database goes red, and the save waits in the retry queue at the last repo. It tries three times, a second apart. If the database is still down after the third, the shopper is told, and the save stays queued until it is back.' }
        : { title: 'If the database is down, it waits', text: 'The last repo keeps the save in a retry queue rather than dropping it, and sends it again when the database is back, so the shopper never loses an item.', seconds: 6, label: 'Outage', narration: 'Now the database goes red: it is down. Notice the save does not vanish. It waits at the last repo in a retry queue, and the moment the database is back, it goes through.' },
    ],
    stage: { html, css: '.box .bd { min-height:60px; }', script },
  };
}

/** Demo mode: the other option a lead asks the captain about, a plain list. */
function demoListPage(goal: string): string {
  const row = (name: string, price: string) =>
    `<li style="display:flex;justify-content:space-between;padding:22px 10px;border-bottom:2px solid #eee;font-size:28px"><span>${name}</span><span style="color:#888">${price}</span><a style="color:#ff8a5b">Remove</a></li>`;
  return `<!doctype html><html><body style="margin:0;background:#fff;font-family:system-ui;color:#222;padding:40px 60px"><h1 style="font-size:40px;margin:0 0 20px">${escapeHtml(goal)}</h1>
<ul style="list-style:none;padding:0;margin:0;max-width:900px">${row('Stripy socks', '£6')}${row('Wool hikers', '£12')}${row('Ankle trio', '£9')}</ul></body></html>`;
}

/** Demo mode: the mockup a lead puts on the screen as the slice starts. */
function demoMockupPage(goal: string): string {
  const card = (name: string, price: string, saved: boolean) =>
    `<div style="background:#fff;border-radius:16px;padding:24px;width:300px;box-shadow:0 4px 16px #0002"><div style="height:160px;background:#ffd8c2;border-radius:10px"></div><h3 style="font-size:26px">${name}</h3><p style="font-size:22px;color:#555">${price}</p><button style="font-size:22px;padding:10px 18px;border-radius:999px;border:2px solid #ff8a5b;background:${saved ? '#ff8a5b' : '#fff'};color:${saved ? '#fff' : '#ff8a5b'}">${saved ? '♥ Saved' : '♡ Save for later'}</button></div>`;
  return `<!doctype html><html><body style="margin:0;background:#fff4ec;font-family:system-ui;color:#222;padding:40px 60px"><h1 style="font-size:40px;margin:0 0 30px">${escapeHtml(goal)}</h1>
<div style="display:flex;gap:30px">${card('Stripy socks', '£6', true)}${card('Wool hikers', '£12', false)}${card('Ankle trio', '£9', false)}</div></body></html>`;
}

// ---------------------------------------------------------------- older sessions

/** A transcript line the way Claude Code writes one. */
let demoLine = 0;
const said = (type: 'user' | 'assistant', minutesAgo: number, content: unknown) =>
  JSON.stringify({ type, uuid: `demo-${++demoLine}`, timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(), message: { role: type, content } });
const toolError = (minutesAgo: number, text: string) => said('user', minutesAgo, [{ type: 'tool_result', is_error: true, content: text }]);
const toolCall = (minutesAgo: number, name = 'Bash', input: unknown = {}) => said('assistant', minutesAgo, [{ type: 'tool_use', name, input }]);

/** A few scripted older sessions, for the demo's backfill to digest and plugins to read: the office's real transcripts stay out of the demo. */
export async function demoTranscripts(): Promise<Transcript[]> {
  const sessions: (Omit<Transcript, 'read'> & { lines: string[] })[] = [];
  const add = (name: string, kind: Transcript['kind'], lines: string[]) => sessions.push({ name, kind, sessionId: `${name.slice(-8)}-demo`, lines });
  add('lead-demo-wishlist__0a1b2c3d', 'lead', [
    said('user', 300, 'Your workspace, with every repo of the project checked out side by side: …'),
    said('assistant', 290, 'Slice 1 is shipped. Shall I start slice 2?'),
    said('user', 280, 'go'),
    toolCall(275),
    toolError(274, 'Error: listen EADDRINUSE: address already in use :::4591'),
    said('assistant', 200, 'Slice 2 is ready for review. Want me to ship it?'),
    said('user', 190, 'ship it'),
  ]);
  add('lead-demo-stock__4e5f6a7b', 'lead', [
    said('user', 240, 'Your workspace, with every repo of the project checked out side by side: …'),
    toolCall(230),
    toolError(229, 'Error: listen EADDRINUSE: address already in use :::4591'),
    said('assistant', 150, 'The stock badge is in. Next: low-stock warnings, if you want them.'),
    said('user', 140, 'continue'),
  ]);
  add('qa-demo-shop__8c9d0e1f', 'qa', [
    said('user', 100, 'Please QA pull request #8 in demo/webshop-frontend: Wishlist page'),
    toolCall(95),
    toolError(94, 'Error: listen EADDRINUSE: address already in use :::4591'),
    said('assistant', 93, [{ type: 'text', text: 'Another office already had the demo’s port, so I started this one on a free port and carried on: the wishlist page loads, and hearts toggle and survive a reload.' }]),
    toolCall(90, 'StructuredOutput', { verdict: 'pass', summary: 'The wishlist page works; the demo office was on a taken port at first.' }),
  ]);
  return sessions.map(({ lines, ...t }) => ({ ...t, read: () => Promise.resolve(lines.join('\n')) }));
}

// ---------------------------------------------------------------- the studio

/**
 * Scene fan-out, in the round: a gold core in the middle beams `n` agents in on pads round it, throws each a job, and
 * folds their answers back in, timed by its phases.
 */
const demoSceneFanOut = (n: number) => `const N = ${n}, R = 4.4;
const core = kit.ball({ r: 0.7, at: [0, 2.4, 0], colour: 'gold', glow: true });
const caption = kit.label('Planning the work', { at: [0, 4.2, 0], colour: 'text', size: 0.45 });
const spots = Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2; return [Math.sin(a) * R, Math.cos(a) * R, a]; });
spots.forEach(([x, z]) => kit.pad({ at: [x, 0, z], colour: 'sky' }));
const agents = spots.map(([x, z, a], i) => kit.person({ name: 'Agent ' + (i + 1), line: 'Part ' + (i + 1), at: [x, 0, z], face: a + Math.PI }));
const rays = spots.map(([x, z]) => kit.line([0, 2.4, 0], [x, 1.6, z], { colour: 'lilac', width: 0.05 }));
const jobs = spots.map(() => kit.ball({ r: 0.16, at: [0, 2.4, 0], colour: 'sky', glow: true }));
const answers = spots.map(() => kit.ball({ r: 0.2, at: [0, 2.4, 0], colour: 'gold', glow: true }));
const gap = 2 / N;
function render(t) {
  const fan = phase.start('fan'), fold = phase.start('fold');
  core.scale.setScalar(1 + 0.6 * burst(t, phase.end('fold'), 0.1, 0.8) + 0.05 * Math.sin(t * 3));
  spots.forEach(([x, z], i) => {
    kit.beam(agents[i], stagger(t, i, fan, fan + 0.8, gap));
    const out = stagger(t, i, fan + 0.6, fan + 1.6, gap);
    const back = stagger(t, i, fold, fold + 1.2, gap);
    rays[i].visible = out > 0.01 && back < 0.99;
    rays[i].scale.x = Math.max(0.001, out * (1 - back));
    jobs[i].visible = out > 0.01 && out < 0.99;
    jobs[i].position.set(x * out, 2.4 - 0.8 * out, z * out);
    answers[i].visible = back > 0.01 && back < 0.99;
    answers[i].position.set(x * (1 - back), 1.6 + 0.8 * back + Math.sin(back * Math.PI) * 1.2, z * (1 - back));
    agents[i].status = t < fan + 1.6 ? 'waiting' : t < fold ? 'working' : 'done';
  });
  caption.text = t < fan ? 'Planning the work' : t < phase.start('work') ? 'Fanning out to ' + N + ' agents' : t < fold ? 'Working side by side' : 'Folding back: only answers';
}`;
const DEMO_FAN_PHASES: Record<string, [number, number]> = { plan: [0, 1.5], fan: [1.5, 5], work: [5, 8.5], fold: [8.5, 12] };

/** Scene pipeline, in the round: work items ride a track through three gates, each moving on the moment its gate's done. */
const DEMO_SCENE_PIPELINE = `const curve = new THREE.CatmullRomCurve3([[-5, 0.8, 2], [-2.5, 2.6, -2.5], [1, 1.2, 2.5], [4.6, 3, -1.5]].map((a) => new THREE.Vector3(...a)));
kit.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.08, 8), new THREE.MeshBasicMaterial({ color: kit.colours.peri })));
const gates = [0.3, 0.6, 0.85].map((k) => {
  const g = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: kit.colours.gold }));
  g.position.copy(curve.getPointAt(k));
  g.lookAt(curve.getPointAt(k + 0.01));
  return kit.add(g);
});
const N = 30, items = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshBasicMaterial(), N);
kit.add(items);
const m = new THREE.Matrix4(), c = new THREE.Color();
function render(t) {
  for (let i = 0; i < N; i++) {
    const k = clamp((t - phase.start('flow') - i * 0.3) / 6, 0, 1);
    const at = curve.getPointAt(k);
    items.setMatrixAt(i, m.makeTranslation(at.x, at.y, at.z));
    items.setColorAt(i, c.set(k >= 1 ? kit.colours.green : kit.colours.sky));
  }
  items.instanceMatrix.needsUpdate = true;
  items.instanceColor.needsUpdate = true;
  gates.forEach((g, j) => g.scale.setScalar(1 + 0.15 * Math.sin(t * 4 + j)));
}`;

/** The script a demo lead reviews its slice with: a pipeline of scans and checks, a fan-out, and a summary. */
const DEMO_REVIEW_SCRIPT = `export const meta = {
  name: 'review-slice',
  description: 'Review the slice before it ships',
  phases: [
    { title: 'Scan', detail: 'one scanner per area of the app' },
    { title: 'Check', detail: 'confirm what each scan found' },
    { title: 'Fan', detail: 'try the change against 24 cases' },
    { title: '▸ summarise', detail: 'write up what was found' },
  ],
}

const AREAS = ['store', 'routes', 'views', 'tests', 'styles', 'config']
const FINDINGS = { type: 'object', properties: { broken: { type: 'array' } } }

phase('Scan')
const checked = await pipeline(AREAS,
  area => agent(\`Scan the \${area} for anything the slice breaks\`, { label: \`scan:\${area}\`, schema: FINDINGS }),
  (found, area) => agent(\`Check what the scan of the \${area} found\`, { label: \`check:\${area}\`, phase: 'Check' }))
log(\`\${checked.filter(Boolean).length}/\${AREAS.length} areas scanned and checked\`)

phase('Fan')
const cases = await parallel(Array.from({ length: 24 }, (_, i) => () =>
  agent(\`Try the slice with case \${i}\`, { label: \`fan:\${i}\` })))
log(\`\${cases.filter(Boolean).length}/24 cases pass\`)

phase('▸ summarise')
const [summary, notes] = await parallel([
  () => agent('Summarise the findings', { label: 'child:1' }),
  () => agent('Draft the PR notes', { label: 'child:2' }),
])
return { summary, notes, failing: cases.filter((c) => !c).length }
`;

/** The script a demo lead maps its repos with: an agent per repo, side by side. */
const DEMO_MAP_SCRIPT = `export const meta = {
  name: 'map-repos',
  description: 'Map each repo for the goal',
  phases: [{ title: 'Map', detail: 'one agent per repo, side by side' }],
}

phase('Map')
const maps = await parallel(args.repos.map((repo) => () =>
  agent(\`Map ./\${repo} for the goal\`, { label: \`map:\${repo}\` })))
log(\`\${maps.filter(Boolean).length} repos mapped\`)
return maps
`;

/**
 * Where `needle` first turns up in `file` (relative to the office's own code), as a model cites it, so the demo's model
 * keeps pointing at the right lines as the code moves; line 1 if it's gone (and the check will say so).
 */
function demoCite(file: string, needle: string): ModelCite {
  const at = path.join(config.root, file);
  let line = 1;
  try {
    const found = fs.readFileSync(at, 'utf8').split(/\r?\n/).findIndex((l) => l.includes(needle));
    if (found >= 0) line = found + 1;
  } catch {
    // the check against the code reports the missing file
  }
  return { file: at, line };
}

/** The demo's system model: how a lead's ship tool becomes pushed branches, a pull request and a QA review, from the office's own code. */
export function demoShipModel(): SystemModel {
  const slices = 'server/agents/manager/slices.ts';
  return {
    question: 'How does a lead’s ship become a pull request that QA reviews?',
    nodes: [
      { id: 'lead', label: 'Lead’s session', kind: 'external', layer: 'Agents', cite: demoCite('server/agents/manager/sessions.ts', 'ship: (input) =>') },
      { id: 'ship-tool', label: 'ship tool', kind: 'route', layer: 'Office', symbol: 'ship', cite: demoCite('server/agents/officeTool.ts', "'ship',") },
      { id: 'ship-lead', label: 'Slices.shipLead', kind: 'handler', layer: 'Office', symbol: 'shipLead', cite: demoCite(slices, 'shipLead(agent: Agent') },
      { id: 'push', label: 'Workspace.push', kind: 'service', layer: 'Office', symbol: 'push', cite: demoCite('server/agents/services.ts', 'push(dir: string, branch: string)') },
      { id: 'create-pr', label: 'GitHub.createPullRequest', kind: 'service', layer: 'GitHub', symbol: 'createPullRequest', cite: demoCite('server/github/service.ts', 'createPullRequest(repo: string') },
      { id: 'gh', label: 'gh pr create', kind: 'external', layer: 'GitHub', symbol: "'pr', 'create'", cite: demoCite('server/github/ghCli.ts', "'pr', 'create'") },
      { id: 'review', label: 'Reviews.requestReview', kind: 'handler', layer: 'QA', symbol: 'requestReview', cite: demoCite('server/agents/manager/reviews.ts', 'requestReview(projectId: string') },
    ],
    edges: [
      { from: 'lead', to: 'ship-tool', kind: 'calls', label: 'mcp__office__ship', cite: demoCite('server/agents/officeTool.ts', 'tools.ship(') },
      { from: 'ship-tool', to: 'ship-lead', kind: 'calls', cite: demoCite('server/agents/manager/sessions.ts', 'slices.shipLead(') },
      { from: 'ship-lead', to: 'push', kind: 'calls', cite: demoCite(slices, 'workspace.push(') },
      { from: 'ship-lead', to: 'create-pr', kind: 'calls', cite: demoCite(slices, 'github.createPullRequest(') },
      { from: 'create-pr', to: 'gh', kind: 'calls', cite: demoCite('server/github/ghCli.ts', "'pr', 'create'") },
      { from: 'ship-lead', to: 'review', kind: 'emits', cite: demoCite(slices, 'reviews.requestReview(') },
    ],
    trace: [
      { from: 'lead', to: 'ship-tool', label: 'The lead calls ship', payload: '{ title, summary }' },
      { from: 'ship-tool', to: 'ship-lead', label: 'The office takes it over', payload: 'agent, { title, summary }' },
      { from: 'ship-lead', to: 'push', label: 'Push each repo with new commits', payload: 'dir, branch' },
      { from: 'ship-lead', to: 'create-pr', label: 'Open the pull request (or update it)', payload: '{ head, base, title, body }' },
      { from: 'create-pr', to: 'gh', label: 'gh pr create', payload: '--head --base --title --body-file -' },
      { from: 'gh', to: 'create-pr', label: 'GitHub answers', payload: '{ number, url }' },
      { from: 'ship-lead', to: 'review', label: 'Ask QA to review it', payload: 'repo, number, title' },
      { from: 'ship-tool', to: 'lead', label: 'The lead hears what opened', payload: '"Opened owner/repo#N"' },
    ],
    simplified: ['Retries, and refusing to ship with uncommitted changes, left out', 'One repo shown; shipLead does this for every repo with new commits'],
    checks: [
      { q: 'Who pushes the lead’s branch: the lead, or the office?', a: 'The office, in shipLead, through Workspace.push.', cite: demoCite(slices, 'workspace.push(') },
      { q: 'What starts QA’s review of the pull request?', a: 'shipLead asks Reviews.requestReview once the PR is open.', cite: demoCite(slices, 'reviews.requestReview(') },
    ],
  };
}

/** The demo's studio computer: scripted turns that stage real scenes in the middle of the hall, so the studio shows in the demo. */
export class DemoStudio implements StudioOfficer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async turn(req: StudioTurn, activity: (text: string) => void): Promise<StudioReply> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    };
    const said = req.messages.filter((m) => m.from === 'captain').at(-1)?.text.replace(/\s+/g, ' ').trim() ?? '';
    const q = said.toLowerCase();
    const reply = (text: string): StudioReply => ({ text, sessionId: req.resumeSessionId ?? `demo-studio-${randomHex(3)}`, costUsd: 0.05, model: req.model || 'claude-sonnet-5-5' });
    const tool = async <T>(what: string, run: () => T | Promise<T>) => {
      activity(what);
      await wait(0.8);
      return run();
    };
    const looked = (staged: Staged) => (staged.sheet ? 'I walked round its contact sheet first: it reads from every side.' : 'No one’s in the studio to run it yet.');
    activity('Thinking…');
    await wait(1);

    if (/how does|how do|architecture|data flow|model|ship/.test(q)) {
      const staged = await tool('Checking the model against the code', () => req.tools.model({ id: 'ship-flow', label: 'Lead ships a slice', model: demoShipModel() }));
      const problems = /found (\d+) problem/.exec(staged.text)?.[1];
      return reply(`**ship-flow** is up: how a lead's ship becomes a pull request QA reviews, recovered from the office's own code. Seven parts, six connections, an eight-step scenario. ${problems ? `${problems} cites didn't check out; they're red.` : 'Every cite checked out against the code.'} ${looked(staged)}`);
    }
    const current = currentTake(req.takes);
    if (current && /slow/.test(q)) {
      await tool('Retiming the scene', () => req.tools.retime({ id: current.id, speed: 0.5 }));
      return reply(`**${current.id}** now plays at half speed: every phase takes twice as long, the rest as it was.`);
    }
    if (/pipeline|track|conveyor|gate/.test(q)) {
      const staged = await tool('Building the scene', () => req.tools.take({ id: 'pipeline', label: 'Track and gates', metaphor: 'Work items ride a track through three gates; each moves on the moment its own gate is done, so the track never waits for the slowest', seconds: 14, phases: { flow: [0, 13] }, script: DEMO_SCENE_PIPELINE }));
      return reply(`**pipeline** is up: work riding a track through three gates, turning green as it comes out the end. ${looked(staged)}`);
    }
    const more = current?.id === 'fan-out' && /more|bigger|lots|dozens/.test(q);
    const n = more ? 16 : 8;
    const staged = await tool('Building the scene', () => req.tools.take({ id: 'fan-out', label: 'Fan out, fold back', metaphor: `A gold core beams ${n} agents in round it, throws each a job, and pulls back only their answers`, detail: 'Agents as crew on pads: one job each, no queue', seconds: 13, phases: DEMO_FAN_PHASES, script: demoSceneFanOut(n) }));
    return reply(more
      ? `**fan-out** now runs ${n} agents round the core. ${looked(staged)}`
      : `**fan-out** is in the middle of the room: a gold core beams ${n} agents in round it, hands each a job, and folds their answers back in. Walk round it, or hold Q or R to spin it. ${looked(staged)}`);
  }
}
