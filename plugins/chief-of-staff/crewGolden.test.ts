import { describe, expect, it } from 'vitest';
import { judgeSystemPrompt } from './judge';
import { laneSystemPrompt } from './laneJudge';
import { lineSystemPrompt } from './line';
import { ROUTES } from './shared';

// The chief of staff's prompts, word for word, as they were before they moved into its crew files (crew/): changing
// one on purpose, update its snapshot (`pnpm test -- -u`) and let the diff show the change.

const golden = (name: string) => `__golden__/${name}.md`;
const orders = '  - Always ask before spending money.\n- Merging your own PRs is fine.  ';

describe('the chief of staff’s judge', () => {
  it('is told word for word what it was, with standing orders or none yet', async () => {
    await expect(judgeSystemPrompt()).toMatchFileSnapshot(golden('judge'));
    await expect(judgeSystemPrompt(orders)).toMatchFileSnapshot(golden('judge-orders'));
  });

  it('is told word for word what it was when the route is decided already', async () => {
    for (const route of ROUTES) await expect(judgeSystemPrompt(orders, route)).toMatchFileSnapshot(golden(`judge-pinned-${route}`));
  });
});

describe('the chief of staff’s lane judge', () => {
  it('is told word for word what it was, with standing orders or none yet', async () => {
    await expect(laneSystemPrompt()).toMatchFileSnapshot(golden('lane'));
    await expect(laneSystemPrompt(orders)).toMatchFileSnapshot(golden('lane-orders'));
  });
});

describe('the chief of staff on its direct line', () => {
  it('is told word for word what it was', async () => {
    await expect(lineSystemPrompt()).toMatchFileSnapshot(golden('line'));
  });
});
