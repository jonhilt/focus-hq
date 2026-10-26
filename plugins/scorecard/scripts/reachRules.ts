// How much of each part that keeps state Focus's state rules reach (docs/invariants.md#describing-a-part): the lines
// of a file the descriptions' checks (`*Invariants.test.ts`, plugins' `invariants.test.ts`) run, on a fixed seed. The
// ratchet holds the lines they don't reach, which only go down: a share would drop when well-reached code moves out of
// the file (a decision into a *Rules.ts file, say) though no check reaches less. Pure, so it's unit tested
// (reachRules.test.ts); scripts/rules.ts runs the checks and holds the ratchet.

/** A file's lines, and how many of them the rules reach. */
export interface FileReach {
  total: number;
  covered: number;
}

/** What one run of the rules reached of each file that keeps state. */
export type Reach = Record<string, FileReach>;

/** The lines of each file the rules don't reach: the baseline, which only goes down. */
export type Unreached = Record<string, number>;

const unreached = (r: FileReach) => r.total - r.covered;

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
  /** Files with more lines the rules don't reach than their baseline. */
  down: { file: string; baseline: number; now: number }[];
  /** Files that keep state and aren't in the baseline, that the rules don't reach at all. */
  unheld: string[];
  /** Files with fewer lines the rules don't reach than their baseline (or new ones they reach): lower it. */
  up: { file: string; baseline: number | undefined; now: number }[];
}

/** Where the rules' reach stands against the baseline, for the files that keep state. */
export function reachDrift(baseline: Unreached, now: Reach): ReachDrift {
  const files = Object.keys(now).sort();
  return {
    down: files.flatMap((file) => {
      const was = baseline[file];
      const is = unreached(now[file]);
      return was !== undefined && is > was ? [{ file, baseline: was, now: is }] : [];
    }),
    unheld: files.filter((file) => baseline[file] === undefined && !now[file].covered),
    up: files.flatMap((file) => {
      const was = baseline[file];
      const is = unreached(now[file]);
      return (was === undefined ? now[file].covered > 0 : is < was) ? [{ file, baseline: was, now: is }] : [];
    }),
  };
}

/**
 * The baseline lowered to where each file is now: it never raises one, drops files that no longer keep state, and never
 * takes in a new file no description reaches (that one needs describing, not a baseline of all its lines).
 */
export function lowered(baseline: Unreached, now: Reach): Unreached {
  return Object.fromEntries(
    Object.keys(now).sort().flatMap((file) => {
      const was = baseline[file];
      const is = unreached(now[file]);
      return was === undefined && !now[file].covered ? [] : [[file, Math.min(was ?? is, is)]];
    }),
  );
}

/** What's wrong with the reach, in words for whoever ran the ratchet; undefined when it holds. */
export function reachMessage({ down, unheld, up }: ReachDrift): string | undefined {
  const lines: string[] = [];
  if (down.length) {
    lines.push('These files that keep state have more lines the state rules don\'t reach than they did. Describe what you added to the part, or extend its description (docs/invariants.md#describing-a-part). Don\'t raise the baseline to pass.');
    lines.push(...down.map((d) => `  ${d.file}: ${d.now} lines unreached, baseline ${d.baseline}`));
  }
  if (unheld.length) {
    lines.push('These files keep state and no description of the state rules reaches them. Describe the part (docs/invariants.md#describing-a-part).');
    lines.push(...unheld.map((file) => `  ${file}`));
  }
  if (up.length) {
    lines.push('The state rules leave fewer lines of these files unreached than their baseline: lower it with `pnpm run rules --lower` and commit it.');
    lines.push(...up.map((d) => `  ${d.file}: ${d.now} lines unreached, baseline ${d.baseline ?? 'none'}`));
  }
  return lines.length ? lines.join('\n') : undefined;
}

/** What `pnpm run rules` was asked to do: report the reach, hold the ratchet, or lower the baseline (and hold it). */
export type RulesMode = 'report' | 'ratchet' | 'lower';

export function rulesMode(argv: readonly string[]): RulesMode {
  return argv.includes('--lower') ? 'lower' : argv.includes('--ratchet') ? 'ratchet' : 'report';
}

/** Each file that keeps state, how much of it the rules reach and how many lines they don't, a line each. */
export function reachTable(now: Reach): string {
  const files = Object.keys(now);
  const width = Math.max(0, ...files.map((f) => f.length));
  return files.map((f) => `  ${f.padEnd(width)}  ${String(percent(now[f].covered, now[f].total)).padStart(3)}%  ${String(unreached(now[f])).padStart(4)} unreached`).join('\n');
}

/** The ratchet's verdict on the reach against the baseline: what to say, and whether it holds. */
export function ratchetVerdict(baseline: Unreached, now: Reach): { holds: boolean; text: string } {
  const message = reachMessage(reachDrift(baseline, now));
  return message
    ? { holds: false, text: message }
    : { holds: true, text: `Ratchet holds: ${Object.keys(now).length} files keep state, none with more lines unreached than its baseline.` };
}
