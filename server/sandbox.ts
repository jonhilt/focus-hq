import { Context, type Effect, type Scope } from 'effect';
import type { PreviewRef } from '../shared/types';
import type { CheckoutFailed, ShellOptions, ShellProcess } from './previewMachine';

/**
 * A place a preview runs: the folders its repos are checked out in, the port it's offered, and the commands it starts.
 *
 * A preview runs in a sandbox rather than on "this machine" so where it runs isn't fixed in `Previews`. The first kind,
 * and the one previews have always used, is a folder and a free port on this machine (`localSandboxes`); others (a
 * container, a cloud machine) slot in behind the same interface. Several previews at once come from handing out more
 * than one sandbox, not from `Previews` knowing how they're kept apart.
 *
 * Every command, checkout and probe a preview makes goes through its sandbox, so a sandbox elsewhere sees each one it
 * would need to forward. Not yet: the log files a stack reports, which `Previews` reads from this machine's disk.
 */
export interface Sandbox {
  /** Where `repo` is (or will be) checked out, as the sandbox's own commands see it: a {dir} placeholder, a cwd. */
  dir(repo: string): string;
  /** The port offered to the preview's site ({port}, FOCUS_PREVIEW_PORT): taken the first time it's asked for. */
  readonly port: Effect.Effect<number>;
  /** Checks a PR or branch out, detached, in `dir(repo)`; returns the commit and the checkout's real path. */
  checkout(repo: string, ref: PreviewRef): Effect.Effect<{ sha: string; path: string }, CheckoutFailed>;
  /** Starts a command line in its own process group. Neither waits for it nor stops it: see `killTree` in previews.ts. */
  spawn(command: string, options: ShellOptions): Effect.Effect<ShellProcess>;
  /** Signals a command and everything it started (`0` only checks). False once nothing is left. */
  signal(pid: number, signal: NodeJS.Signals | 0): Effect.Effect<boolean>;
  /** The HTTP status a URL answers with (a 404 or a 500 still means a server is there), or null when nothing answers. */
  probe(url: string): Effect.Effect<number | null>;
}

/** Hands out sandboxes, one per key (a project's preview today). */
export class Sandboxes extends Context.Service<Sandboxes, {
  /**
   * A sandbox for `key`, whose `repos` are every repository the preview may check out. Released when the scope closes,
   * after everything acquired in that scope since: the preview's commands are stopped before the sandbox goes.
   */
  acquire(key: string, repos: readonly string[]): Effect.Effect<Sandbox, never, Scope.Scope>;
  /** Deletes whatever `key`'s sandboxes kept (its checkouts): the project is gone. */
  remove(key: string): Effect.Effect<void>;
}>()('focus/previews/Sandboxes') {}
