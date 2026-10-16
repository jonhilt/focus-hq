import { describe, expect, it } from 'vitest';
import { prKey } from '../../shared/qa';
import { demoWorkspace } from './demoRunner';
import { office, until } from './fakeOffice';
import type { Triager } from './triage';

// What the office does about a pull request QA fails: back to the developer who opened it, or a fixer of its own; and
// once it's stuck, the room's operations officer looks at it and does one thing. Driven through the office, from a
// developer's delivered PR to QA's verdict.

const workspace = { ...demoWorkspace, changedFiles: () => Promise.resolve([]) };
const fail = { verdict: 'fail', summary: 'The toggle does nothing.', checks: [{ name: 'Toggle', result: 'fail', detail: 'Nothing changes' }], commands: [], files: [], fixInstructions: 'Wire the toggle to the theme.' };
const issue = { number: 1, title: 'Add a dark mode toggle to the header' };

/** A developer's PR, delivered, and QA failing it: the office, the developer and the PR's key. */
async function failedPr(triager?: Triager, before?: (o: ReturnType<typeof office>, dev: string) => Promise<void>) {
  const o = office(workspace, undefined, triager);
  const { id: dev } = o.agents.hire(o.project.id, 'demo/webshop-frontend', issue);
  await until(() => o.claude.turns.length === 1);
  o.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
  await until(() => o.store.agent(dev).status === 'done' && !!o.store.agent(dev).pr);
  const pr = o.store.agent(dev).pr!.number;
  const key = prKey('demo/webshop-frontend', pr);
  const qa = () => o.claude.turns.find((t) => t.req.agentId.startsWith('qa_'));
  await until(() => !!qa());
  await before?.(o, dev);
  qa()!.end({ ok: true, summary: '', structured: fail });
  await until(() => o.store.reviews.get(key)?.status === 'failed');
  return { ...o, dev, key };
}

describe('a PR QA failed', () => {
  it('goes back to the developer who opened it, with QA’s findings', async () => {
    const { store, claude, dev, key } = await failedPr();
    await until(() => store.reviews.get(key)?.followUp?.kind === 'fixing');
    expect(store.reviews.get(key)?.followUp).toMatchObject({ kind: 'fixing', agentId: dev, fixes: { kind: 'qa' } });
    expect(store.reviewEntries(key)).toContainEqual(expect.objectContaining({ kind: 'follow-up', followUp: expect.objectContaining({ kind: 'fixing', agentId: dev }) }));
    const fixTurn = () => claude.turns.filter((t) => t.req.agentId === dev)[1];
    await until(() => !!fixTurn());
    expect(fixTurn().req.prompt).toContain('Wire the toggle to the theme.');
  });

  it('gets a fixer of its own when the developer’s gone home', async () => {
    const { store, dev, key } = await failedPr(undefined, (o, id) => o.agents.dismiss(id));
    await until(() => store.reviews.get(key)?.followUp?.kind === 'fixing');
    const fixer = store.reviews.get(key)?.followUp;
    expect(fixer?.kind === 'fixing' && fixer.agentId).not.toBe(dev);
    const agent = fixer?.kind === 'fixing' ? store.agent(fixer.agentId) : undefined;
    expect(agent).toMatchObject({ task: 'fix', repo: 'demo/webshop-frontend' });
  });
});

describe('a stuck PR', () => {
  /** QA fails the PR, it goes back to its developer, and their fix fails: it's stuck, and the officer looks. */
  async function stuck(triager?: Triager) {
    const o = await failedPr(triager);
    const fixTurn = () => o.claude.turns.filter((t) => t.req.agentId === o.dev)[1];
    await until(() => !!fixTurn());
    fixTurn().end({ ok: false, started: true, summary: '', error: 'The build broke' });
    return o;
  }

  it('goes back to QA when the operations officer says so, with why', async () => {
    const asked: string[] = [];
    const { store, key } = await stuck({
      triage: async (req, activity) => {
        asked.push(req.reason);
        activity('Reading the checks');
        return { action: 'retry-qa', note: 'QA tested a stale build' };
      },
    });
    await until(() => store.reviews.get(key)?.status === 'queued' || store.reviews.get(key)?.status === 'testing');
    expect(asked).toEqual([expect.stringContaining('hit a problem fixing it')]);
    expect(store.reviews.get(key)).toMatchObject({ triages: 1, triage: { action: 'retry-qa', note: 'QA tested a stale build' }, retryNote: expect.stringContaining('QA tested a stale build') });
    expect(store.reviews.get(key)?.followUp).toBeUndefined();
    const kinds = store.reviewEntries(key).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['triaging', 'triage-activity', 'triaged', 'requested']));
  });

  it('comes to you when the officer escalates it, or can’t work out what to do', async () => {
    const escalated = await stuck({ triage: async () => ({ action: 'escalate', note: 'The issue asks for two things at once' }) });
    await until(() => escalated.store.reviews.get(escalated.key)?.followUp?.kind === 'needs-you');
    expect(escalated.store.reviews.get(escalated.key)?.followUp).toEqual({ kind: 'needs-you', reason: expect.stringContaining('The issue asks for two things at once') });

    const lost = await stuck();
    await until(() => lost.store.reviews.get(lost.key)?.followUp?.kind === 'needs-you');
    expect(lost.store.reviews.get(lost.key)?.followUp).toEqual({ kind: 'needs-you', reason: expect.stringContaining('no officer here') });
  });
});
