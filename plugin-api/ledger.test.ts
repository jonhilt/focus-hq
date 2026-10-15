import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { officeLedger } from './ledger';

describe('officeLedger', () => {
  it('reads the ledger as the office does, and says where it looked when there is none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    expect(officeLedger(file)).toEqual({ file, events: undefined });
    fs.writeFileSync(file, `${JSON.stringify({ v: 2, seq: 1, at: 1, projectId: 'p', kind: 'closed', repo: 'a/b', pr: 1, by: 'github', qa: 'none', failedRounds: 0, triages: 0 })}\n`);
    expect(officeLedger(file).events?.map((e) => e.kind)).toEqual(['closed']);
  });
});
