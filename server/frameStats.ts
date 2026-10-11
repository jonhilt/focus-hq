import fs from 'node:fs/promises';
import path from 'node:path';

// The frame-stats log: what a browser opened with ?stats=1 sends of how its 3D view ran (shared/types/frameStats.ts),
// a file per page load in the data folder, so a run on another machine (a laptop on the tailnet) can be read here.

/** At most this many lines in one post, each at most this long: a second's sample and its hitches are far smaller. */
const MOST_LINES = 500;
const LONGEST_LINE = 4000;

/** The file a session's lines go in, from the id the page gave it: letters, digits, dashes and underscores only. */
export function sessionFile(session: unknown): string | null {
  return typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? `${session}.jsonl` : null;
}

/** The lines to keep from a post: each an object, as one line of JSON; anything else is dropped. */
export function statLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .slice(0, MOST_LINES)
    .filter((l): l is object => !!l && typeof l === 'object' && !Array.isArray(l))
    .map((l) => JSON.stringify(l))
    .filter((l) => l.length <= LONGEST_LINE);
}

/** Appends a post's lines to its session's file in `dir`, and says where that is. */
export async function appendFrameStats(dir: string, session: unknown, lines: unknown): Promise<{ file: string }> {
  const name = sessionFile(session);
  if (!name) throw new Error('A frame-stats session is letters, digits, dashes and underscores');
  const kept = statLines(lines);
  const file = path.join(dir, name);
  if (kept.length) {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, kept.map((l) => `${l}\n`).join(''));
  }
  return { file };
}
