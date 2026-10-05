import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Context, Data, Deferred, Effect, Layer } from 'effect';
import type { PreviewRef } from '../shared/types';
import { checkoutPreview } from './agents/workspace';
import { errorMessage } from './util';

const WINDOWS = process.platform === 'win32';

export interface ExitStatus {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class CommandNotStarted extends Data.TaggedError('CommandNotStarted')<{ command: string; reason: string }> {
  override get message() {
    return `Couldn't start the command: ${this.reason}`;
  }
}

export class CheckoutFailed extends Data.TaggedError('CheckoutFailed')<{ repo: string; reason: string }> {
  override get message() {
    return this.reason;
  }
}

export interface ShellProcess {
  /** Undefined when the shell itself couldn't start (`exited` fails then). */
  readonly pid: number | undefined;
  /** The exit, once its output has drained, without waiting on pipes a background child keeps open. */
  readonly exited: Effect.Effect<ExitStatus, CommandNotStarted>;
}

export interface ShellOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
}

/** What a preview does to this machine: run its commands, signal what they started, and look at the sites. */
export class PreviewMachine extends Context.Service<PreviewMachine, {
  /** Starts a command line in its own process group. Neither waits for it nor stops it: see `killTree` in previews.ts. */
  spawn(command: string, options: ShellOptions): Effect.Effect<ShellProcess>;
  /** Signals the command and everything it started (`0` only checks). False once nothing is left. */
  signal(pid: number, signal: NodeJS.Signals | 0): Effect.Effect<boolean>;
  /** The HTTP status a URL answers with (a 404 or a 500 still means a server is there), or null when nothing answers. */
  probe(url: string): Effect.Effect<number | null>;
  readonly freePort: Effect.Effect<number>;
  /** Checks a PR or branch out, detached, in `dir`; returns the commit and the checkout's real path. */
  checkout(repo: string, dir: string, ref: PreviewRef): Effect.Effect<{ sha: string; path: string }, CheckoutFailed>;
}>()('focus/previews/PreviewMachine') {
  static readonly layer = Layer.sync(PreviewMachine, () => {
    // Commands run in their own process group, so they'd outlive the office unless we take them down with us. Only
    // `exit` handlers run on every way out, and they can't wait: this is the last resort behind each preview's scope.
    const groups = new Set<number>();
    process.on('exit', () => {
      for (const pid of groups) signalTree(pid, 'SIGKILL');
    });
    const signal = (pid: number, sig: NodeJS.Signals | 0) => {
      const alive = signalTree(pid, sig) && sig !== 'SIGKILL';
      if (!alive) groups.delete(pid);
      return alive;
    };
    return PreviewMachine.of({
      spawn: (command, options) =>
        Effect.sync(() => {
          const child = spawnShell(command, options.cwd, options.env);
          const exit = Deferred.makeUnsafe<ExitStatus, CommandNotStarted>();
          const closed = Deferred.makeUnsafe<void>();
          if (child.pid) groups.add(child.pid);
          child.stdout.on('data', options.onStdout);
          child.stderr.on('data', options.onStderr);
          child.on('error', (err) => Deferred.doneUnsafe(exit, Effect.fail(new CommandNotStarted({ command, reason: err.message }))));
          child.on('exit', (code, sig) => {
            // a group the command left running (a detached site) still needs taking down later
            if (child.pid) signal(child.pid, 0);
            Deferred.doneUnsafe(exit, Effect.succeed({ code, signal: sig }));
          });
          child.once('close', () => Deferred.doneUnsafe(closed, Effect.void));
          return {
            pid: child.pid,
            exited: Deferred.await(exit).pipe(Effect.tap(() => Deferred.await(closed).pipe(Effect.timeoutOption(500)))),
          };
        }),
      signal: (pid, sig) => Effect.sync(() => signal(pid, sig)),
      probe,
      freePort,
      checkout: (repo, dir, ref) =>
        Effect.tryPromise({
          try: async () => {
            const sha = await checkoutPreview(repo, dir, ref);
            return { sha, path: fs.realpathSync(dir) };
          },
          catch: (err) => new CheckoutFailed({ repo, reason: errorMessage(err) }),
        }),
    });
  });
}

/**
 * A shell on purpose: preview commands are the manager's own command lines (npm.cmd on Windows, `&&`, a project CLI).
 * Detached on POSIX so the whole process group can be signalled.
 */
function spawnShell(command: string, cwd: string | undefined, env: NodeJS.ProcessEnv | undefined) {
  return spawn(command, { cwd, env, shell: true, detached: !WINDOWS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

const freePort = Effect.callback<number>((resume) => {
  const server = net.createServer();
  server.unref();
  server.on('error', (err) => resume(Effect.die(err)));
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as net.AddressInfo;
    server.close(() => resume(Effect.succeed(port)));
  });
});

const probe = (url: string) =>
  Effect.callback<number | null>((resume) => {
    const done = (res: http.IncomingMessage) => {
      res.resume();
      resume(Effect.succeed(res.statusCode ?? 0));
    };
    const req = url.startsWith('https:')
      ? https.get(url, { timeout: 2000, rejectUnauthorized: false }, done) // local dev certificates are self-signed
      : http.get(url, { timeout: 2000 }, done);
    req.on('timeout', () => req.destroy());
    req.on('error', () => resume(Effect.succeed(null)));
  });
