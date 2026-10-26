import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { seededRandom } from '../shared/random';
import { withoutSecrets } from './secrets';

// pure, so a decision can use them without this file's processes and dice (docs/architecture.md#decisions)
export { errorMessage, slugify, truncate } from '../shared/text';

export class CommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number | null,
    /** What it printed before it failed (`git merge-tree` lists the conflicted files there). */
    readonly stdout = '',
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
      { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 5 * 60_000, env: withoutSecrets() },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message).trim().split('\n').slice(-6).join('\n');
          reject(new CommandError(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${detail}`, stderr, typeof err.code === 'number' ? err.code : null, stdout));
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

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg' };

/** The bytes and file extension of a base64 image data URL; null for anything else. */
export function decodeImage(dataUrl: string): { ext: string; bytes: Buffer } | null {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataUrl);
  const ext = m && IMAGE_EXT[m[1]];
  return ext ? { ext, bytes: Buffer.from(m[2], 'base64') } : null;
}

/** Seeded dice (`seedIds`), which ids roll in place of crypto's: names hash from ids, so its cast stays the same. */
let idDice: (() => number) | null = null;

export function seedIds(roll: () => number): void {
  idDice = roll;
}

/**
 * Rolls every random choice the server makes from `seed`: Math.random (crew looks and names, the demo's waits and
 * picks) and the ids (`randomHex`, which goal leads' names hash from): the unit tests run the same way each time with it
 * (`vitest.setup.ts`).
 */
export function seedRandom(seed: number): void {
  Math.random = seededRandom(seed);
  seedIds(seededRandom(seed + 1));
}

/** The dice the demo ship's ids roll from: any fixed number would do. */
const DEMO_ID_SEED = 226;

/**
 * The dice Focus starts with. The demo rolls its ids from the same dice each time it starts, so its projects and
 * goal leads keep their ids across a restart and a script driving its API can go on using the ones it read (Math.random
 * still varies its waits and picks). The real ship's ids come from crypto.
 */
export function seedShip(mode: { demo: boolean }): void {
  if (mode.demo) seedIds(seededRandom(DEMO_ID_SEED));
}

/** `bytes` random bytes as hex. */
export function randomHex(bytes: number): string {
  const roll = idDice;
  if (!roll) return randomBytes(bytes).toString('hex');
  return Array.from({ length: bytes }, () => Math.floor(roll() * 256).toString(16).padStart(2, '0')).join('');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomHex(5)}`;
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

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `name`'s file in `dir`. Names come from requests (`/api/agents/:id/...`), so one that isn't a plain file name, like
 * `../x` (sent as `..%2fx`), is refused rather than read from, or truncated, outside `dir`.
 */
export function fileIn(dir: string, name: string): string {
  if (!name || name !== path.basename(name) || name.includes('\\') || name === '.' || name === '..') throw new Error(`Not a file name: ${name}`);
  return path.join(dir, name);
}
