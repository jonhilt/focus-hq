import { beforeEach } from 'vitest';
import { seedRandom } from './server/util';

// Every test rolls the same dice each run (crew looks and names, ids, the demo's picks), so a test can't fail one run in
// a hundred and pass when it's run again. `FOCUS_TEST_SEED` rolls others (`pnpm run test:repeat` rolls a new one each
// run), and a failing test prints the seed it rolled, to run it again the same way.
const seed = Number(process.env.FOCUS_TEST_SEED ?? 1);

beforeEach(({ task, onTestFailed }) => {
  // the same dice for each test, whichever tests run before it
  seedRandom(seed);
  onTestFailed(() => console.error(`Random seed ${seed}: FOCUS_TEST_SEED=${seed} pnpm test ${task.file.name} -t "${task.name}" rolls it the same`));
});
