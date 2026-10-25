import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach } from 'vitest';
import { seedRandom } from './server/util';

// No test reads or writes the captain's own data folder (~/.focus): each test file gets an empty one of its own unless
// it sets FOCUS_DATA_DIR itself. (A plugin moving what it kept there before into its own folder ran on the real one.)
process.env.FOCUS_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'focus-test-data-'));

// No test's git runs the hooks of the session running the tests: a lead's or QA's session sets git's config from the
// environment (GIT_CONFIG_COUNT and its numbered keys) to send every push through Ops' guard, which refuses the pushes
// to `main` that the tests' own scratch repos make.
for (const key of Object.keys(process.env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key) || key === 'FOCUS_PUSH_REFUSED') delete process.env[key];

// Every test rolls the same dice each run (crew looks and names, ids, the demo's picks), so a test can't fail one run in
// a hundred and pass when it's run again. `FOCUS_TEST_SEED` rolls others (`pnpm run test:repeat` rolls a new one each
// run), and a failing test prints the seed it rolled, to run it again the same way.
const seed = Number(process.env.FOCUS_TEST_SEED ?? 1);

beforeEach(({ task, onTestFailed }) => {
  // the same dice for each test, whichever tests run before it
  seedRandom(seed);
  onTestFailed(() => console.error(`Random seed ${seed}: FOCUS_TEST_SEED=${seed} pnpm test ${task.file.name} -t "${task.name}" rolls it the same`));
});
