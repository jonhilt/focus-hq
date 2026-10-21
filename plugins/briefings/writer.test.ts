import { describe, expect, it } from 'vitest';
import type { Agent, LeadToolContext, PluginHost, PluginState, ReadOnlyRun } from '../../plugin-api/server';
import { type BriefingsState, freshBriefings } from './shared';
import type { Sources } from './sources';
import { opsWriter, spentSoFar, writerAsk, writerPrompt } from './writer';

describe('the writer’s prompt', () => {
  const lead = (dirs: string[]) => ({ agent: { id: 'l1', name: 'Lt. Castellanos' } as Agent, checkouts: dirs.map((dir) => ({ repo: `jonhilt/${dir.split('/').at(-1)}`, dir })) }) as unknown as LeadToolContext;
  const brief = { id: 'judge', title: 'The judge', brief: 'Explain the backtest.' };
  const said = ['one', 'two', 'three', 'four'].map((text) => ({ text, at: '09:44' }));

  it('gives the brief, the lead’s last three messages to quote, and where their code is', () => {
    const prompt = writerPrompt(lead(['/w/focus']), brief, said);
    expect(prompt).toContain('Lt. Castellanos asks you for a briefing titled "The judge":\n\nExplain the backtest.');
    expect(prompt).toContain('[09:44]\ntwo');
    expect(prompt).not.toContain('one');
    expect(prompt).toContain("give a file ref's path from there");
  });

  it('asks for the repo’s folder first when the goal has more than one', () => {
    expect(writerPrompt(lead(['/w/focus', '/w/site']), brief, [])).toContain('(focus, site): give a file ref\'s path with its repo\'s folder first');
  });
});

describe('what the writer is asked', () => {
  it('is the brief the first time, and what to put right when it’s sent back', async () => {
    expect(await writerAsk(() => Promise.resolve('the brief'))).toBe('the brief');
    expect(await writerAsk(() => Promise.resolve('the brief'), { problems: ['beat 1: 36 isn’t in its quotes'], spent: { seconds: 1 } })).toMatch(/don't hold up yet:\nbeat 1: 36 isn’t in its quotes\n\nFix them/);
  });
});

describe('what a brief has taken so far', () => {
  it('adds this run’s seconds and cost to the runs before it', () => {
    expect(spentSoFar(30, 0.1)).toEqual({ seconds: 30, costUsd: 0.1 });
    expect(spentSoFar(30, 0.1, { seconds: 40, costUsd: 0.2 })).toEqual({ seconds: 70, costUsd: expect.closeTo(0.3) });
    expect(spentSoFar(30, 0.1, { seconds: 40 })).toEqual({ seconds: 70, costUsd: 0.1 });
  });

  it('keeps the earlier cost when this run doesn’t say what it cost', () => {
    expect(spentSoFar(30, undefined)).toEqual({ seconds: 30, costUsd: undefined });
    expect(spentSoFar(30, undefined, { seconds: 40, costUsd: 0.2 })).toEqual({ seconds: 70, costUsd: 0.2 });
  });
});

describe('Ops’ writer', () => {
  const lead = { agent: { id: 'l1', name: 'Lt. Castellanos' } as Agent, checkouts: [{ repo: 'jonhilt/focus', dir: '/w/focus' }, { repo: 'jonhilt/site', dir: '/w/site' }] } as unknown as LeadToolContext;
  const brief = { id: 'judge', title: 'The judge', brief: 'Explain the backtest.' };
  const written = { beats: [{ title: 'One', text: 'It runs.', seconds: 4 }, { title: 'Two', text: 'It stops.', seconds: 4 }], stage: { html: '<div></div>', script: 'function render(t) {}' } };
  const sources = { said: () => Promise.resolve([{ text: 'We backtested it.', at: '09:44' }]) } as unknown as Sources;

  function ops(replies: { structured: unknown; costUsd?: number }[], writer = freshBriefings().writer) {
    const runs: ReadOnlyRun[] = [];
    let saved: BriefingsState = { ...freshBriefings(), writer };
    const state: PluginState<BriefingsState> = { get: () => saved, set: (patch) => (saved = { ...saved, ...patch }) };
    const host = {
      settings: () => ({ model: 'claude-opus-5-5', leadEffort: 'high' }),
      dataDir: () => '/data',
      readOnlySession: (run: ReadOnlyRun) => {
        runs.push(run);
        return Promise.resolve({ text: '', sessionId: `s${runs.length}`, ...replies[runs.length - 1] });
      },
    } as unknown as PluginHost;
    return { write: opsWriter(host, state, sources), runs, last: () => saved.last };
  }

  it('writes the brief up in a session on the captain’s setting, reading the lead’s code, and notes what it cost', async () => {
    const { write, runs, last } = ops([{ structured: written, costUsd: 0.3 }], { model: '', effort: 'low', fast: true });
    const got = await write(lead, brief);
    expect(runs[0]).toMatchObject({ cwd: '/w/focus', readable: ['/w/site'], model: 'claude-opus-5-5', effort: 'low', fast: true, resume: undefined });
    expect(runs[0]?.prompt).toContain('[09:44]\nWe backtested it.');
    expect(runs[0]?.schema).not.toHaveProperty('$schema');
    expect(got).toMatchObject({ input: { id: 'judge', title: 'The judge', ...written }, sessionId: 's1', model: 'claude-opus-5-5', effort: 'low', fast: true, costUsd: 0.3 });
    expect(last()).toMatchObject({ model: 'claude-opus-5-5', effort: 'low', fast: true, costUsd: 0.3 });
  });

  it('sends the same session back with what to fix, adding to what the brief has taken', async () => {
    const { write, runs, last } = ops([{ structured: written, costUsd: 0.2 }]);
    const got = await write(lead, brief, { sessionId: 's0', problems: ['beat 1: 36 isn’t in its quotes'], spent: { seconds: 60, costUsd: 0.3 } });
    expect(runs[0]).toMatchObject({ resume: 's0', effort: 'high', fast: false });
    expect(runs[0]?.prompt).toMatch(/^Ops checked your explainer/);
    expect(got.seconds).toBeGreaterThanOrEqual(60);
    expect(got.costUsd).toBeCloseTo(0.5);
    expect(last()?.costUsd).toBeCloseTo(0.5);
  });

  it('runs in its own folder when the lead has no checkout, and leaves the cost out when the session doesn’t say', async () => {
    const { write, runs } = ops([{ structured: written }]);
    const got = await write({ ...lead, checkouts: [] }, brief);
    expect(runs[0]).toMatchObject({ cwd: '/data', readable: [] });
    expect(got.costUsd).toBeUndefined();
  });

  it('refuses a reply that isn’t an explainer', async () => {
    const { write } = ops([{ structured: { beats: [] } }]);
    await expect(write(lead, brief)).rejects.toThrow();
  });
});
