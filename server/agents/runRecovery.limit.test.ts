import { describe, expect, it, vi } from 'vitest';
import { keyFallback } from './apiKey';
import { focus, restarted, until } from './fakeFocus';

// Ops falls back on an API key while the plan's usage limit is reached; the limit hit here lasts the whole file,
// so it has a file of its own
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.FOCUS_USE_API_KEY = 'fallback';
});

describe('a hold for the plan’s limit', () => {
  it('outlives a clean shutdown and restart, and the captain’s own stop still lets it go', async () => {
    const before = focus();
    const { agent: lead } = before.agents.startGoal(before.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => before.claude.turns.length === 1);
    // a long conversation the limit stops: picking it up on the key would cost too much, so they're held
    before.claude.turns[0].hooks.context?.({ percent: 60, tokens: 600_000, max: 1_000_000 });
    keyFallback.limitHit(Date.now() + 60 * 60_000);
    before.claude.turns[0].end({ ok: false, summary: '', limited: true, started: true });
    await until(() => !!before.store.agent(lead.id).held);
    const heldUntil = before.store.agent(lead.id).held?.until;

    // Ctrl-C or an update: Focus stops everyone, but that isn't the captain letting the hold go
    before.agents.shutDown();
    expect(before.store.run(lead.id).phase).toBe('held');

    const after = restarted(before.store);
    expect(before.store.agent(lead.id).held).toBeUndefined();
    after.agents.recover();
    expect(before.store.agent(lead.id)).toMatchObject({ held: { until: heldUntil }, run: { phase: 'held' } });
    expect(after.claude.turns).toHaveLength(0);

    after.agents.stop(lead.id);
    expect(before.store.agent(lead.id).held).toBeUndefined();
    expect(before.store.run(lead.id).phase).toBe('idle');
  });
});
