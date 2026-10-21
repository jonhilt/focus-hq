import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Agent, LeadToolContext, PluginHost } from '../../plugin-api/server';
import { opsSources, prOf, prText } from './sources';

describe('Ops’ sources', () => {
  // a checkout with one file in it (not a git repo, so no commit to cite), and a ledger of one line
  const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
  mkdirSync(join(dir, 'server'));
  writeFileSync(join(dir, 'server', 'ledger.ts'), 'one\nappendFileSync(path, line);\n');
  const lead = { agent: { id: 'lead1' } as Agent, checkouts: [{ repo: 'jonhilt/focus', dir }] } as unknown as LeadToolContext;
  const host = { ledger: () => [{ seq: 7, at: Date.UTC(2026, 9, 20, 8, 44), projectId: 'p', kind: 'qa-verdict', verdict: 'fail', checks: { pass: 3, fail: 1 } }], transcript: () => Promise.resolve(undefined) } as unknown as PluginHost;
  const sources = opsSources(host);

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

  it('finds the pull request a ref names, in one of the lead’s repos', () => {
    expect(prOf('#572', ['jonhilt/focus'])).toEqual({ repo: 'jonhilt/focus', number: 572 });
    expect(prOf('focus#572', ['jonhilt/focus', 'jonhilt/site'])).toEqual({ repo: 'jonhilt/focus', number: 572 });
    expect(prOf('jonhilt/site #3', ['jonhilt/focus', 'jonhilt/site'])).toEqual({ repo: 'jonhilt/site', number: 3 });
    expect(prOf('#3', ['jonhilt/focus', 'jonhilt/site'])).toBe('say which repo #3 is in: jonhilt/focus, jonhilt/site.');
    expect(prOf('other/focus#3', ['jonhilt/focus'])).toBe("other/focus isn't one of your repos (jonhilt/focus).");
    expect(prOf('PR 572', ['jonhilt/focus'])).toMatch(/isn't a pull request/);
  });

  it('reads everything said on a pull request, inline comments with where they are', () => {
    const text = prText({ title: 'Receipts', body: 'Every beat', comments: [{ body: 'QA passed' }], reviews: [{ body: '' }] }, [{ path: 'a.ts', line: 3, body: 'off by one' }]);
    expect(text.split('\n')).toEqual(['Receipts', 'Every beat', 'QA passed', 'a.ts:3', 'off by one']);
  });
});
