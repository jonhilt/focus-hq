import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../../shared/ledger';
import type { Hub } from '../hub';
import { Store } from '../store';
import { ChiefEngineer, type RetroRequest } from './engineer';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const facts = { minutes: 1, turns: 1, toolCalls: 1, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0 };

/** `read: true`: the digests haven't been read for frictions, and their transcripts say what the reader will find. */
function engineer(structured: unknown, sessions: string[], opts: { unread?: boolean; missing?: string[] } = {}) {
  const store = new Store(false);
  for (const s of sessions) {
    store.record({
      kind: 'session-digest', key: `${s}:u`, sessionId: s, agentId: s, agent: `Ens. ${s}`, task: 'issue', prs: [], toUuid: 'u', facts,
      ...(!opts.unread && { frictions: [{ kind: 'demo-env' as const, signature: 'demo port in use', quote: `EADDRINUSE in ${s}` }] }),
      at: Date.now() - 60_000, projectId: 'p',
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retros-'));
  dirs.push(dir);
  const asked: RetroRequest[] = [];
  const prompts: string[] = [];
  const officer = {
    read: ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      const spans = [...prompt.matchAll(/<span id="([^"]+)">\n([\s\S]*?)\n<\/span>/g)].map(([, id, text]) => ({ id, frictions: [{ kind: 'demo-env', signature: 'demo port in use', quote: /EADDRINUSE in \w+/.exec(text)![0] }] }));
      return Promise.resolve({ structured: { spans }, costUsd: 0.5 });
    },
    retro: (req: RetroRequest) => (asked.push(req), Promise.resolve({ structured, text: '', costUsd: 0.03 })),
  };
  const transcript = (s: string) => JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-10-08T12:00:00.000Z', message: { content: `[Office] Error: listen EADDRINUSE in ${s}` } });
  const sources = {
    readTranscript: (id: string) => Promise.resolve(opts.missing?.includes(id) ? undefined : transcript(id)),
    record: (projectId: string, entry: LedgerEntry, at?: number) => void store.record({ ...entry, projectId, at: at ?? Date.now() }),
    pauseMs: 0,
  };
  return { store, asked, prompts, eng: new ChiefEngineer(store, { send: () => undefined } as unknown as Hub, officer, dir, sources) };
}

async function finished(eng: ChiefEngineer) {
  for (let i = 0; i < 200 && (eng.current().status === 'gathering' || eng.current().status === 'thinking'); i++) await new Promise((r) => setTimeout(r, 5));
  return eng.current();
}

describe('ChiefEngineer', () => {
  const drafted = { summary: 'Ports.', drafts: [{ groups: ['G1'], title: 'Give each workspace its own demo port', body: 'It keeps happening.\n\n## What to build\nA port each.\n\n## Done when\nNo clash.', kind: 'check', measure: '3 sessions' }] };

  it('drafts from the frictions that came up in three sessions, and notes the captain’s decision', async () => {
    const { eng, asked } = engineer(drafted, ['a', 'b', 'c']);
    eng.start(14);
    const retro = await finished(eng);
    expect(retro).toMatchObject({ status: 'done', sessions: 3, costUsd: 0.03, drafts: [{ title: 'Give each workspace its own demo port', signatures: ['demo-env: demo port in use'], sessions: 3 }] });
    expect(retro.drafts[0].body).toContain('## Evidence\n**demo-env: demo port in use**, in 3 sessions:');
    expect(fs.readFileSync(path.join(asked[0].cwd, 'frictions.md'), 'utf8')).toContain('## G1: demo-env: demo port in use (3 sessions)');
    const done = eng.decided(retro.drafts[0].id, { accepted: false, at: 1 });
    expect(done.decision).toEqual({ accepted: false, at: 1 });
    expect(() => eng.decided(retro.drafts[0].id, { accepted: true, at: 2 })).toThrow('already rejected');
  });

  it('reads the sessions no one has read yet, once, and drafts from what it found', async () => {
    const { eng, store, prompts, asked } = engineer(drafted, ['a', 'b', 'c', 'd'], { unread: true, missing: ['d'] });
    expect(eng.preview(14)).toEqual({ unread: 4, costUsd: 0.1 });
    eng.start(14);
    const retro = await finished(eng);
    expect(prompts).toHaveLength(1);
    expect(retro).toMatchObject({ status: 'done', costUsd: 0.53, drafts: [{ signatures: ['demo-env: demo port in use'], sessions: 3 }] });
    expect(asked).toHaveLength(1);
    const read = store.ledger.filter((e) => e.kind === 'session-frictions');
    expect(read.map((e) => [e.sessionId, 'missing' in e && e.missing === true])).toEqual([['d', true], ['a', false], ['b', false], ['c', false]]);
    expect(eng.preview(14)).toEqual({ unread: 0, costUsd: 0 });
    eng.start(14);
    await finished(eng);
    expect(prompts).toHaveLength(1);
  });

  it('doesn’t trouble the engineer when nothing came up three times, and watches what came up twice', async () => {
    const { eng, asked } = engineer(drafted, ['a', 'b']);
    eng.start(14);
    const retro = await finished(eng);
    expect(retro).toMatchObject({ status: 'done', activity: 'Nothing keeps coming back', drafts: [], watch: ['demo-env: demo port in use (2 sessions)'] });
    expect(asked).toHaveLength(0);
  });
});
