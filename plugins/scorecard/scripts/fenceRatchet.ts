// The ratchets (README.md#the-ratchets): each file's type assertions, and its functions over CRAP 30, may only go down.
// A baseline, committed beside this, holds each file's count; a file above its count fails, and a file below it fails
// until the baseline is lowered to match, so a gain can't be spent again. Pure: fenceFiles.ts and crap.ts read the repo.

/** A count per file, by its path from the repo root. A file at 0 isn't listed. */
export type FenceCounts = Record<string, number>;

export interface FenceDrift {
  file: string;
  count: number;
  baseline: number;
}

/** The files above their baseline (a new file counts from 0) and the ones below it (a deleted file counts as 0). */
export function fenceDrift(baseline: FenceCounts, counts: FenceCounts): { over: FenceDrift[]; under: FenceDrift[] } {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort();
  const all = files.map((file) => ({ file, count: counts[file] ?? 0, baseline: baseline[file] ?? 0 }));
  return { over: all.filter((d) => d.count > d.baseline), under: all.filter((d) => d.count < d.baseline) };
}

/** The baseline lowered to the counts where they fell: never raised, and a new file isn't added. */
export function lowered(baseline: FenceCounts, counts: FenceCounts): FenceCounts {
  const kept = Object.keys(baseline).sort().flatMap((file) => {
    const n = Math.min(baseline[file], counts[file] ?? 0);
    return n > 0 ? [[file, n] as const] : [];
  });
  return Object.fromEntries(kept);
}

/** What a ratchet says when a file went up, and when one went down. */
export interface RatchetWords {
  up: string;
  down: string;
}

/** What a ratchet says about drift, or undefined when every file matches its baseline. */
export function ratchetMessage({ over, under }: ReturnType<typeof fenceDrift>, words: RatchetWords): string | undefined {
  const lines: string[] = [];
  if (over.length) lines.push(words.up, ...over.map((d) => `  ${d.file}: ${d.count}, baseline ${d.baseline}`));
  if (under.length) lines.push(words.down, ...under.map((d) => `  ${d.file}: ${d.count}, baseline ${d.baseline}`));
  return lines.length ? lines.join('\n') : undefined;
}

export const FENCE_WORDS: RatchetWords = {
  up: 'Type assertions (`as T`, `<T>x`) went up. Narrow instead: a type guard, `in`/`typeof`, an Effect Schema decode, or a type that says what the value is. Don\'t raise the baseline to pass.',
  down: 'Type assertions went down: lock the gain in with `pnpm run fence:lower`, and commit plugins/scorecard/fence-baseline.json.',
};

export const CRAP_WORDS: RatchetWords = {
  up: 'Functions over CRAP 30 went up. Move the new or changed function\'s decisions into small pure functions with tests beside them, or test it; don\'t raise the baseline to pass.',
  down: 'Functions over CRAP 30 went down: lock the gain in with `pnpm run crap --lower`, and commit plugins/scorecard/crap-baseline.json.',
};

/** What the gate says about type assertions' drift. */
export const driftMessage = (drift: ReturnType<typeof fenceDrift>) => ratchetMessage(drift, FENCE_WORDS);

export type RatchetMode = 'check' | 'lower';

/** Which way `pnpm run crap` holds its ratchet, from its arguments: `--lower` lowers then checks, `--ratchet` checks. */
export function ratchetMode(argv: string[]): RatchetMode | undefined {
  const mode = argv.includes('--lower') ? 'lower' : argv.includes('--ratchet') ? 'check' : undefined;
  if (mode && argv.includes('--all')) throw new Error('The ratchet holds server/, shared/ and plugins/ only: drop --all');
  return mode;
}
