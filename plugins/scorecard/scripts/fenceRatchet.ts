// The fence's ratchet (README.md#the-ratchet): each file's type assertions may only go down. A baseline, committed
// beside this, holds each file's count; the gate's test fails a file above its count, and a file below it until the
// baseline is lowered to match (`pnpm run fence:lower`), so a gain can't be spent again. Pure: fenceFiles.ts reads the repo.

/** Type assertions per file, by its path from the repo root. A file with none isn't listed. */
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

/** What the gate says about drift, or undefined when every file matches its baseline. */
export function driftMessage({ over, under }: ReturnType<typeof fenceDrift>): string | undefined {
  const lines: string[] = [];
  if (over.length) {
    lines.push(
      'Type assertions (`as T`, `<T>x`) went up. Narrow instead: a type guard, `in`/`typeof`, an Effect Schema decode, or a type that says what the value is. Don\'t raise the baseline to pass.',
      ...over.map((d) => `  ${d.file}: ${d.count}, baseline ${d.baseline}`),
    );
  }
  if (under.length) {
    lines.push(
      'Type assertions went down: lock the gain in with `pnpm run fence:lower`, and commit plugins/scorecard/fence-baseline.json.',
      ...under.map((d) => `  ${d.file}: ${d.count}, baseline ${d.baseline}`),
    );
  }
  return lines.length ? lines.join('\n') : undefined;
}
