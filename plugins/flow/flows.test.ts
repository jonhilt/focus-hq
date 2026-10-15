import { describe, expect, it } from 'vitest';
import type { Agent, LedgerEvent } from '../../plugin-api/server';
import { office, until } from '../../plugin-api/testing';
import flowPlugin from './server';
import { goalMoved, withFlow, withoutClosed } from './flows';
import { FLOW, type FlowPluginState, type LeadFlow } from './shared';

/** The pretend office with the flow plugin switched on: each open goal's flow, as the browser has it. */
function flowing(o = office()) {
  o.agents.startPlugins([flowPlugin], { demo: false, ownRepo: () => undefined });
  return { ...o, flowOf: (id: string) => (o.agents.plugins.stateOf(FLOW) as FlowPluginState | undefined)?.leads[id] };
}

/** A lead's transcript, a line a second from when its goal opened: `[seconds, type, content]`. */
const transcript = (opened: number, lines: [number, 'user' | 'assistant', unknown][]) =>
  lines.map(([s, type, content]) => JSON.stringify({ type, timestamp: new Date(opened + s * 1000).toISOString(), message: { content } })).join('\n');

const OPENING = 'Your workspace, with every repo of the project checked out side by side: …';

/** Starts a goal whose lead opened it a minute ago. */
async function goal(o: ReturnType<typeof flowing>) {
  const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
  await until(() => o.claude.turns.length === 1);
  const lead = o.store.agent(agent.id);
  lead.startedAt -= 60_000;
  return { id: agent.id, opened: lead.startedAt };
}

describe('the flow plugin', () => {
  it('works out where the goal’s time has gone as its lead’s turn ends, for its screens', async () => {
    const o = flowing();
    const { id, opened } = await goal(o);
    o.agents.readTranscript = () => Promise.resolve(transcript(opened, [
      [0, 'user', OPENING],
      [20, 'assistant', [{ type: 'text', text: 'I’d start with a thin slice end to end. Shall I go ahead?' }]],
    ]));
    o.claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => o.flowOf(id)?.now.state === 'captain');
    expect(o.flowOf(id)?.now).toEqual({ state: 'captain', since: opened + 20_000, reason: 'go-ahead' });
    expect(o.flowOf(id)?.active.working).toBe(20_000);
  });

  it('moves the goal on as QA gives its verdicts and a pull request of its slice lands', async () => {
    const o = flowing();
    const { id, opened } = await goal(o);
    await o.claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [web, api] = o.store.agent(id).lead!.prs;
    o.agents.readTranscript = () => Promise.resolve(transcript(opened, [
      [0, 'user', OPENING],
      [10, 'assistant', [{ type: 'tool_use', id: 'ship1', name: 'mcp__office__ship', input: {} }]],
      [20, 'user', [{ type: 'tool_result', tool_use_id: 'ship1', content: `Opened ${web.repo}#${web.number} and ${api.repo}#${api.number}` }]],
      [25, 'assistant', [{ type: 'text', text: 'Shipped the first slice.' }]],
    ]));
    o.claude.turns[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => o.flowOf(id)?.now.state === 'qa');

    const verdict = (pr: typeof web, v: 'pass' | 'fail') => o.agents.record(o.project.id, { kind: 'qa-verdict', repo: pr.repo, pr: pr.number, verdict: v, reviewer: 'Lt. Q', checks: { pass: 1, fail: 0, skip: 0 }, failedRounds: 0 });
    verdict(web, 'pass');
    verdict(api, 'fail');
    await until(() => o.flowOf(id)?.now.state === 'captain');
    expect(o.flowOf(id)?.now.reason).toBe('qa-failed');

    // the captain closes the one QA failed: what's left waits for their merge
    o.agents.prClosed(api.repo, api.number, false, 'captain');
    await until(() => o.flowOf(id)?.now.state === 'review');
  });

  it('works out every open goal’s flow as the office starts', async () => {
    const o = office();
    const { agent } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => o.claude.turns.length === 1);
    o.claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => o.store.agent(agent.id).status === 'done');
    const lead = o.store.agent(agent.id);
    lead.startedAt -= 60_000;
    o.agents.readTranscript = () => Promise.resolve(transcript(lead.startedAt, [[0, 'user', OPENING], [20, 'assistant', [{ type: 'text', text: 'Shall I go ahead?' }]]]));
    const f = flowing(o);
    await until(() => !!f.flowOf(agent.id));
    expect(f.flowOf(agent.id)?.now).toEqual({ state: 'captain', since: lead.startedAt + 20_000, reason: 'go-ahead' });
  });
});

describe('goalMoved', () => {
  const lead = { id: 'lead_1', task: 'lead', lead: { prs: [{ repo: 'o/web', number: 4 }] } } as Agent;
  const event = (kind: string, pr = 4) => ({ kind, repo: 'o/web', pr, at: 1, projectId: 'p', seq: 1 }) as LedgerEvent;

  it('finds the goal a verdict or landing in the ledger moves on, by its pull request', () => {
    expect(goalMoved(event('qa-verdict'), [lead])).toBe('lead_1');
    expect(goalMoved(event('merged'), [lead])).toBe('lead_1');
    expect(goalMoved(event('closed'), [lead])).toBe('lead_1');
  });

  it('leaves alone what doesn’t move a goal, and pull requests that aren’t a goal’s', () => {
    expect(goalMoved(event('conflicts'), [lead])).toBeUndefined();
    expect(goalMoved(event('qa-verdict', 5), [lead])).toBeUndefined();
    expect(goalMoved(event('qa-verdict'), [{ ...lead, task: 'issue', lead: undefined }])).toBeUndefined();
  });
});

describe('withFlow', () => {
  const flow = (at: number): LeadFlow => ({ at, now: { state: 'qa', since: at }, active: { queued: 0, working: at, rework: 0, background: 0, qa: 0, review: 0, captain: 0 } });

  it('puts the goal’s new flow in, and leaves out goals that have closed', () => {
    expect(withFlow({ a: flow(1), b: flow(2) }, 'a', flow(3), (id) => id !== 'b')).toEqual({ a: flow(3) });
    expect(withFlow({ a: flow(1) }, 'c', flow(3), () => true)).toEqual({ a: flow(1), c: flow(3) });
  });
});

describe('withoutClosed', () => {
  const flow = (at: number): LeadFlow => ({ at, now: { state: 'qa', since: at }, active: { queued: 0, working: at, rework: 0, background: 0, qa: 0, review: 0, captain: 0 } });

  it('leaves out goals that have closed, and says so only when one has', () => {
    expect(withoutClosed({ a: flow(1), b: flow(2) }, (id) => id !== 'b')).toEqual({ a: flow(1) });
    expect(withoutClosed({ a: flow(1) }, () => true)).toBeUndefined();
    expect(withoutClosed({}, () => false)).toBeUndefined();
  });
});
