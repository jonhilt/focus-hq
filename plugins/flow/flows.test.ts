import { describe, expect, it } from 'vitest';
import { focus, leadOpensPrs, until } from '../../plugin-api/testing';
import flowPlugin from './server';
import { FLOW, type FlowPluginState } from './shared';

/** The pretend Focus with the flow plugin switched on: each open goal's flow, as the browser has it. */
function flowing(o = focus()) {
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
    await leadOpensPrs(o, id, 'Saved items, first slice');
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

  it('works out every open goal’s flow as Focus starts', async () => {
    const o = focus();
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
