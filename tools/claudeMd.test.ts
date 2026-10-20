import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every agent's session loads CLAUDE.md, so each line in it costs every session and dilutes the rest. It holds only what
// Claude would get wrong without it; the rest belongs beside the code, or in a part's docs page if it's a decision or promise. A branch from before the trim brought the old 28 KB back
// in a merge once: this is what catches that.
const ROOT = path.resolve(import.meta.dirname, '..');
const BUDGETS = { 'CLAUDE.md': 4_000, 'client/src/world/CLAUDE.md': 1_500 };

describe('CLAUDE.md budgets', () => {
  for (const [file, budget] of Object.entries(BUDGETS))
    it(`${file} stays under ${budget} bytes`, () => {
      const size = Buffer.byteLength(readFileSync(path.join(ROOT, file), 'utf8'));
      expect(size, `${file} is ${size} bytes. Keep only what Claude would get wrong without it, and put the rest in a comment beside the code (or the part's docs page if it's a decision or promise). Resolving a conflict in it, keep main's short version.`).toBeLessThanOrEqual(budget);
    });
});
