import type { Friction, LedgerEntry, LedgerEvent, SessionFacts } from '../shared/ledger';

const HOUR = 3_600_000;

const facts = (minutes: number, costUsd: number, f: Partial<SessionFacts> = {}): SessionFacts => ({
  minutes, turns: minutes * 2, toolCalls: minutes, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, costUsd,
  captainMessages: 0, nudges: 0, officeMessages: 1, compactions: 0, qaFails: 0, conflicts: 0, ...f,
});

const PORT_IN_USE: Friction = { kind: 'demo-env', signature: 'demo port in use', quote: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:4477' };

/**
 * A few days of the ledger for the demo office, which keeps none of its own: a Sock Shop goal whose API pull request
 * failed QA once, conflicted and passed, and a Space Dodger pull request an agent untangled and the captain merged
 * before QA was done. Every session's frictions are already read, so nothing in the demo goes looking for them.
 */
export function demoLedger(shopId: string, gameId: string, now: number): LedgerEvent[] {
  const checkout = 'Checkout remembers your address';
  const api = { repo: 'demo/webshop-api', pr: 12, goal: checkout };
  const web = { repo: 'demo/webshop-frontend', pr: 8, goal: checkout };
  const split = { repo: 'demo/space-dodger', pr: 5, goal: 'Asteroids split in two when shot' };
  const session = (key: string, agent: string, task: 'lead' | 'review' | 'conflicts', pr: { repo: string; pr: number; goal: string }, f: SessionFacts): LedgerEntry => ({
    kind: 'session-digest', key, sessionId: key, agentId: `demo_${key}`, agent, task, prs: [{ repo: pr.repo, pr: pr.pr }], goal: pr.goal, toUuid: key, facts: f,
  });
  const read = (key: string, frictions: Friction[] = []): LedgerEntry => ({ kind: 'session-frictions', key, sessionId: key, reader: 'retro', frictions });
  const lines: [hoursAgo: number, projectId: string, LedgerEntry][] = [
    [74, shopId, session('demo-s1', 'Lt. Nakamura', 'lead', api, facts(42, 2.8, { wastedCalls: 4, nudges: 1, captainMessages: 3 }))],
    [73.5, shopId, { kind: 'qa-verdict', ...api, verdict: 'fail', reviewer: 'Lt. Castellanos', checks: { pass: 5, fail: 2, skip: 0 }, failedRounds: 1 }],
    [73.5, shopId, session('demo-s2', 'Lt. Castellanos', 'review', api, facts(7, 0.65))],
    [72, shopId, { kind: 'conflicts', ...api, resolved: 'office', files: ['src/routes/checkout.ts'] }],
    [71, shopId, session('demo-s3', 'Lt. Nakamura', 'lead', api, facts(18, 1.1, { wastedCalls: 2 }))],
    [70.5, shopId, { kind: 'qa-verdict', ...api, verdict: 'pass', reviewer: 'Lt. Castellanos', checks: { pass: 7, fail: 0, skip: 0 }, failedRounds: 1 }],
    [70.4, shopId, { kind: 'merged', ...api, by: 'office', qa: 'passed', failedRounds: 1, triages: 0 }],
    [50, shopId, { kind: 'qa-verdict', ...web, verdict: 'pass', reviewer: 'Lt. Castellanos', checks: { pass: 6, fail: 0, skip: 1 }, failedRounds: 0 }],
    [49, shopId, { kind: 'merged', ...web, by: 'captain', qa: 'passed', failedRounds: 0, triages: 0 }],
    [48, shopId, { kind: 'goal-closed', goal: { id: 'demo_goal_checkout', title: checkout, slices: 2, prs: [], leadName: 'Lt. Nakamura', openedAt: now - 80 * HOUR, closedAt: now - 48 * HOUR } }],
    [30, gameId, session('demo-s4', 'Lt. Okafor', 'lead', split, facts(30, 1.9))],
    [28, gameId, { kind: 'conflicts', ...split, resolved: 'agent', files: ['src/game.ts', 'src/asteroid.ts'] }],
    [27.5, gameId, session('demo-s5', 'Ensign Moreau', 'conflicts', split, facts(9, 0.7, { wastedCalls: 3 }))],
    [26, gameId, { kind: 'merged', ...split, by: 'captain', qa: 'testing', failedRounds: 0, triages: 0 }],
    [20, shopId, read('demo-s1', [PORT_IN_USE])],
    [20, shopId, read('demo-s2')],
    [20, shopId, read('demo-s3', [PORT_IN_USE])],
    [20, gameId, read('demo-s4')],
    [20, gameId, read('demo-s5')],
    [19, shopId, { kind: 'retro-decision', title: 'Give agents a demo office that owns its port', signatures: ['demo-env: demo port in use'], accepted: true, issue: { repo: 'demo/webshop-api', number: 30 } }],
  ];
  return lines.map(([hoursAgo, projectId, entry], i) => ({ ...entry, at: now - hoursAgo * HOUR, projectId, seq: i + 1 }));
}
