// Where `pnpm run qa-catch` keeps its runs (docs/qa-catch.md), for itself (--again) and for the plugins that show the
// latest (the flow plugin's guard, through `latestQaCatch` in plugin-api/server).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { CatchRun } from './qaCatch';

/** Each run of `pnpm run qa-catch`: bugs planted in merged pull requests, and whether QA caught them. */
export const QA_CATCH_DIR = path.join(config.dataDir, 'qa-catch');

/** The latest saved run, if there's been one. */
export function latestRun(): CatchRun | undefined {
  const files = existsSync(QA_CATCH_DIR) ? readdirSync(QA_CATCH_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  const last = files.at(-1);
  // the runs are this script's own, written by it
  return last ? (JSON.parse(readFileSync(path.join(QA_CATCH_DIR, last), 'utf8')) as CatchRun) : undefined;
}
