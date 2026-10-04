import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import type { Preview, PreviewConfig, PreviewLink, PreviewLog } from '../shared/types';
import { checkoutPreview } from './agents/workspace';
import { config, paths } from './config';
import type { GitHubProvider } from './github/provider';
import type { Hub } from './hub';
import { errorMessage, sleep, truncate } from './util';

const LOG_LINES = 600;
const MAX_LINKS = 8;
const WINDOWS = process.platform === 'win32';
/** Named links like these go after the ones a person opens first (web before api). */
const BACKSTAGE = /api|backend|server|db|database|postgres|swagger|docs|health|metrics/i;
const STOP_TIMEOUT = 5 * 60_000;

interface Run {
  preview: Preview;
  config: PreviewConfig;
  /** Every repository in the project, for {dir:<repo>}. */
  repos: string[];
  log: string[];
  /** Lines printed so far, including ones trimmed from `log`. */
  printed: number;
  pending: string[];
  flush?: NodeJS.Timeout;
  /** Tail of the start command's stdout, for a JSON result. */
  stdout: string;
  /** The start command's JSON result named the links; stop guessing them from URLs in its output. */
  namedLinks?: boolean;
  phase?: string;
  /** The start command exited successfully and left the site(s) running on their own. */
  detached?: boolean;
  watching?: boolean;
  /** Every checkout of this preview, as given and with symlinks resolved, to find our stack in a list of stacks. */
  checkouts: string[];
  /** Our stack showed up in the progress command's list of stacks; how many polls since it went missing. */
  listed?: boolean;
  unlisted: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Expanded, once there's something to stop. */
  stopCommand?: string;
  statusCommand?: string;
  /** Stops the start command and everything it started: SIGTERM, a grace period, then SIGKILL. */
  kill?: () => Promise<void>;
  /** Last resort when the office itself is exiting. */
  killNow?: () => void;
  /** Set once a stop is under way. */
  stopped?: Promise<void>;
}

export interface StartPreview {
  projectId: string;
  /** Every repository in the project. */
  repos: string[];
  repo: string;
  number: number;
  title: string;
  config: PreviewConfig;
}

/**
 * Runs pull requests on this machine so the manager can click through them in their own browser. One preview per
 * project: the PR is checked out in data/previews/<project>/<repo>, the repos its commands mention ({dir:<repo>}) at
 * their default branch next to it, and the project's preview command runs there. Its links come from the JSON it prints
 * ({"urls": {...}}), the local URLs in its output, or the free port we offered it.
 */
export class Previews {
  private runs = new Map<string, Run>();

  constructor(
    private readonly hub: Hub,
    private readonly github: GitHubProvider,
    private readonly demo: boolean,
  ) {
    // Commands run in their own process group, so they'd outlive the office unless we take them down with us.
    process.on('exit', () => {
      for (const run of this.runs.values()) run.killNow?.();
    });
  }

  list(): Preview[] {
    return [...this.runs.values()].map((r) => r.preview);
  }

  log(projectId: string): PreviewLog {
    const run = this.runs.get(projectId);
    return run ? { startedAt: run.preview.startedAt, first: run.printed - run.log.length, lines: run.log } : { startedAt: 0, first: 0, lines: [] };
  }

  /** Starts a preview, replacing the project's current one. Returns straight away; progress arrives as `preview` events. */
  async start(req: StartPreview): Promise<Preview> {
    while (this.runs.has(req.projectId)) await this.stop(req.projectId); // a loop: a double click could slip another run in
    const run: Run = {
      preview: {
        projectId: req.projectId,
        repo: req.repo,
        number: req.number,
        title: req.title,
        status: 'starting',
        activity: 'Getting ready',
        links: [],
        startedAt: Date.now(),
      },
      config: req.config,
      repos: req.repos,
      log: [],
      printed: 0,
      pending: [],
      stdout: '',
      checkouts: [],
      unlisted: 0,
    };
    this.runs.set(req.projectId, run);
    this.publish(run);
    const launch = this.demo ? this.launchDemo(run) : this.launch(run);
    void launch.catch((err) => this.fail(run, errorMessage(err)));
    return run.preview;
  }

  /** Kills the start command, runs the stop command, then drops the preview. */
  stop(projectId: string): Promise<void> {
    const run = this.runs.get(projectId);
    if (!run) return Promise.resolve();
    run.stopped ??= this.teardown(run);
    return run.stopped;
  }

  /** A PR was merged or closed: its previews have nothing left to show. */
  closed(repo: string, number: number): void {
    for (const run of this.runs.values()) {
      if (run.preview.repo === repo && run.preview.number === number) void this.stop(run.preview.projectId);
    }
  }

  /** The project is gone: stop its preview and delete its checkouts. */
  async remove(projectId: string): Promise<void> {
    await this.stop(projectId);
    fs.rmSync(path.join(paths.previews, projectId), { recursive: true, force: true });
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  // ---------------------------------------------------------------- running

  private async launch(run: Run): Promise<void> {
    const { projectId, repo, number } = run.preview;
    const cfg = run.config;
    const mentioned = [cfg.command, cfg.stopCommand, cfg.statusCommand].filter(Boolean).join('\n');
    const dirs = new Map<string, string>();
    for (const r of [repo, ...referencedRepos(mentioned, run.repos)]) dirs.set(r, previewDir(projectId, r, run.repos));
    const port = await freePort();
    const expand = (template: string) => expandCommand(template, { port, number, repo, repos: run.repos, dirs });
    run.cwd = dirs.get(repo)!;
    run.checkouts = [...dirs.values()];
    run.env = previewEnv(port, !cfg.command);
    const stopCommand = cfg.stopCommand && expand(cfg.stopCommand);

    // A stack an earlier preview (or a crash) left behind would otherwise be picked up as is, running old code.
    if (stopCommand && [...dirs.values()].every((d) => fs.existsSync(d))) {
      this.update(run, { activity: 'Stopping anything an earlier preview left running' });
      this.print(run, '▸ Making sure nothing from an earlier preview is still running', `$ ${stopCommand}`);
      await this.runCommand(run, stopCommand, STOP_TIMEOUT, (line) => this.print(run, line));
      if (!this.live(run)) return;
    }

    for (const [r, dir] of dirs) {
      const name = shortName(r);
      this.update(run, { activity: r === repo ? `Fetching PR #${number}` : `Fetching ${name}` });
      const branch = r === repo ? undefined : (await this.github.repoInfo(r)).defaultBranch;
      const sha = await checkoutPreview(r, dir, branch ? { branch } : { pr: number });
      if (!this.live(run)) return;
      if (r === repo) this.update(run, { sha });
      run.checkouts.push(fs.realpathSync(dir));
      this.print(run, `▸ ${name}: ${branch ?? `PR #${number}`} @ ${sha.slice(0, 7)} in ${dir}`);
    }

    const command = cfg.command ? expand(cfg.command) : detectCommand(run.cwd);
    if (!command) {
      throw new Error(
        `Don't know how to run ${repo}: there's no package.json with a dev or start script. ` +
          `Set the project's preview command in the Manager's office (Projects).`,
      );
    }
    run.stopCommand = stopCommand || undefined;
    run.statusCommand = cfg.statusCommand ? expand(cfg.statusCommand) : undefined;
    // Only promise a site on our port when the command was told about it; a fixed-port CLI just prints its URLs.
    const offered = !cfg.command || /\{port\}|FOCUS_PREVIEW_PORT/.test(cfg.command);
    this.update(run, { port, command, activity: 'Starting' });
    this.print(run, `$ ${command}`);

    const child = spawnShell(command, run.cwd, run.env);
    const pid = child.pid;
    if (pid) {
      run.kill = () => killTree(pid);
      run.killNow = () => signalTree(pid, 'SIGKILL');
    }
    const onLine = lineSplitter((line) => this.output(run, line));
    child.stdout.on('data', (chunk: Buffer) => {
      run.stdout = (run.stdout + chunk.toString('utf8')).slice(-256_000);
      onLine(chunk);
      this.readResult(run);
    });
    child.stderr.on('data', onLine);
    child.on('error', (err) => this.fail(run, `Couldn't start the command: ${err.message}`));
    onExit(child, (code, signal) => {
      onLine(null);
      this.exited(run, code, signal, offered);
    });
    void this.waitUntilUp(run, offered ? [{ url: `http://localhost:${port}/` }] : []);
  }

  /**
   * Demo mode: pretend to install and start the site(s), which the office serves itself. Multi-repo projects get a
   * stack CLI that prints its URLs as JSON, single-repo ones a Vite dev server.
   */
  private async launchDemo(run: Run): Promise<void> {
    const { repo, number } = run.preview;
    const office = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    const page = (site: string) => `${office}/demo-preview/${repo}/${number}?site=${site}`;
    const stack = run.repos.length > 1;
    const command = stack ? './scripts/stack up' : 'npm install && npm run dev';
    const script: [number, string][] = stack
      ? [
          [400, `▸ ${shortName(repo)}: PR #${number} @ demo`],
          ...run.repos.filter((r) => r !== repo).map((r): [number, string] => [200, `▸ ${shortName(r)}: main @ demo`]),
          [100, `$ ${command}`],
          ...['install', 'database-migrate', 'api-build', 'readiness'].map((phase): [number, string] => [700, JSON.stringify({ status: 'starting', phase })]),
          [400, JSON.stringify({ status: 'ready', urls: { api: page('api'), web: page('web') }, logs: '/demo/.stack/logs', phase: 'running' }, null, 2)],
        ]
      : [
          [400, `▸ ${shortName(repo)}: PR #${number} @ demo`],
          [200, `$ ${command}`],
          [1400, 'added 312 packages, and audited 313 packages in 3s'],
          [300, `> ${shortName(repo)}@0.0.0 dev`],
          [200, '> vite'],
          [900, '  VITE v6.3.5  ready in 412 ms'],
          [100, `  ➜  Local:   ${page('web')}`],
          [50, '  ➜  press h + enter to show help'],
        ];
    let stopped = false;
    run.kill = async () => {
      stopped = true;
    };
    this.update(run, { sha: 'demo', command, activity: 'Starting' });
    void this.waitUntilUp(run, []);
    for (const [delay, text] of script) {
      await sleep(delay);
      if (stopped || !this.live(run)) return;
      if (text.startsWith('{')) {
        // what a JSON-printing CLI's stdout looks like to launch()
        run.stdout += `${text}\n`;
        for (const line of text.split('\n')) this.output(run, line);
        this.readResult(run);
      } else {
        this.output(run, text);
      }
    }
    if (stack) {
      run.detached = true;
      if (run.preview.status === 'running') void this.watch(run);
    }
  }

  private output(run: Run, raw: string): void {
    if (!this.live(run)) return;
    const line = truncate(stripAnsi(raw), 2000);
    this.print(run, line);
    if (run.namedLinks) return;
    const links = [...run.preview.links];
    for (const url of localUrls(line)) {
      const port = new URL(url).port;
      if (links.length < MAX_LINKS && !links.some((l) => new URL(l.url).port === port)) links.push({ url });
    }
    if (links.length !== run.preview.links.length) this.update(run, { links });
  }

  /** Picks up a JSON result or progress line from the start command's stdout. */
  private readResult(run: Run): Record<string, unknown> | null {
    const result = lastJson(run.stdout);
    if (result && this.live(run)) this.apply(run, result, false);
    return result;
  }

  /** Takes links, the logs folder and progress from a command's JSON output (e.g. {"urls": {"web": "http://…"}}). */
  private apply(run: Run, result: Record<string, unknown>, progressOnly: boolean): void {
    const ready = result.status === 'ready' || result.status === 'running';
    if (typeof result.phase === 'string' && result.phase !== run.phase && !ready && run.preview.status === 'starting') {
      run.phase = result.phase;
      this.update(run, { activity: `Starting – ${result.phase}` });
    }
    if (progressOnly) return;
    const links = jsonLinks(result);
    if (links.length && JSON.stringify(links) !== JSON.stringify(run.preview.links)) {
      run.namedLinks = true;
      this.update(run, { links });
    }
    if (typeof result.logs === 'string' && result.logs !== run.preview.logs) this.update(run, { logs: result.logs });
  }

  /**
   * Reads the progress command's JSON (its exit code means nothing: a CLI may exit 1 for "still starting"). That's
   * either our stack, or a list of stacks ({"sessions": [...]}) where ours is the one mentioning our checkouts. A list is
   * the more reliable view: when a stack that was listed drops out while starting, whatever ran it has died.
   */
  private progress(run: Run, stdout: string): void {
    const result = lastJson(stdout);
    if (!result) return;
    const single = typeof result.status === 'string' || typeof result.phase === 'string';
    const list = single ? undefined : Object.values(result).find((v): v is Record<string, unknown>[] => Array.isArray(v) && v.every(isObject));
    if (!list) return this.apply(run, result, true);
    const ours = list.find((stack) => mentions(stack, run.checkouts));
    if (ours) {
      run.listed = true;
      run.unlisted = 0;
      this.apply(run, ours, true);
    } else if (run.listed && ++run.unlisted >= 2) {
      this.fail(run, 'The stack went away while starting: it is no longer in the progress command’s list');
    }
  }

  /** Polls the site(s) until one answers, showing the progress command's progress meanwhile. */
  private async waitUntilUp(run: Run, fallback: PreviewLink[]): Promise<void> {
    const started = Date.now();
    let slow = false;
    let polled = 0;
    let polling = false;
    while (this.live(run) && run.preview.status === 'starting') {
      const candidates = run.preview.links.length ? run.preview.links : fallback;
      for (const { url } of candidates) {
        if (!(await answers(url)) || !this.live(run) || run.preview.status !== 'starting') continue;
        const links = run.preview.links.length ? run.preview.links : [{ url }];
        const names = links.map((l) => l.name).filter(Boolean);
        this.update(run, { status: 'running', links, activity: links.length > 1 ? `Up – ${names.length ? names.join(', ') : `${links.length} sites`}` : `Up at ${links[0].url}` });
        this.print(run, `✔ ${url} is answering`);
        if (run.detached) void this.watch(run);
        return;
      }
      if (run.statusCommand && !polling && Date.now() - polled > 5000) {
        polling = true;
        polled = Date.now();
        void this.runCommand(run, run.statusCommand, 30_000).then(({ stdout }) => {
          polling = false;
          if (this.live(run) && run.preview.status === 'starting') this.progress(run, stdout);
        });
      }
      if (!slow && !run.phase && Date.now() - started > 90_000) {
        slow = true;
        this.update(run, { activity: candidates.length ? 'Still waiting for the site to answer – check the log' : 'Waiting for the command to report its URLs' });
      }
      await sleep(1000);
    }
  }

  /** The command is gone but its sites live on: notice when they stop answering. */
  private async watch(run: Run): Promise<void> {
    if (run.watching) return;
    run.watching = true;
    let misses = 0;
    while (this.live(run) && run.preview.status === 'running') {
      await sleep(10_000);
      if (!this.live(run) || run.preview.status !== 'running') return;
      const up = (await Promise.all(run.preview.links.map((l) => answers(l.url)))).some(Boolean);
      misses = up ? 0 : misses + 1;
      if (misses >= 3) this.fail(run, 'The site stopped answering');
    }
  }

  private exited(run: Run, code: number | null, signal: NodeJS.Signals | null, offered: boolean): void {
    if (!this.live(run) || run.preview.status === 'failed') return;
    const result = this.readResult(run);
    const failed = typeof result?.status === 'string' && ['failed', 'error', 'stopped'].includes(result.status);
    if (code === 0 && !failed && (run.preview.links.length || offered)) {
      // e.g. a CLI that starts the sites in the background and returns
      run.detached = true;
      this.print(run, '▸ The command finished; the sites keep running on their own');
      if (run.preview.status === 'running') void this.watch(run);
      return;
    }
    const reason = typeof result?.error === 'string' && result.error ? result.error : undefined;
    this.fail(run, reason ?? (signal ? `The command was killed (${signal})` : code === 0 ? 'The command finished without reporting a site' : `The command exited with code ${code}`));
  }

  private fail(run: Run, message: string): void {
    if (!this.live(run) || run.preview.status === 'failed') return;
    this.print(run, `✘ ${message}`);
    this.update(run, { status: 'failed', error: message, activity: truncate(message, 160) });
    void run.kill?.();
  }

  private async teardown(run: Run): Promise<void> {
    this.update(run, { status: 'stopping', activity: 'Stopping' });
    await run.kill?.();
    if (run.stopCommand) {
      this.print(run, `$ ${run.stopCommand}`);
      const { code } = await this.runCommand(run, run.stopCommand, STOP_TIMEOUT, (line) => this.print(run, line));
      if (code !== 0) console.warn(`  ⚠ Preview stop command for ${run.preview.repo}#${run.preview.number} exited with ${code}: ${run.stopCommand}`);
    }
    if (!this.owns(run)) return;
    this.runs.delete(run.preview.projectId);
    clearTimeout(run.flush);
    this.hub.send({ type: 'preview', projectId: run.preview.projectId, preview: null });
  }

  /** Runs a stop or status command to the end. Never rejects. */
  private runCommand(run: Run, command: string, timeoutMs: number, onLine?: (line: string) => void): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      const child = spawnShell(command, run.cwd, run.env);
      const lines = lineSplitter((line) => onLine?.(truncate(stripAnsi(line), 2000)));
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString('utf8')).slice(-256_000);
        lines(chunk);
      });
      child.stderr.on('data', lines);
      const timer = setTimeout(() => child.pid && signalTree(child.pid, 'SIGKILL'), timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        resolve({ code: null, stdout });
      });
      onExit(child, (code) => {
        clearTimeout(timer);
        lines(null);
        resolve({ code, stdout });
      });
    });
  }

  // ---------------------------------------------------------------- plumbing

  /** Still the project's preview (maybe on its way out). */
  private owns(run: Run): boolean {
    return this.runs.get(run.preview.projectId) === run;
  }

  /** Still the project's preview and not being stopped. */
  private live(run: Run): boolean {
    return this.owns(run) && !run.stopped;
  }

  private update(run: Run, patch: Partial<Preview>): void {
    Object.assign(run.preview, patch);
    if (this.owns(run)) this.publish(run);
  }

  private publish(run: Run): void {
    this.hub.send({ type: 'preview', projectId: run.preview.projectId, preview: run.preview });
  }

  private print(run: Run, ...lines: string[]): void {
    run.log.push(...lines);
    if (run.log.length > LOG_LINES) run.log.splice(0, run.log.length - LOG_LINES);
    run.printed += lines.length;
    run.pending.push(...lines);
    run.flush ??= setTimeout(() => {
      run.flush = undefined;
      if (!this.owns(run)) return;
      const lines = run.pending.splice(0);
      this.hub.send({ type: 'preview-log', projectId: run.preview.projectId, log: { startedAt: run.preview.startedAt, first: run.printed - lines.length, lines } });
    }, 150);
  }
}

// ---------------------------------------------------------------- commands

const shortName = (repo: string) => repo.split('/')[1] ?? repo;

/** data/previews/<project>/<repo name>, or <owner>__<name> when two repos in the project share a name. */
function previewDir(projectId: string, repo: string, repos: string[]): string {
  const clash = repos.some((r) => r !== repo && shortName(r).toLowerCase() === shortName(repo).toLowerCase());
  return path.join(paths.previews, projectId, clash ? repo.replace('/', '__') : shortName(repo));
}

/** Finds the repo a {dir:<name>} placeholder means, by owner/name or just name. */
function resolveRepo(name: string, repos: string[]): string {
  const wanted = name.trim().toLowerCase();
  const exact = repos.find((r) => r.toLowerCase() === wanted);
  if (exact) return exact;
  const byName = repos.filter((r) => shortName(r).toLowerCase() === wanted);
  if (byName.length === 1) return byName[0];
  throw new Error(
    byName.length
      ? `{dir:${name}} could mean ${byName.join(' or ')} – use owner/name`
      : `{dir:${name}} isn't a repository in this project (${repos.map(shortName).join(', ')})`,
  );
}

function referencedRepos(text: string, repos: string[]): string[] {
  return [...new Set([...text.matchAll(/\{dir:([^}]+)\}/g)].map((m) => resolveRepo(m[1], repos)))];
}

function expandCommand(template: string, ctx: { port: number; number: number; repo: string; repos: string[]; dirs: Map<string, string> }): string {
  return template.replace(/\{(port|pr|repo|dir)(?::([^}]+))?\}/g, (whole, key: string, arg?: string) => {
    if (key === 'dir') return shellQuote(ctx.dirs.get(arg ? resolveRepo(arg, ctx.repos) : ctx.repo)!);
    if (arg) return whole;
    return key === 'port' ? String(ctx.port) : key === 'pr' ? String(ctx.number) : ctx.repo;
  });
}

function shellQuote(value: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(value)) return value;
  return WINDOWS ? `"${value}"` : `'${value.replace(/'/g, `'\\''`)}'`;
}

function previewEnv(port: number, auto: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FOCUS_PREVIEW_PORT: String(port), BROWSER: 'none', NO_COLOR: '1', FORCE_COLOR: '0' };
  // The office's own PORT/HOST must not leak into the site. Auto-detected Node apps get PORT (Next, Express, CRA…);
  // a project's own command doesn't, so a CLI starting several sites doesn't hand them all one port.
  delete env.PORT;
  delete env.HOST;
  if (auto) env.PORT = String(port);
  return env;
}

/**
 * A shell on purpose: preview commands are the manager's own command lines (npm.cmd on Windows, `&&`, a project CLI).
 * Detached on POSIX so the whole process group can be killed.
 */
function spawnShell(command: string, cwd: string | undefined, env: NodeJS.ProcessEnv | undefined) {
  return spawn(command, { cwd, env, shell: true, detached: !WINDOWS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Calls back once the process has exited and its output drained, without waiting on pipes a background child keeps open. */
function onExit(child: ReturnType<typeof spawnShell>, done: (code: number | null, signal: NodeJS.Signals | null) => void): void {
  child.on('exit', (code, signal) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      done(code, signal);
    };
    child.once('close', settle);
    setTimeout(settle, 500);
  });
}

/** The repo's own way of running itself: install, then its dev (or start) script. */
function detectCommand(dir: string): string | null {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as typeof pkg;
  } catch {
    return null;
  }
  const script = ['dev', 'start', 'serve', 'preview'].find((s) => pkg.scripts?.[s]);
  if (!script) return null;
  const has = (file: string) => fs.existsSync(path.join(dir, file));
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
  return `${pm} install && ${pm} run ${script}`;
}

// ---------------------------------------------------------------- output

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}(?:\/[^\s'"<>`]*)?/gi;

/** Something a browser can open: 0.0.0.0 and [::] become localhost. */
function browsable(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (['0.0.0.0', '[::]', '[::1]'].includes(url.hostname)) url.hostname = 'localhost';
    return url.href;
  } catch {
    return null;
  }
}

/** Local http(s) URLs in a line of output. */
export function localUrls(line: string): string[] {
  return (line.match(LOCAL_URL) ?? []).map((m) => browsable(m.replace(/[.,;:!?)\]]+$/, ''))).filter((u): u is string => !!u);
}

/** Links from a JSON result: {"urls": {"web": "http://…"}}, {"urls": ["http://…"]} or {"url": "http://…"}. */
function jsonLinks(result: Record<string, unknown>): PreviewLink[] {
  const raw = result.urls ?? result.url;
  const entries: [string | undefined, unknown][] =
    typeof raw === 'string' ? [[undefined, raw]]
      : Array.isArray(raw) ? raw.map((u): [undefined, unknown] => [undefined, u])
        : raw && typeof raw === 'object' ? Object.entries(raw)
          : [];
  const links = entries.flatMap(([name, value]): PreviewLink[] => {
    const url = typeof value === 'string' ? browsable(value) : null;
    return url ? [name ? { name, url } : { url }] : [];
  });
  // stable: people open the web front ends, so APIs, databases and docs go last
  const rank = (l: PreviewLink) => (l.name && BACKSTAGE.test(l.name) ? 1 : 0);
  return links.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_LINKS);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether any string in the JSON value is one of the paths (ignoring a trailing separator). */
function mentions(value: unknown, dirs: string[]): boolean {
  if (typeof value === 'string') return dirs.includes(value.replace(/[\\/]+$/, ''));
  if (Array.isArray(value)) return value.some((v) => mentions(v, dirs));
  return isObject(value) && Object.values(value).some((v) => mentions(v, dirs));
}

/** The last JSON object a command printed: all of stdout, a pretty-printed object at the end, or the last JSON line. */
function lastJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.endsWith('}')) return null;
  const candidates = [t];
  const lines = t.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0 && candidates.length < 40; i--) {
    if (lines[i].startsWith('{')) candidates.push(lines.slice(i).join('\n'));
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isObject(value)) return value;
    } catch {
      // keep looking
    }
  }
  return null;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** Turns stdout/stderr chunks into lines; pass null at the end to flush the last partial line. */
function lineSplitter(onLine: (line: string) => void): (chunk: Buffer | null) => void {
  let partial = '';
  return (chunk) => {
    if (chunk === null) {
      if (partial) onLine(partial);
      partial = '';
      return;
    }
    const parts = (partial + chunk.toString('utf8')).split(/\r\n|\n|\r/);
    partial = parts.pop() ?? '';
    for (const line of parts) onLine(line);
  };
}

// ---------------------------------------------------------------- processes and ports

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** True when anything at all answers HTTP there (a 404 or a 500 still means the server is up). */
function answers(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (res: http.IncomingMessage) => {
      res.resume();
      resolve(true);
    };
    const req = url.startsWith('https:')
      ? https.get(url, { timeout: 2000, rejectUnauthorized: false }, done) // local dev certificates are self-signed
      : http.get(url, { timeout: 2000 }, done);
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/** Signals the command and everything it started. False once nothing is left. */
function signalTree(pid: number, signal: NodeJS.Signals | 0): boolean {
  if (WINDOWS) {
    if (signal !== 0) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return false;
  }
  try {
    process.kill(-pid, signal); // negative pid: the whole process group
    return true;
  } catch {
    return false;
  }
}

async function killTree(pid: number): Promise<void> {
  if (!signalTree(pid, 'SIGTERM')) return;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    if (!signalTree(pid, 0)) return;
  }
  signalTree(pid, 'SIGKILL');
}

/** Stand-in "site" for demo previews. */
export function demoPreviewPage(repo: string, number: number, title: string, site: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(site)} · ${esc(repo)} #${number}</title>
<style>body{font:18px system-ui,sans-serif;margin:0;background:#fff8e7;color:#1b1b1b}header{background:#ff8a5b;padding:18px 28px;border-bottom:4px solid #1b1b1b;font-weight:700}
main{max-width:720px;margin:48px auto;padding:0 24px}.card{background:#fff;border:3px solid #1b1b1b;border-radius:18px;box-shadow:6px 6px 0 #1b1b1b;padding:24px}</style></head>
<body><header>${esc(site)} · ${esc(repo)} · preview of PR #${number}</header><main><div class="card"><h1>${esc(title)}</h1>
<p>This is where the pull request's site would run. In live mode, ▶ Preview checks the PR out and runs the project's preview command (or the repo's dev server), and this tab shows the real thing.</p></div></main></body></html>`;
}
