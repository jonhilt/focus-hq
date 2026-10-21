// How much of each part that keeps state Focus's state rules reach (docs/invariants.md#describing-a-part): the
// share of a file's lines the descriptions' checks (`*Invariants.test.ts`, plugins' `invariants.test.ts`) run, on a fixed
// seed. Pure, so it's unit tested (rulesCoverage.test.ts); scripts/rules.ts runs the checks and holds the ratchet.

/** The share of a file's lines the rules reach, in whole percent: a baseline per file. */
export type Reach = Record<string, number>;

/**
 * Whether a source file keeps something across a restart, going by what it does to disk: writes or appends a file,
 * renames one into place, fsyncs, or writes to a journal or the ledger.
 */
export function keepsState(source: string): boolean {
  return /\b(?:writeFileSync|appendFileSync|renameSync|fsyncSync|writeFile|appendFile)\(|\.journal\(|\bstore\.record\(/.test(source);
}

/** The files the rules' reach is held for: those that keep state, not tests, scripts or the demo's stand-ins. */
export const heldFile = (file: string) => !/\.test\.ts$|\.d\.ts$|(^|\/)scripts\//.test(file) && !/(^|\/)demo([A-Z.]|\.ts$)/.test(file);

/** Whole percent, rounded down, so a line short of the next percent doesn't count as it. */
export const percent = (covered: number, total: number) => (total ? Math.floor((covered / total) * 100) : 0);

export interface ReachDrift {
  /** Files the rules reach less of than their baseline. */
  down: { file: string; baseline: number; now: number }[];
  /** Files that keep state and aren't in the baseline, that the rules don't reach at all. */
  unheld: string[];
  /** Files the rules reach more of than their baseline (or new ones they reach): raise it. */
  up: { file: string; baseline: number | undefined; now: number }[];
}

/** Where the rules' reach stands against the baseline, for the files that keep state. */
export function reachDrift(baseline: Reach, now: Reach): ReachDrift {
  const files = Object.keys(now).sort();
  return {
    down: files.flatMap((file) => {
      const was = baseline[file];
      const is = now[file] ?? 0;
      return was !== undefined && is < was ? [{ file, baseline: was, now: is }] : [];
    }),
    unheld: files.filter((file) => baseline[file] === undefined && !now[file]),
    up: files.flatMap((file) => {
      const was = baseline[file];
      const is = now[file] ?? 0;
      return (was === undefined ? is > 0 : is > was) ? [{ file, baseline: was, now: is }] : [];
    }),
  };
}

/**
 * The baseline raised to where each file is now: it never lowers one, drops files that no longer keep state, and never
 * takes in a new file no description reaches (that one needs describing, not a baseline of nothing).
 */
export function raised(baseline: Reach, now: Reach): Reach {
  return Object.fromEntries(
    Object.keys(now).sort().flatMap((file) => {
      const was = baseline[file];
      const is = now[file] ?? 0;
      return was === undefined && !is ? [] : [[file, Math.max(was ?? 0, is)]];
    }),
  );
}

/** What's wrong with the reach, in words for whoever ran the ratchet; undefined when it holds. */
export function reachMessage({ down, unheld, up }: ReachDrift): string | undefined {
  const lines: string[] = [];
  if (down.length) {
    lines.push('The state rules reach less of these files than they did. Describe what you added to the part, or extend its description (docs/invariants.md#describing-a-part). Don\'t lower the baseline to pass.');
    lines.push(...down.map((d) => `  ${d.file}: ${d.now}%, baseline ${d.baseline}%`));
  }
  if (unheld.length) {
    lines.push('These files keep state and no description of the state rules reaches them. Describe the part (docs/invariants.md#describing-a-part).');
    lines.push(...unheld.map((file) => `  ${file}`));
  }
  if (up.length) {
    lines.push('The state rules reach more of these files than their baseline: raise it with `pnpm run rules --raise` and commit it.');
    lines.push(...up.map((d) => `  ${d.file}: ${d.now}%, baseline ${d.baseline ?? 'none'}`));
  }
  return lines.length ? lines.join('\n') : undefined;
}

/** What `pnpm run rules` was asked to do: report the reach, hold the ratchet, or raise the baseline (and hold it). */
export type RulesMode = 'report' | 'ratchet' | 'raise';

export function rulesMode(argv: readonly string[]): RulesMode {
  return argv.includes('--raise') ? 'raise' : argv.includes('--ratchet') ? 'ratchet' : 'report';
}

/** Each file that keeps state and how much of it the rules reach, a line each. */
export function reachTable(now: Reach): string {
  const files = Object.keys(now);
  const width = Math.max(0, ...files.map((f) => f.length));
  return files.map((f) => `  ${f.padEnd(width)}  ${String(now[f]).padStart(3)}%`).join('\n');
}

/** The ratchet's verdict on the reach against the baseline: what to say, and whether it holds. */
export function ratchetVerdict(baseline: Reach, now: Reach): { holds: boolean; text: string } {
  const message = reachMessage(reachDrift(baseline, now));
  return message
    ? { holds: false, text: message }
    : { holds: true, text: `Ratchet holds: ${Object.keys(now).length} files keep state, none reached less than its baseline.` };
}
