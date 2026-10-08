import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Hub } from '../hub';
import { Store } from '../store';
import { ChiefEngineer, type RetroRequest } from './engineer';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function engineer(structured: unknown, sessions: string[]) {
  const store = new Store(false);
  for (const s of sessions) {
    store.record({
      kind: 'session-digest', key: `${s}:u`, sessionId: s, agentId: s, agent: `Ens. ${s}`, task: 'issue', prs: [], toUuid: 'u',
      facts: { minutes: 1, turns: 1, toolCalls: 1, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0 },
      frictions: [{ kind: 'demo-env', signature: 'demo port in use', quote: `EADDRINUSE in ${s}` }],
      at: Date.now() - 60_000, projectId: 'p',
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retros-'));
  dirs.push(dir);
  const asked: RetroRequest[] = [];
  const officer = { retro: (req: RetroRequest) => (asked.push(req), Promise.resolve({ structured, text: '', costUsd: 0.03 })) };
  return { store, asked, eng: new ChiefEngineer(store, { send: () => undefined } as unknown as Hub, officer, dir) };
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

  it('doesn’t trouble the engineer when nothing came up three times, and watches what came up twice', async () => {
    const { eng, asked } = engineer(drafted, ['a', 'b']);
    eng.start(14);
    const retro = await finished(eng);
    expect(retro).toMatchObject({ status: 'done', activity: 'Nothing keeps coming back', drafts: [], watch: ['demo-env: demo port in use (2 sessions)'] });
    expect(asked).toHaveLength(0);
  });
});
