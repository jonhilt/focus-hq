import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import type { Issue, PluginHost } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, type Later, office, type Running, type Subject } from '../../plugin-api/testing';
import { ChiefEngineer } from './engineer';
import { freshRetro, RETRO, type Retro } from './shared';

// The chief engineer under the office's two rules (docs/invariants.md): a restart is atomic, and two decisions at once
// end as one after the other would. It's described here (what it can do, what must survive), not told what to expect.

const facts = { minutes: 1, turns: 1, toolCalls: 1, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0 };
const drafted = {
  summary: 'Ports.',
  drafts: [
    { groups: ['G1'], title: 'Give each workspace its own demo port', body: 'It keeps happening.\n\n## Done when\nNo clash.', kind: 'check', measure: '3 sessions' },
    { groups: ['G1'], title: 'Name the port in the error', body: 'Say which.\n\n## Done when\nIt does.', kind: 'check', measure: '3 sessions' },
  ],
};

interface Kept {
  drafts: { title: string; accepted?: boolean; issue?: number }[];
  filed: string[];
  ledger: { title: string; accepted: boolean }[];
}

/** A chief engineer with a finished retro of two drafts, filing on a GitHub whose answers wait on `later`. */
const engineer: Subject<Kept> = {
  name: 'retro',
  start: async (later) => {
    const o = office();
    for (const s of ['a', 'b', 'c']) {
      o.store.record({
        kind: 'session-digest', key: `${s}:u`, sessionId: s, agentId: s, agent: `Ens. ${s}`, task: 'issue', prs: [], toUuid: 'u', facts,
        frictions: [{ kind: 'demo-env' as const, signature: 'demo port in use', quote: `EADDRINUSE in ${s}` }], at: Date.now() - 60_000, projectId: o.project.id,
      });
    }
    const filed: string[] = [];
    let host: PluginHost | undefined;
    let fileLater: Later = later;
    o.agents.startPlugins([{ id: RETRO, start: (h) => ((host = h), {}) }], {
      demo: false,
      ownRepo: () => undefined,
      fileIssue: (_projectId, repo, title, body) =>
        fileLater('github', () => {
          filed.push(title);
          return Promise.resolve<Issue>({ repo, number: filed.length, title, body, url: '', labels: [], createdAt: '' });
        }),
    });
    const lent = host as PluginHost;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retros-'));
    const officer = { read: () => Promise.resolve({ structured: { spans: [] }, costUsd: 0 }), retro: () => Promise.resolve({ structured: drafted, text: '', costUsd: 0 }) };
    const life = (): Running<Kept> => {
      const eng = new ChiefEngineer(lent, lent.state<Retro>(freshRetro), officer, dir, 0);
      return {
        actions: () =>
          eng.current().drafts.flatMap((d, i) => [
            { name: `accept draft ${i + 1}`, run: () => eng.decide(d.id, true, o.project.id, 'demo/webshop-api') },
            { name: `reject draft ${i + 1}`, run: () => eng.decide(d.id, false, o.project.id) },
          ]),
        durable: () => ({
          drafts: eng.current().drafts.map((d) => ({ title: d.title, ...(d.decision && { accepted: d.decision.accepted, issue: d.decision.issue?.number }) })),
          filed: [...filed],
          ledger: o.store.ledger.flatMap((e) => (e.kind === 'retro-decision' ? [{ title: e.title, accepted: e.accepted }] : [])),
        }),
        settle: () => Promise.resolve(),
        restart: (l) => ((fileLater = l), life()),
      };
    };
    const first = new ChiefEngineer(lent, lent.state<Retro>(freshRetro), officer, dir, 0);
    first.start(14);
    for (let i = 0; i < 200 && first.current().status !== 'done'; i++) await new Promise((r) => setTimeout(r, 5));
    return life();
  },
};

describe('the chief engineer, under the office’s two rules', () => {
  it('ends a restart as if a decision had never started, or had finished', async () => {
    await checkRestart(engineer, { runs: 15 });
  });

  it('ends two decisions at once as one after the other would', async () => {
    await checkAtOnce(engineer, { runs: 15 });
  });
});
