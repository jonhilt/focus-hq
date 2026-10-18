import { describe, expect, it } from 'vitest';
import { prKey } from '../../shared/qa';
import { demoWorkspace } from './demoRunner';
import { office, until } from './fakeOffice';
import type { CommandRun } from './qaProof';
import type { Triager } from './triage';
import type { WorkspaceOps } from './types';

// What the office does about a pull request QA fails: back to the developer who opened it, or a fixer of its own; and
// once it's stuck, the room's operations officer looks at it and does one thing. Driven through the office, from a
// developer's delivered PR to QA's verdict.

/** The demo's checkouts, where QA's proof test fails on an assertion when the office runs it (`runs` says what it ran, and where). */
const proving = (run: CommandRun = { code: 1, output: 'AssertionError: expected "light" to be "dark"\n Tests  1 failed (1)' }, runs: { dir: string; args: string[] }[] = []): WorkspaceOps => ({
  ...demoWorkspace,
  changedFiles: () => Promise.resolve([]),
  runIn: (dir, args) => (runs.push({ dir, args }), Promise.resolve(run)),
  readIn: (_dir, file) => Promise.resolve(file === PROOF ? 'it("switches to dark", () => expect(theme()).toBe("dark"))' : undefined),
});
const workspace = proving();
const PROOF = 'src/toggle.proof.test.ts';
const fail = {
  verdict: 'fail',
  summary: 'The toggle does nothing.',
  checks: [{ name: 'Toggle', result: 'fail', detail: 'Nothing changes' }],
  commands: [],
  files: [],
  fixInstructions: 'Wire the toggle to the theme.',
  proofs: [{ kind: 'test', finding: 'The toggle doesn’t switch the theme', file: PROOF, command: `npx vitest run ${PROOF}` }],
};
const issue = { number: 1, title: 'Add a dark mode toggle to the header' };

/** A developer's PR, delivered, and QA failing it: the office, the developer and the PR's key. */
async function failedPr(triager?: Triager, before?: (o: ReturnType<typeof office>, dev: string) => Promise<void>, ops = workspace, report: object = fail, verdict = 'failed') {
  const o = office(ops, undefined, triager);
  const { id: dev } = o.agents.hire(o.project.id, 'demo/webshop-frontend', issue);
  await until(() => o.claude.turns.length === 1);
  o.claude.turns[0].end({ ok: true, summary: 'Dark mode' });
  await until(() => o.store.agent(dev).status === 'done' && !!o.store.agent(dev).pr);
  const pr = o.store.agent(dev).pr!.number;
  const key = prKey('demo/webshop-frontend', pr);
  const qa = () => o.claude.turns.find((t) => t.req.agentId.startsWith('qa_'));
  await until(() => !!qa());
  await before?.(o, dev);
  qa()!.end({ ok: true, summary: '', structured: report });
  await until(() => o.store.reviews.get(key)?.status === verdict);
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

describe('QA’s proof', () => {
  /** The verdict's comment, as the office posted it. */
  const comment = (o: { store: { reviewEntries: (key: string) => { kind: string }[] } }, key: string) =>
    o.store.reviewEntries(key).flatMap((e) => (e.kind === 'reported' && 'body' in e && typeof e.body === 'string' ? [e.body] : [])).at(-1) ?? '';

  it('blocks a PR only when the office runs QA’s proof test in QA’s checkout and it fails, and hands the test to the developer to keep', async () => {
    const runs: { dir: string; args: string[] }[] = [];
    const o = await failedPr(undefined, undefined, proving(undefined, runs));
    expect(runs).toEqual([{ dir: expect.stringContaining('qa_'), args: ['npx', 'vitest', 'run', PROOF] }]);
    expect(o.store.reviews.get(o.key)?.report).toMatchObject({ verdict: 'fail', proofs: [{ outcome: 'failed', source: expect.stringContaining('switches to dark') }] });
    expect(comment(o, o.key)).toContain('QA report: ❌ Failed');
    expect(comment(o, o.key)).toMatch(/### 🧪 Proof[\s\S]*❌ \| The toggle doesn’t switch the theme/);
    const fixTurn = () => o.claude.turns.filter((t) => t.req.agentId === o.dev)[1];
    await until(() => !!fixTurn());
    expect(fixTurn().req.prompt).toContain('it("switches to dark", () => expect(theme()).toBe("dark"))');
    expect(fixTurn().req.prompt).toContain('drop the `.proof`');
  });

  it('posts a fail whose proof passes when the office runs it as advice: a pass, not sent back', async () => {
    const o = await failedPr(undefined, undefined, proving({ code: 0, output: ' Tests  1 passed (1)' }), fail, 'passed');
    expect(o.store.reviews.get(o.key)?.report).toMatchObject({ verdict: 'pass', advisory: true, fixInstructions: 'Wire the toggle to the theme.', proofs: [{ outcome: 'passed' }] });
    expect(comment(o, o.key)).toContain('QA report: ✅ Passed with advice');
    expect(comment(o, o.key)).toContain('### 💡 Advice (not proved)');
    expect(o.store.ledger).toContainEqual(expect.objectContaining({ kind: 'qa-verdict', verdict: 'pass' }));
    // nobody is sent to fix it
    await new Promise((r) => setTimeout(r, 50));
    expect(o.store.reviews.get(o.key)?.followUp).toBeUndefined();
    expect(o.claude.turns.filter((t) => t.req.agentId === o.dev)).toHaveLength(1);
  });

  it('posts a fail that names no proof as advice, running nothing', async () => {
    const runs: { dir: string; args: string[] }[] = [];
    const { proofs: _none, ...unproved } = fail;
    const o = await failedPr(undefined, undefined, proving(undefined, runs), unproved, 'passed');
    expect(runs).toEqual([]);
    expect(o.store.reviews.get(o.key)?.report).toMatchObject({ verdict: 'pass', advisory: true });
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
