import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export class CommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

/** Runs a command without a shell and resolves with stdout. */
export function run(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 5 * 60_000, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message).trim().split('\n').slice(-6).join('\n');
          reject(new CommandError(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${detail}`, stderr, typeof err.code === 'number' ? err.code : null));
        } else {
          resolve(stdout);
        }
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

export function slugify(text: string, max = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Serializes async work per key (e.g. git operations on one mirror). */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();

  async with<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
