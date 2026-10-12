// Runs the unit tests again and again, each time with the next random seed (FOCUS_TEST_SEED, vitest.setup.ts) and its
// files and tests shuffled by it too, and stops at the first run that fails, saying how to run it the same way. A test
// that only passes on some seeds, or only after some other test, shows up here rather than in an agent's checks.
//
//   pnpm run test:repeat                          the whole suite 20 times, seeds 1 to 20
//   pnpm run test:repeat --times 5 --seed 100     5 times, seeds 100 to 104
//   pnpm run test:repeat server/agents            anything else goes to vitest: here, only server/agents' tests
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

function option(name: string, fallback: number): number {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${name} wants a whole number, not ${value}`);
  return n;
}

const times = option('--times', 20);
const first = option('--seed', 1);
const vitest = path.join(ROOT, 'node_modules/vitest/vitest.mjs');

for (let i = 0; i < times; i++) {
  const seed = first + i;
  console.log(`\n▶ Run ${i + 1} of ${times}: seed ${seed}`);
  const run = spawnSync(process.execPath, [vitest, 'run', '--sequence.shuffle', `--sequence.seed=${seed}`, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, FOCUS_TEST_SEED: String(seed) },
  });
  if (run.status !== 0) {
    console.error(`\n✗ Run ${i + 1} of ${times} failed on seed ${seed}. Again, the same way:`);
    console.error(`  FOCUS_TEST_SEED=${seed} pnpm exec vitest run --sequence.shuffle --sequence.seed=${seed}${args.length ? ` ${args.join(' ')}` : ''}`);
    process.exit(run.status ?? 1);
  }
}
console.log(`\n✓ ${times} runs passed, seeds ${first} to ${first + times - 1}`);
