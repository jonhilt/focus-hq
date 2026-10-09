import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Clock, Data, Effect, Exit, ManagedRuntime, Schedule, Scope, type Duration } from 'effect';
import { previewIncludes } from '../shared/previewSet';
import type { Preview, PreviewCheckout, PreviewConfig, PreviewLink, PreviewLog, PreviewLogFile, PreviewRef, PreviewSet } from '../shared/types';
import { config, paths } from './config';
import type { GitHubProvider } from './github/provider';
import type { Hub } from './hub';
import { packageManagerIn } from './packageManager';
import { CheckoutFailed, type CommandNotStarted, PreviewMachine, type ShellProcess } from './previewMachine';
import { errorMessage, truncate } from './util';

const LOG_LINES = 600;
const MAX_LINKS = 8;
const WINDOWS = process.platform === 'win32';
/** Named links like these go after the ones a person opens first (web before api). */
const BACKSTAGE = /api|backend|server|db|database|postgres|swagger|docs|health|metrics/i;
const STOP_TIMEOUT: Duration.Input = '5 minutes';
const STATUS_TIMEOUT: Duration.Input = '30 seconds';
/** A running stack's own status that's worth a warning (anything else, e.g. "ready" or "ok", clears it). */
const TROUBLED = /unhealthy|stale|fail|error|degraded|down|stopped|dead|crash/i;
/** How much of a log file the panel gets. */
const LOG_TAIL = 200_000;
/** After a start command exits unhappily, how long its sites get to answer anyway. */
const GRACE: Duration.Input = '30 seconds';
/** Between SIGTERM and SIGKILL. */
const KILL_GRACE: Duration.Input = '5 seconds';

export class CommandTimedOut extends Data.TaggedError('CommandTimedOut')<{ what: string; timeout: Duration.Input }> {
  override get message() {
    return `The ${this.what} timed out after ${String(this.timeout)}`;
  }
}

export class NoPreviewCommand extends Data.TaggedError('NoPreviewCommand')<{ repo: string }> {
  override get message() {
    return (
      `Don't know how to run ${this.repo}: there's no package.json with a dev or start script. ` +
      `Set the project's preview command in the ready room (Projects).`
    );
  }
}

/** A {dir:<name>} placeholder that names no repository in the project, or more than one. */
export class BadDirPlaceholder extends Data.TaggedError('BadDirPlaceholder')<{ name: string; matches: string[]; repos: string[] }> {
  override get message() {
    return this.matches.length
      ? `{dir:${this.name}} could mean ${this.matches.join(' or ')} – use owner/name`
      : `{dir:${this.name}} isn't a repository in this project (${this.repos.map(shortName).join(', ')})`;
  }
}

type LaunchError = CommandNotStarted | CheckoutFailed | NoPreviewCommand | BadDirPlaceholder;

interface Run {
  preview: Preview;
  config: PreviewConfig;
  /** Every repository in the project, for {dir:<repo>}. */
  repos: string[];
  /**
   * Everything the preview has running: the start command's process tree, its polling and the log flush. Closing it
   * runs the stop command and kills the tree.
   */
  scope: Scope.Closeable;
  /** Closes `scope`, once; anyone else waits for that. */
  down: Effect.Effect<void>;
  log: string[];
  /** Lines printed so far, including ones trimmed from `log`. */
  printed: number;
  pending: string[];
  /** Tail of the start command's stdout, for a JSON result. */
  stdout: string;
  /** The start command's JSON result named the links; stop guessing them from URLs in its output. */
  namedLinks?: boolean;
  phase?: string;
  /** The start command exited and left the site(s) running on their own. */
  detached?: boolean;
  watching?: boolean;
  /** Why the preview is up but not happily (shown as its warning once a site answers). */
  complaint?: string;
  /** Every checkout of this preview, as given and with symlinks resolved, to find our stack in a list of stacks. */
  paths: string[];
  /** Our stack showed up in the progress command's list of stacks; how many polls since it went missing. */
  listed?: boolean;
  unlisted: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  statusCommand?: string;
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
  /** What each repo runs; `repo` at `number`. */
  set: PreviewSet;
  config: PreviewConfig;
}

/**
 * Runs pull requests on this machine so the manager can click through them in their own browser. One preview per
 * project: the PR is checked out in data/previews/<project>/<repo>, the repos its commands mention ({dir:<repo>}) next to
 * it, each at its PR from the preview's set or else its default branch, and the project's preview command runs there. Its links come from the JSON it prints
 * ({"urls": {...}}), the local URLs in its output, or the free port we offered it.
 *
 * Promise-based outside, Effect inside: each preview's lifetime is a `Scope`, run on this one runtime.
 */
export class Previews {
  private runs = new Map<string, Run>();

  constructor(
    private readonly hub: Hub,
    private readonly github: GitHubProvider,
    private readonly demo: boolean,
    private readonly runtime: ManagedRuntime.ManagedRuntime<PreviewMachine, never> = ManagedRuntime.make(PreviewMachine.layer),
  ) {}

  list(): Preview[] {
    return [...this.runs.values()].map((r) => r.preview);
  }

  log(projectId: string): PreviewLog {
    const run = this.runs.get(projectId);
    return run ? { startedAt: run.preview.startedAt, first: run.printed - run.log.length, lines: run.log } : { startedAt: 0, first: 0, lines: [] };
  }

  /** The files in the folder (or the file) the command reported as "logs" – *.log ones if there are any. */
  logFiles(projectId: string): PreviewLogFile[] {
    const where = this.logsPath(projectId);
    if (!where) return [];
    try {
      const stat = fs.statSync(where);
      if (stat.isFile()) return [{ name: path.basename(where), size: stat.size, modified: stat.mtimeMs }];
      const files = fs.readdirSync(where, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.'));
      const logs = files.filter((e) => /\.(log|txt|out|err)$/i.test(e.name));
      return (logs.length ? logs : files)
        .map((e) => {
          const st = fs.statSync(path.join(where, e.name));
          return { name: e.name, size: st.size, modified: st.mtimeMs };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /** The end of one of logFiles(). */
  logFile(projectId: string, name: string): { name: string; text: string; truncated: boolean } {
    const where = this.logsPath(projectId);
    if (!where || !this.logFiles(projectId).some((f) => f.name === name)) throw new Error(`There's no log file called ${name}`);
    const file = fs.statSync(where).isFile() ? where : path.join(where, name);
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - LOG_TAIL);
    const buffer = Buffer.alloc(size - start);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      fs.closeSync(fd);
    }
    return { name, text: stripAnsi(buffer.toString('utf8')), truncated: start > 0 };
  }

  private logsPath(projectId: string): string | undefined {
    const run = this.runs.get(projectId);
    return run?.preview.logs ? path.resolve(run.cwd ?? '', run.preview.logs) : undefined;
  }

  /** Starts a preview, replacing the project's current one. Returns straight away; progress arrives as `preview` events. */
  async start(req: StartPreview): Promise<Preview> {
    while (this.runs.has(req.projectId)) await this.stop(req.projectId); // a loop: a double click could slip another run in
    const scope = Scope.makeUnsafe();
    const run: Run = {
      preview: {
        projectId: req.projectId,
        repo: req.repo,
        number: req.number,
        title: req.title,
        set: req.set,
        checkouts: [],
        status: 'starting',
        activity: 'Getting ready',
        links: [],
        startedAt: this.runtime.runSync(Clock.currentTimeMillis),
      },
      config: req.config,
      repos: req.repos,
      scope,
      down: this.runtime.runSync(Effect.cached(Scope.close(scope, Exit.void))),
      log: [],
      printed: 0,
      pending: [],
      stdout: '',
      paths: [],
      unlisted: 0,
    };
    this.runs.set(req.projectId, run);
    this.publish(run);
    // forked first, so closing the scope stops it last: the stop command's output still reaches the panel
    const flush = Effect.sync(() => this.flush(run));
    this.background(run, flush.pipe(Effect.repeat(Schedule.spaced('150 millis')), Effect.ensuring(flush)));
    this.background(
      run,
      (this.demo ? this.launchDemo(run) : this.launch(run)).pipe(
        Effect.catch((err) => Effect.sync(() => this.fail(run, err.message))),
        // a bug shouldn't leave the preview "starting" forever
        Effect.catchDefect((defect) => Effect.sync(() => this.fail(run, errorMessage(defect)))),
      ),
    );
    return run.preview;
  }

  /** Runs the stop command, kills what's left of the start command, then drops the preview. */
  stop(projectId: string): Promise<void> {
    const run = this.runs.get(projectId);
    if (!run) return Promise.resolve();
    run.stopped ??= this.runtime.runPromise(this.teardown(run));
    return run.stopped;
  }

  /** A PR was merged or closed: the previews checking it out (with other PRs or not) have nothing left to show. */
  closed(repo: string, number: number): void {
    for (const run of this.runs.values()) {
      if (previewIncludes(run.preview, repo, number)) void this.stop(run.preview.projectId);
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

  private launch(run: Run): Effect.Effect<void, LaunchError, PreviewMachine> {
    return Effect.gen({ self: this }, function* () {
      const machine = yield* PreviewMachine;
      const { projectId, repo, number } = run.preview;
      const cfg = run.config;
      const mentioned = [cfg.command, cfg.stopCommand, cfg.statusCommand].filter(Boolean).join('\n');
      const dirs = new Map<string, string>();
      for (const r of [repo, ...(yield* referencedRepos(mentioned, run.repos))]) dirs.set(r, previewDir(projectId, r, run.repos));
      const refs = yield* Effect.forEach(
        [...dirs.keys()],
        (r): Effect.Effect<PreviewCheckout, CheckoutFailed> => {
          const pr = r === repo ? number : run.preview.set[r];
          if (pr != null) return Effect.succeed({ repo: r, ref: { pr } });
          return Effect.tryPromise({
            try: () => this.github.repoInfo(r),
            catch: (err) => new CheckoutFailed({ repo: r, reason: errorMessage(err) }),
          }).pipe(Effect.map((info) => ({ repo: r, ref: { branch: info.defaultBranch } })));
        },
        { concurrency: 'unbounded' },
      );
      this.update(run, { checkouts: refs });
      const port = yield* machine.freePort;
      const expand = (template: string) => expandCommand(template, { port, number, repo, repos: run.repos, dirs });
      run.cwd = dirs.get(repo)!;
      run.paths = [...dirs.values()];
      run.env = previewEnv(port, !cfg.command);
      const stopCommand = cfg.stopCommand ? expand(cfg.stopCommand) : undefined;

      // A stack an earlier preview (or a crash) left behind would otherwise be picked up as is, running old code.
      if (stopCommand && [...dirs.values()].every((d) => fs.existsSync(d))) {
        this.update(run, { activity: 'Stopping anything an earlier preview left running' });
        this.print(run, '▸ Making sure nothing from an earlier preview is still running', `$ ${stopCommand}`);
        yield* this.runCommand(run, 'stop command', stopCommand, STOP_TIMEOUT, (line) => this.print(run, line)).pipe(
          Effect.catch((err) => Effect.sync(() => this.print(run, `⚠ ${err.message}`))),
        );
      }

      for (const { repo: r, ref } of refs) {
        const dir = dirs.get(r)!;
        this.update(run, { activity: `Fetching ${shortName(r)} ${refName(ref)}` });
        const checkout = yield* machine.checkout(r, dir, ref);
        this.checkedOut(run, r, checkout.sha);
        run.paths.push(checkout.path);
        this.print(run, `${checkoutLine(r, ref, checkout.sha)} in ${dir}`);
      }

      const command = cfg.command ? expand(cfg.command) : detectCommand(run.cwd);
      if (!command) return yield* new NoPreviewCommand({ repo });
      run.statusCommand = cfg.statusCommand ? expand(cfg.statusCommand) : undefined;
      // Only promise a site on our port when the command was told about it; a fixed-port CLI just prints its URLs.
      const offered = !cfg.command || /\{port\}|FOCUS_PREVIEW_PORT/.test(cfg.command);
      this.update(run, { port, command, activity: 'Starting' });
      this.print(run, `$ ${command}`);

      const onLine = lineSplitter((line) => this.output(run, line));
      const child = yield* this.spawn(run, command, {
        onStdout: (chunk) => {
          run.stdout = (run.stdout + chunk.toString('utf8')).slice(-256_000);
          onLine(chunk);
          this.readResult(run);
        },
        onStderr: onLine,
        // The stop command first (the CLI knows how to take its own stack down, and its supervisor may share the start
        // command's process group), then whatever is left of the start command's process tree.
        release: (proc) => Effect.andThen(this.runStopCommand(run, stopCommand), killTree(proc)),
      }).pipe(Scope.provide(run.scope));
      this.background(run, this.waitUntilUp(run, offered ? [{ url: `http://localhost:${port}/` }] : []));
      const { code, signal } = yield* child.exited;
      onLine(null);
      this.exited(run, code, signal, offered);
    });
  }

  /**
   * Demo mode: pretend to install and start the site(s), which the office serves itself. Multi-repo projects get a
   * stack CLI that prints its URLs as JSON, single-repo ones a Vite dev server.
   */
  private launchDemo(run: Run): Effect.Effect<void, CheckoutFailed, PreviewMachine> {
    return Effect.gen({ self: this }, function* () {
      const { repo, number } = run.preview;
      const office = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
      const page = (site: string) => `${office}/demo-preview/${repo}/${number}?site=${site}`;
      const stack = run.repos.length > 1;
      const unhealthy = stack && /api/.test(repo); // shows off a stack that's up but not happy
      const logs = stack ? demoLogs(run.preview.projectId, unhealthy) : undefined;
      const command = stack ? './scripts/stack up' : 'npm install && npm run dev';
      // a stack uses every repo of the project, the dev server only the PR's
      const checkouts = (stack ? [repo, ...run.repos.filter((r) => r !== repo)] : [repo]).map((r): PreviewCheckout => {
        const pr = r === repo ? number : run.preview.set[r];
        return { repo: r, ref: pr != null ? { pr } : { branch: 'main' } };
      });
      this.update(run, { checkouts });
      const shas = yield* Effect.forEach(
        checkouts,
        ({ repo: r, ref }) =>
          'pr' in ref
            ? Effect.tryPromise({
                try: async () => (await this.github.getPullRequest(r, ref.pr)).headSha,
                catch: (err) => new CheckoutFailed({ repo: r, reason: errorMessage(err) }),
              })
            : Effect.succeed('demo'),
        { concurrency: 'unbounded' },
      );
      const fetched = checkouts.map((c, i): [number, () => void] => [stack ? 300 : 400, () => {
        this.checkedOut(run, c.repo, shas[i]);
        this.output(run, checkoutLine(c.repo, c.ref, shas[i]));
      }]);
      const script: [number, string | (() => void)][] = stack
        ? [
            ...fetched,
            [100, `$ ${command}`],
            ...['install', 'database-migrate', 'api-build', 'readiness'].map((phase): [number, string] => [700, JSON.stringify({ status: 'starting', phase })]),
            [400, JSON.stringify({ status: unhealthy ? 'unhealthy' : 'ready', urls: { api: page('api'), web: page('web') }, logs, phase: 'running' }, null, 2)],
          ]
        : [
            ...fetched,
            [200, `$ ${command}`],
            [1400, 'added 312 packages, and audited 313 packages in 3s'],
            [300, `> ${shortName(repo)}@0.0.0 dev`],
            [200, '> vite'],
            [900, '  VITE v6.3.5  ready in 412 ms'],
            [100, `  ➜  Local:   ${page('web')}`],
            [50, '  ➜  press h + enter to show help'],
          ];
      this.update(run, { command, activity: 'Starting' });
      this.background(run, this.waitUntilUp(run, []));
      for (const [delay, text] of script) {
        yield* Effect.sleep(delay);
        if (typeof text === 'function') {
          text();
        } else if (text.startsWith('{')) {
          // what a JSON-printing CLI's stdout looks like to launch()
          run.stdout += `${text}\n`;
          for (const line of text.split('\n')) this.output(run, line);
          this.readResult(run);
        } else {
          this.output(run, text);
        }
      }
      if (stack) this.exited(run, unhealthy ? 1 : 0, null, false);
    });
  }

  /** Records the commit a repo's checkout landed on. */
  private checkedOut(run: Run, repo: string, sha: string): void {
    const checkouts = run.preview.checkouts.map((c) => (c.repo === repo ? { ...c, sha } : c));
    this.update(run, repo === run.preview.repo ? { checkouts, sha } : { checkouts });
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
   * Finds our stack in the progress command's JSON (its exit code means nothing: a CLI may exit 1 for "still
   * starting"). That's either our stack, or a list of stacks ({"sessions": [...]}) where ours is the one mentioning our
   * checkouts. A list is the more reliable view: when a stack that was listed drops out twice in a row, whatever ran it
   * has died ("gone").
   */
  private ourStack(run: Run, stdout: string): Record<string, unknown> | 'gone' | undefined {
    const result = lastJson(stdout);
    if (!result) return undefined;
    const single = typeof result.status === 'string' || typeof result.phase === 'string';
    const list = single ? undefined : Object.values(result).find((v): v is Record<string, unknown>[] => Array.isArray(v) && v.every(isObject));
    if (!list) return result;
    const ours = list.find((stack) => mentions(stack, run.paths));
    if (ours) {
      run.listed = true;
      run.unlisted = 0;
      return ours;
    }
    return run.listed && ++run.unlisted >= 2 ? 'gone' : undefined;
  }

  /** The progress command's view of our stack; nothing when it fails or times out (the next poll tries again). */
  private progress(run: Run, statusCommand: string): Effect.Effect<Record<string, unknown> | 'gone' | undefined, never, PreviewMachine> {
    return this.runCommand(run, 'progress command', statusCommand, STATUS_TIMEOUT).pipe(
      Effect.map(({ stdout }) => this.ourStack(run, stdout)),
      Effect.orElseSucceed(() => undefined),
    );
  }

  /** Polls the site(s) until one answers, showing the progress command's progress meanwhile. */
  private waitUntilUp(run: Run, fallback: PreviewLink[]): Effect.Effect<void, never, PreviewMachine> {
    const starting = () => this.live(run) && run.preview.status === 'starting';
    return Effect.gen({ self: this }, function* () {
      const machine = yield* PreviewMachine;
      const { statusCommand } = run;
      if (statusCommand) {
        const poll = this.progress(run, statusCommand).pipe(
          Effect.map((stack) => {
            if (!starting()) return;
            if (stack === 'gone') this.fail(run, 'The stack went away while starting: it is no longer in the progress command’s list');
            else if (stack) this.apply(run, stack, true);
          }),
        );
        yield* Effect.forkChild(poll.pipe(Effect.repeat(Schedule.spaced('5 seconds'))));
      }
      const slow = Effect.sync(() => {
        if (!starting() || run.phase) return;
        const waiting = run.preview.links.length || fallback.length;
        this.update(run, { activity: waiting ? 'Still waiting for the site to answer – check the log' : 'Waiting for the command to report its URLs' });
      });
      yield* Effect.forkChild(Effect.delay(slow, '90 seconds'));

      /** True once a site answers. */
      const answered = Effect.gen({ self: this }, function* () {
        const candidates = run.preview.links.length ? run.preview.links : fallback;
        for (const { url } of candidates) {
          if ((yield* machine.probe(url)) === null || !starting()) continue;
          const links = yield* checkLinks(run.preview.links.length ? run.preview.links : [{ url }]);
          if (!starting()) return true;
          const names = links.map((l) => l.name).filter(Boolean);
          const activity = links.length > 1 ? `Up – ${names.length ? names.join(', ') : `${links.length} sites`}` : `Up at ${links[0].url}`;
          this.update(run, { status: 'running', links, activity, warning: run.complaint });
          this.print(run, `✔ ${url} is answering`);
          this.watch(run);
          return true;
        }
        return false;
      });
      yield* answered.pipe(Effect.repeat({ schedule: Schedule.spaced('1 second'), until: (up) => up || !starting() }));
    });
  }

  /**
   * Keeps an eye on a running preview: each link's health, and (with a progress command) the stack's own verdict, so
   * the warning follows it ("unhealthy", back to "ready"). When the command has exited, nothing else would notice the
   * sites going away: three checks with no answer, or the stack dropping out of the progress command's list, fail it.
   */
  private watch(run: Run): void {
    if (run.watching) return;
    run.watching = true;
    const running = () => this.live(run) && run.preview.status === 'running';
    let misses = 0;
    /** False once there's nothing left to watch. */
    const check = Effect.gen({ self: this }, function* () {
      if (!running()) return false;
      const links = yield* checkLinks(run.preview.links);
      if (!running()) return false;
      if (JSON.stringify(links) !== JSON.stringify(run.preview.links)) this.update(run, { links });
      misses = links.some((l) => l.health !== 'down') ? 0 : misses + 1;
      if (run.detached && misses >= 3) {
        this.fail(run, 'The site stopped answering');
        return false;
      }
      if (!run.statusCommand) return true;
      const stack = yield* this.progress(run, run.statusCommand);
      if (!running()) return false;
      if (stack === 'gone') {
        this.fail(run, 'The stack went away: it is no longer in the progress command’s list');
        return false;
      }
      if (stack && typeof stack.status === 'string') {
        const error = typeof stack.error === 'string' && stack.error ? `: ${stack.error}` : '';
        run.complaint = TROUBLED.test(stack.status) ? `The stack reports itself as ${stack.status}${error}` : undefined;
        if (run.complaint !== run.preview.warning) this.update(run, { warning: run.complaint });
      }
      return true;
    });
    const every = Schedule.spaced('10 seconds');
    this.background(run, Effect.delay(check, '10 seconds').pipe(Effect.repeat({ schedule: every, while: (more) => more })));
  }

  private exited(run: Run, code: number | null, signal: NodeJS.Signals | null, offered: boolean): void {
    if (!this.live(run) || run.preview.status === 'failed') return;
    const result = this.readResult(run);
    const status = typeof result?.status === 'string' ? result.status : undefined;
    const reported = typeof result?.error === 'string' && result.error ? result.error : undefined;
    const gaveUp = !!status && ['failed', 'error', 'stopped'].includes(status);
    if (code === 0 && !gaveUp && (run.preview.links.length || offered)) {
      // e.g. a CLI that starts the sites in the background and returns
      run.detached = true;
      this.print(run, '▸ The command finished; the sites keep running on their own');
      if (run.preview.status === 'running') this.watch(run);
      return;
    }
    if (code !== 0 && !signal && !gaveUp && run.namedLinks) {
      // A stack CLI that brought its sites up but didn't like what it saw (e.g. "unhealthy"): they may be worth a look.
      run.detached = true;
      const complaint = `The command exited with code ${code}${status ? ` and reported the stack as ${status}` : ''}${reported ? `: ${reported}` : ''}`;
      run.complaint = complaint;
      if (run.preview.status === 'running') {
        this.print(run, `⚠ ${complaint}`);
        this.update(run, { warning: complaint });
        this.watch(run);
      } else {
        this.print(run, `⚠ ${complaint}. Checking whether its sites answer anyway…`);
        const giveUp = Effect.sync(() => {
          if (run.preview.status === 'starting') this.fail(run, `${complaint}, and none of its sites answer`);
        });
        this.background(run, Effect.delay(giveUp, GRACE));
      }
      return;
    }
    const what = signal ? `was killed (${signal})` : code === 0 ? 'finished without reporting a site' : `exited with code ${code}`;
    this.fail(run, reported ?? `The command ${what}${status ? ` (status "${status}")` : ''}`);
  }

  /** Marks the preview failed and takes down what it left running; its output and logs stay on screen. */
  private fail(run: Run, message: string): void {
    if (!this.live(run) || run.preview.status === 'failed') return;
    this.print(run, `✘ ${message}`);
    this.update(run, { status: 'failed', error: message, activity: truncate(message, 160) });
    this.runtime.runFork(run.down);
  }

  private teardown(run: Run): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (run.preview.status !== 'failed') this.update(run, { status: 'stopping', activity: 'Stopping' });
      yield* run.down;
      if (!this.owns(run)) return;
      this.runs.delete(run.preview.projectId);
      this.hub.send({ type: 'preview', projectId: run.preview.projectId, preview: null });
    });
  }

  /** The stop command, on the way down. A failing one only gets a warning: the process tree gets killed regardless. */
  private runStopCommand(run: Run, stopCommand: string | undefined): Effect.Effect<void, never, PreviewMachine> {
    if (!stopCommand) return Effect.void;
    const label = `Preview stop command for ${run.preview.repo}#${run.preview.number}`;
    return Effect.gen({ self: this }, function* () {
      this.print(run, `$ ${stopCommand}`);
      const { code } = yield* this.runCommand(run, 'stop command', stopCommand, STOP_TIMEOUT, (line) => this.print(run, line));
      if (code !== 0) console.warn(`  ⚠ ${label} exited with ${code}: ${stopCommand}`);
    }).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          this.print(run, `⚠ ${err.message}`);
          console.warn(`  ⚠ ${label}: ${err.message}: ${stopCommand}`);
        }),
      ),
    );
  }

  /** Runs a stop or progress command to the end, or kills it once it has taken `timeout`. */
  private runCommand(
    run: Run,
    what: string,
    command: string,
    timeout: Duration.Input,
    onLine?: (line: string) => void,
  ): Effect.Effect<{ code: number | null; stdout: string }, CommandNotStarted | CommandTimedOut, PreviewMachine> {
    return Effect.gen({ self: this }, function* () {
      let stdout = '';
      const lines = lineSplitter((line) => onLine?.(truncate(stripAnsi(line), 2000)));
      const child = yield* this.spawn(run, command, {
        onStdout: (chunk) => {
          stdout = (stdout + chunk.toString('utf8')).slice(-256_000);
          lines(chunk);
        },
        onStderr: lines,
        // Left alone once it has exited: whatever it started in the background is meant to outlive it.
        release: (proc, exit) => (Exit.isSuccess(exit) ? Effect.void : killTree(proc)),
      });
      const { code } = yield* child.exited;
      lines(null);
      return { code, stdout };
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail(new CommandTimedOut({ what, timeout })) }),
    );
  }

  /** Spawns a command in the preview's checkout, owned by the current scope: closing it runs `release`. */
  private spawn(
    run: Run,
    command: string,
    options: {
      onStdout: (chunk: Buffer) => void;
      onStderr: (chunk: Buffer) => void;
      release: (proc: ShellProcess, exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void, never, PreviewMachine>;
    },
  ): Effect.Effect<ShellProcess, never, PreviewMachine | Scope.Scope> {
    return Effect.acquireRelease(
      PreviewMachine.use((machine) => machine.spawn(command, { cwd: run.cwd, env: run.env, onStdout: options.onStdout, onStderr: options.onStderr })),
      options.release,
    );
  }

  // ---------------------------------------------------------------- plumbing

  /** Runs an effect for as long as the preview lasts: closing its scope interrupts it. */
  private background(run: Run, effect: Effect.Effect<void, never, PreviewMachine>): void {
    this.runtime.runFork(Effect.forkIn(effect, run.scope));
  }

  /** Still the project's preview (maybe on its way out). */
  private owns(run: Run): boolean {
    return this.runs.get(run.preview.projectId) === run;
  }

  /** Still the project's preview and not being stopped (a failed one stays failed while it's stopped). */
  private live(run: Run): boolean {
    return this.owns(run) && run.preview.status !== 'stopping' && !run.stopped;
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
  }

  /** Sends the lines printed since the last flush (batched, so a chatty dev server isn't a message per line). */
  private flush(run: Run): void {
    if (!run.pending.length || !this.owns(run)) return;
    const lines = run.pending.splice(0);
    this.hub.send({ type: 'preview-log', projectId: run.preview.projectId, log: { startedAt: run.preview.startedAt, first: run.printed - lines.length, lines } });
  }
}

/**
 * Takes down a command and everything it started: SIGTERM, then SIGKILL for whatever is still there after a grace
 * period.
 */
function killTree(proc: ShellProcess): Effect.Effect<void, never, PreviewMachine> {
  const { pid } = proc;
  if (pid === undefined) return Effect.void;
  return Effect.gen(function* () {
    const machine = yield* PreviewMachine;
    if (!(yield* machine.signal(pid, 'SIGTERM'))) return;
    yield* machine.signal(pid, 0).pipe(
      Effect.repeat({ schedule: Schedule.spaced('200 millis'), while: (alive) => alive }),
      Effect.timeoutOrElse({ duration: KILL_GRACE, orElse: () => machine.signal(pid, 'SIGKILL') }),
    );
  });
}

/** Checks every link: answering, answering with a 5xx, or not at all. */
function checkLinks(links: PreviewLink[]): Effect.Effect<PreviewLink[], never, PreviewMachine> {
  return PreviewMachine.use((machine) =>
    Effect.forEach(links, ({ health: _h, code: _c, ...link }) =>
      machine.probe(link.url).pipe(
        Effect.map((code): PreviewLink => (code === null ? { ...link, health: 'down' } : { ...link, health: code >= 500 ? 'error' : 'up', code })),
      ), { concurrency: 'unbounded' }),
  );
}

// ---------------------------------------------------------------- commands

const shortName = (repo: string) => repo.split('/')[1] ?? repo;

const refName = (ref: PreviewRef) => ('pr' in ref ? `PR #${ref.pr}` : ref.branch);

/** "▸ web: PR #12 @ 1a2b3c4" or "▸ api: main @ 5d6e7f8". */
const checkoutLine = (repo: string, ref: PreviewRef, sha: string) => `▸ ${shortName(repo)}: ${refName(ref)} @ ${sha.slice(0, 7)}`;

/** data/previews/<project>/<repo name>, or <owner>__<name> when two repos in the project share a name. */
function previewDir(projectId: string, repo: string, repos: string[]): string {
  const clash = repos.some((r) => r !== repo && shortName(r).toLowerCase() === shortName(repo).toLowerCase());
  return path.join(paths.previews, projectId, clash ? repo.replace('/', '__') : shortName(repo));
}

/** Finds the repo a {dir:<name>} placeholder means, by owner/name or just name. */
function resolveRepo(name: string, repos: string[]): string | BadDirPlaceholder {
  const wanted = name.trim().toLowerCase();
  const exact = repos.find((r) => r.toLowerCase() === wanted);
  if (exact) return exact;
  const byName = repos.filter((r) => shortName(r).toLowerCase() === wanted);
  return byName.length === 1 ? byName[0] : new BadDirPlaceholder({ name, matches: byName, repos });
}

function referencedRepos(text: string, repos: string[]): Effect.Effect<string[], BadDirPlaceholder> {
  const found = new Set<string>();
  for (const [, name] of text.matchAll(/\{dir:([^}]+)\}/g)) {
    const repo = resolveRepo(name, repos);
    if (repo instanceof BadDirPlaceholder) return Effect.fail(repo);
    found.add(repo);
  }
  return Effect.succeed([...found]);
}

/** Fills in {port}, {pr}, {repo} and {dir} / {dir:<repo>}; every {dir:<repo>} is in `dirs` by now (referencedRepos). */
function expandCommand(template: string, ctx: { port: number; number: number; repo: string; repos: string[]; dirs: Map<string, string> }): string {
  return template.replace(/\{(port|pr|repo|dir)(?::([^}]+))?\}/g, (whole, key: string, arg?: string) => {
    if (key === 'dir') return shellQuote(ctx.dirs.get(arg ? (resolveRepo(arg, ctx.repos) as string) : ctx.repo)!);
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
  const pm = packageManagerIn(dir);
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

// ---------------------------------------------------------------- demo

/** Log files for a demo stack, in the temp folder (demo mode writes nothing under the data dir). */
function demoLogs(projectId: string, unhealthy: boolean): string {
  const dir = path.join(os.tmpdir(), 'focus-demo-logs', projectId);
  fs.mkdirSync(dir, { recursive: true });
  const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  fs.writeFileSync(path.join(dir, 'api.log'), [
    `${at(9)} info: Microsoft.Hosting.Lifetime[14] Now listening on: http://127.0.0.1:5101`,
    `${at(8)} info: Database migrations applied (12)`,
    unhealthy ? `${at(3)} fail: HealthChecks[0] Health check "payments" failed: connection refused (localhost:7443)` : `${at(3)} info: Health check passed`,
    unhealthy ? `${at(3)} warn: /health reported DOWN` : `${at(2)} info: /health reported UP`,
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'web.log'), ['> web@0.0.0 dev', '> vite', '', '  VITE v6.3.5  ready in 388 ms', '  ➜  Local:   http://127.0.0.1:5102/'].join('\n') + '\n');
  return dir;
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
