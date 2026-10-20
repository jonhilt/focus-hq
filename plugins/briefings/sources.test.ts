import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Agent, LeadToolContext, PluginHost } from '../../plugin-api/server';
import { officeSources } from './sources';

describe('the office’s sources', () => {
  // a checkout with one file in it (not a git repo, so no commit to cite), and a ledger of one line
  const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
  mkdirSync(join(dir, 'server'));
  writeFileSync(join(dir, 'server', 'ledger.ts'), 'one\nappendFileSync(path, line);\n');
  const lead = { agent: { id: 'lead1' } as Agent, checkouts: [{ repo: 'jonhilt/focus', dir }] } as unknown as LeadToolContext;
  const host = { ledger: () => [{ seq: 7, at: Date.UTC(2026, 9, 20, 8, 44), projectId: 'p', kind: 'qa-verdict', verdict: 'fail', checks: { pass: 3, fail: 1 } }], transcript: () => Promise.resolve(undefined) } as unknown as PluginHost;
  const sources = officeSources(host);

  it('reads a file in the lead’s checkout, with or without its folder first, and never one outside it', async () => {
    const folder = dir.split('/').at(-1);
    expect(await sources.file(lead, 'server/ledger.ts')).toEqual({ text: 'one\nappendFileSync(path, line);\n', cite: 'server/ledger.ts:{line}' });
    expect(await sources.file(lead, `${folder}/server/ledger.ts:2`)).toMatchObject({ cite: 'server/ledger.ts:{line}' });
    expect(await sources.file(lead, '../../etc/passwd')).toEqual({ error: "there's no file ../../etc/passwd in your checkout." });
  });

  it('reads a ledger line by its number, every value a line of its own', () => {
    expect(sources.ledger(7)?.text.split('\n')).toEqual(expect.arrayContaining(['qa-verdict', 'fail', '3', '1']));
    expect(sources.ledger(7)?.cite).toMatch(/^ledger #7 · qa-verdict · 20 Oct/);
    expect(sources.ledger(8)).toBeUndefined();
  });

  it('has nothing the lead said when their session’s transcript isn’t on this machine', async () => {
    expect(await sources.said(lead)).toEqual([]);
  });
});
