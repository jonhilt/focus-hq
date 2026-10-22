import fs from 'node:fs';
import path from 'node:path';
import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { randomAvatar } from '../../shared/crew';
import * as demoGitHub from '../github/demo';
import { prKey } from '../../shared/qa';
import { openQuestion } from '../../shared/artifacts';
import { demoLayer } from '../github/demo';
import { GhServerError } from '../github/runner';
import { GitHub } from '../github/service';
import { Hub } from '../hub';
import type { PluginHost } from '../plugins/contract';
import { demoWorkspace } from './demoRunner';
import { focus, restarted, until } from './fakeFocus';
import type { AgentManager } from './manager';
import type { Agent, Issue, PullRequest, QaReport, Snapshot } from '../../shared/types';
import { AWAY_DESK } from '../../shared/types';
import type { WorkspaceOps } from './types';
import { CLOUD_UNAVAILABLE } from './cloud';
import { keyFallback } from './apiKey';
import { CARRY_ON_AFTER_LIMIT } from './manager/planLimit';
import { CARRYING_ON_HERE } from './manager/cloudMoves';

// Ops falls back on an API key while the plan's usage limit is reached (only the last tests reach it)
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.FOCUS_USE_API_KEY = 'fallback';
});

/** A plugin with one brief, worked away from the room, whose pull requests only the captain merges: what its hooks heard. */
function auditor(agents: AgentManager) {
  const heard: string[] = [];
  let lent: PluginHost | undefined;
  agents.startPlugins([{
    id: 'auditor',
    start: (host) => {
      lent = host;
      return {
        briefs: {
          audit: {
            label: 'Audit',
            icon: '🔎',
            away: true,
            assignment: 'You are the auditor.',
            summary: 'End with a title.',
            brief: (agent) => Effect.succeed(`Audit ${agent.repo}.`),
            pullRequest: (summary) => ({ title: summary.split('\n')[0].replace(/^# /, ''), body: summary }),
          },
        },
        prOpened: (_agent, pr) => void heard.push(`opened #${pr.number}`),
        prClosed: (_repo, number) => void heard.push(`closed #${number}`),
        captainMerges: (pr) => pr.branch.startsWith('focus/audit-'),
      };
    },
  }], { demo: false, ownRepo: () => undefined });
  return {
    heard,
    host: () => {
      if (!lent) throw new Error('The auditor didn’t start');
      return lent;
    },
  };
}

describe('AgentManager', () => {
  it('runs a goal’s lead one turn at a time, however often Ops schedules', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.prompt).toMatch(/^Your workspace, with every repo of the project checked out side by side:\n- \.\/webshop-frontend/);
    agents.schedule();
    agents.schedule();
    agents.message(lead.id, 'Also the header');
    expect(claude.turns).toHaveLength(1);
    expect(claude.turns[0].sent).toEqual(['Also the header']);

    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');
    // two messages before they're back at it: one turn, which hears both
    agents.message(lead.id, 'Go ahead');
    agents.schedule();
    agents.message(lead.id, 'Small slices, please');
    await until(() => claude.turns.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(claude.turns).toHaveLength(2);
    const second = claude.turns[1];
    expect(second.req.resumeSessionId).toBe('session-1');
    expect([second.req.prompt, ...second.sent].join('\n\n')).toBe('Go ahead\n\nSmall slices, please');
  });

  it("changes one agent's autonomy, in their running session and on their later turns, and no one else's", async () => {
    const { agents, claude, store, project } = focus();
    store.settings.autonomy = 'ask';
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string; name: string } };
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.autonomy).toBe('ask');

    agents.setAutonomy(lead.id, 'full');
    expect(claude.turns[0].modes).toEqual(['full']);
    expect(store.agent(lead.id).autonomy).toBe('full');
    expect(store.settings.autonomy).toBe('ask');
    expect(store.recentLines(lead.id).at(-1)?.text).toBe(`✻ The captain set ${lead.name}'s autonomy to Full autonomy`);
    // the same mode again changes nothing and says nothing
    const lines = store.recentLines(lead.id).length;
    agents.setAutonomy(lead.id, 'full');
    expect(claude.turns[0].modes).toEqual(['full']);
    expect(store.recentLines(lead.id)).toHaveLength(lines);

    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');
    // no session running: it's recorded for their next turn, which starts in it
    agents.setAutonomy(lead.id, 'auto');
    expect(store.recentLines(lead.id).at(-1)?.text).toBe(`✻ The captain set ${lead.name}'s autonomy to Auto mode`);
    agents.message(lead.id, 'Go ahead');
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.autonomy).toBe('auto');
    claude.turns[1].end({ ok: true, summary: 'Shipped' });
    await until(() => store.agent(lead.id).status === 'done');

    // anyone else follows Focus's own setting, as it is when their turn starts
    store.settings.autonomy = 'full';
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', { number: 1, title: 'Add a dark mode toggle to the header' }, { cloud: true });
    await until(() => claude.turns.length === 3);
    expect(claude.turns[2].req.autonomy).toBe('full');
    expect(store.agent(id).autonomy).toBeUndefined();
    expect(store.agent(lead.id).autonomy).toBe('auto');

    // a cloud session takes its new mode from its next turn, and says so
    agents.setAutonomy(id, 'ask');
    expect(claude.turns[2].modes).toEqual(['ask']);
    expect(store.recentLines(id).at(-1)?.text).toMatch(/autonomy to Raise your hand \(from their next turn\)$/);
  });

  it('remembers which of a lead’s turns the captain read, until the next one ends', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    agents.readTurn(lead.id); // still at it: nothing to read yet
    expect(store.agent(lead.id).lead?.readTurn).toBeUndefined();

    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');
    agents.readTurn(lead.id);
    const first = store.agent(lead.id).finishedAt;
    expect(store.agent(lead.id).lead?.readTurn).toBe(first);

    agents.message(lead.id, 'Go ahead');
    await until(() => claude.turns.length === 2);
    await new Promise((r) => setTimeout(r, 5));
    claude.turns[1].end({ ok: true, summary: 'Shipped' });
    await until(() => store.agent(lead.id).status === 'done' && store.agent(lead.id).finishedAt !== first);
    // the new turn is unread
    expect(store.agent(lead.id).lead?.readTurn).toBe(first);
  });

  it('keeps a plugin’s mark on a lead’s turn, for a lead alone, until their next turn starts', async () => {
    const { agents, claude, store, project } = focus();
    let host: PluginHost | undefined;
    agents.startPlugins([{ id: 'marker', start: (h) => ((host = h), {}) }], { demo: false, ownRepo: () => undefined });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');
    const dev = agents.hire(project.id, 'demo/webshop-frontend', { number: 1, title: 'Header' });
    const ended = Date.now();
    expect(host?.goals.mark(dev.id, { seen: true }, ended)).toBe(false);
    expect(host?.goals.mark(lead.id, { seen: true }, ended)).toBe(true);
    expect(store.agent(lead.id).lead?.marks).toEqual({ marker: { seen: true } });
    expect(host?.agent(lead.id)?.lead?.marks).toEqual({ marker: { seen: true } });
    expect(host?.goals.mark(lead.id, undefined)).toBe(true);
    expect(store.agent(lead.id).lead?.marks).toBeUndefined();
    host?.goals.mark(lead.id, 'again', ended);

    await new Promise((r) => setTimeout(r, 5));
    agents.message(lead.id, 'Go ahead');
    await until(() => store.agent(lead.id).status === 'working');
    expect(store.agent(lead.id).lead?.marks).toBeUndefined();
    // one about the turn before is too late, and the turn under way isn't over to mark
    await until(() => !!store.run(lead.id).open);
    expect(host?.goals.mark(lead.id, 'late', ended)).toBe(false);
    expect(host?.goals.mark(lead.id, 'mid-turn')).toBe(false);
    expect(store.agent(lead.id).lead?.marks).toBeUndefined();
  });

  it('tells the plugins of the captain’s answer once it’s gone through, with the agent as it stood before it', async () => {
    const { agents, claude, store, project } = focus();
    const heard: { status: string; answer: unknown }[] = [];
    agents.startPlugins([{ id: 'ears', start: () => ({ captainAnswered: (before, answer) => void heard.push({ status: before.status, answer }) }) }], { demo: false, ownRepo: () => undefined });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    claude.turns[0].end({ ok: true, summary: 'Shall I start slice 2?' });
    await until(() => store.agent(lead.id).status === 'done');
    await agents.captainAnswers(lead.id, { text: 'Not yet' }, () => ({ costly: { usd: 3 } }));
    expect(heard).toEqual([]);
    await agents.captainAnswers(lead.id, { text: 'Go on' }, () => agents.message(lead.id, 'Go on'));
    expect(heard).toEqual([{ status: 'done', answer: { text: 'Go on' } }]);
  });

  it('sends a QA report that leaves changed files out back to QA once, naming them, then takes the verdict', async () => {
    const { agents, claude, store, project } = focus({ ...demoWorkspace, changedFiles: () => Promise.resolve(['src/cart.ts', 'scripts/sync.ts']) });
    const [pr] = await Effect.runPromise(Effect.gen(function* () {
      return yield* (yield* GitHub).listPullRequests('demo/webshop-frontend');
    }).pipe(Effect.provide(demoLayer)));
    agents.requestReview(project.id, pr.repo, pr.number, pr.title);
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.prompt).toContain("The files it changes (2): your report's files accounts for every one.\n- src/cart.ts\n- scripts/sync.ts");
    claude.turns[0].hooks.session('qa-session');
    const report = (files: string[]) => ({ verdict: 'pass', summary: 'Works.', checks: [], commands: [], files: files.map((file) => ({ file, tests: 'none', checked: 'read every changed line' })) });
    claude.turns[0].end({ ok: true, summary: '', structured: report(['src/cart.ts']) });
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.resumeSessionId).toBe('qa-session');
    expect(claude.turns[1].req.prompt).toMatch(/^Your report leaves out 1 of the files this pull request changes:\n- scripts\/sync\.ts\n/);
    // asked once a review: a second report still short is taken as it is
    claude.turns[1].end({ ok: true, summary: '', structured: report(['src/cart.ts']) });
    await until(() => store.reviews.get(prKey(pr.repo, pr.number))?.status === 'passed');
    expect(claude.turns).toHaveLength(2);
  });

  it('sends QA back to a changed file its session never opened, whatever its report says, by its transcript', async () => {
    const { agents, claude, store, project } = focus({ ...demoWorkspace, changedFiles: () => Promise.resolve(['src/cart.ts', 'scripts/sync.ts']) });
    // QA read src/cart.ts, and only listed the files
    agents.readTranscript = () => Promise.resolve([
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git diff --stat origin/main...HEAD' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/review/src/cart.ts' } }] } },
    ].map((l) => JSON.stringify(l)).join('\n'));
    const [pr] = await Effect.runPromise(Effect.gen(function* () {
      return yield* (yield* GitHub).listPullRequests('demo/webshop-frontend');
    }).pipe(Effect.provide(demoLayer)));
    agents.requestReview(project.id, pr.repo, pr.number, pr.title);
    await until(() => claude.turns.length === 1);
    claude.turns[0].hooks.session('qa-session');
    const files = ['src/cart.ts', 'scripts/sync.ts'].map((file) => ({ file, tests: 'none', checked: 'read every changed line' }));
    claude.turns[0].end({ ok: true, summary: '', structured: { verdict: 'pass', summary: 'Works.', checks: [], commands: [], files } });
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toMatch(/^Your session never opened this file, whatever your report says about it:\n- scripts\/sync\.ts\n/);
    claude.turns[1].end({ ok: true, summary: '', structured: { verdict: 'pass', summary: 'Works.', checks: [], commands: [], files } });
    await until(() => store.reviews.get(prKey(pr.repo, pr.number))?.status === 'passed');
  });

  it('stops a QA session whose PR merged, and won’t resume it for a message', async () => {
    const { agents, claude, store, project } = focus();
    const [pr] = await Effect.runPromise(Effect.gen(function* () {
      return yield* (yield* GitHub).listPullRequests('demo/webshop-frontend');
    }).pipe(Effect.provide(demoLayer)));
    agents.requestReview(project.id, pr.repo, pr.number, pr.title);
    await until(() => claude.turns.length === 1);
    const qa = store.reviews.get(prKey(pr.repo, pr.number))!.agentId!;

    agents.prClosed(pr.repo, pr.number, true, 'captain', pr.headSha);
    expect(claude.turns[0].stopped).toBe(true);
    await until(() => store.agent(qa).status === 'stopped' || store.agent(qa).status === 'error');
    expect(store.agent(qa).prGone).toBe('merged');

    agents.message(qa, 'continue');
    await new Promise((r) => setTimeout(r, 50));
    expect(claude.turns).toHaveLength(1);
    expect(store.recentLines(qa).at(-1)?.text).toBe(`✻ PR #${pr.number} was merged; nothing to review`);
  });

  // jonhilt/focus#523: QA's turn failed (out of credit), the captain said "Continue", and QA's pass went nowhere
  it('posts the verdict of a QA session the captain picked back up after it failed, and frees the reviewer', async () => {
    const { agents, claude, store, project } = focus();
    const [pr, other] = await Effect.runPromise(Effect.gen(function* () {
      return yield* (yield* GitHub).listPullRequests('demo/webshop-frontend');
    }).pipe(Effect.provide(demoLayer)));
    const key = prKey(pr.repo, pr.number);
    agents.requestReview(project.id, pr.repo, pr.number, pr.title);
    await until(() => claude.turns.length === 1);
    const qa = store.reviews.get(key)!.agentId!;
    claude.turns[0].end({ ok: false, summary: '', error: 'Credit balance is too low' });
    await until(() => store.reviews.get(key)?.status === 'error');

    agents.message(qa, 'Continue');
    await until(() => claude.turns.length === 2);
    // asked for again while QA's at it (a re-test from the board), and another PR waiting for the same reviewer
    agents.requestReview(project.id, pr.repo, pr.number, pr.title, undefined, true);
    agents.requestReview(project.id, other.repo, other.number, other.title);
    claude.turns[1].end({ ok: true, summary: '', structured: { verdict: 'pass', summary: 'Works.', checks: [], commands: [], files: [] } });

    await until(() => store.reviews.get(key)?.status === 'passed');
    expect(store.reviews.get(key)?.commentUrl).toBeTruthy();
    // the reviewer moves on to the next PR in line
    await until(() => store.reviews.get(prKey(other.repo, other.number))?.status === 'testing');
  });

  it('tests a goal’s PR with its slice’s other PRs checked out beside it, and clears them all away once it merges', async () => {
    const checkouts: string[] = [];
    const removed: string[] = [];
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      checkoutPullRequest: async (repo, id, number) => {
        checkouts.push(`${repo}#${number} ${id}`);
        return '';
      },
      remove: async (_repo, id) => void removed.push(id),
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const prs = store.agent(lead.id).lead!.prs;
    expect(prs.map((p) => p.repo).sort()).toEqual(['demo/webshop-api', 'demo/webshop-frontend']);
    const front = prs.find((p) => p.repo === 'demo/webshop-frontend')!;
    const api = prs.find((p) => p.repo === 'demo/webshop-api')!;
    const qaTurn = () => claude.turns.find((t) => t.req.agentId === `qa_${lead.id}` && t.req.cwd.includes(`-pr${front.number}/`));
    if (!store.reviews.get(prKey(front.repo, front.number))) agents.requestReview(project.id, front.repo, front.number, 'Saved items');
    await until(() => !!qaTurn());

    const folder = `qa_${lead.id}/demo__webshop-frontend-pr${front.number}`;
    expect(checkouts).toEqual(expect.arrayContaining([
      `demo/webshop-frontend#${front.number} ${folder}/webshop-frontend`,
      `demo/webshop-api#${api.number} ${folder}/webshop-api`,
    ]));
    // the session runs in the PR's own checkout, and hears where its sibling is
    expect(qaTurn()!.req.cwd).toBe(`/demo/${folder}/webshop-frontend`);
    expect(qaTurn()!.req.systemAppend).toContain(`\`../webshop-api\`: demo/webshop-api#${api.number}`);

    agents.prClosed(front.repo, front.number, true);
    await until(() => removed.includes(folder));
  });

  it('stops their Claude Code session when they’re sent home', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await agents.dismiss(lead.id);
    expect(claude.turns[0].stopped).toBe(true);
    expect(store.agents.has(lead.id)).toBe(false);
  });

  it('digests their session into the ledger when they go home', async () => {
    const { agents, claude, store, project } = focus();
    const transcript = [
      { type: 'user', uuid: 'u1', timestamp: '2026-10-08T12:00:00.000Z', message: { content: 'Your workspace, with every repo of the project checked out side by side: …' } },
      { type: 'assistant', uuid: 'u2', timestamp: '2026-10-08T12:03:00.000Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls *.md' } }] } },
      { type: 'user', uuid: 'u3', timestamp: '2026-10-08T12:04:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'zsh: no matches found: *.md' }] } },
      { type: 'assistant', uuid: 'u4', timestamp: '2026-10-08T12:05:00.000Z', message: { content: [{ type: 'text', text: 'Grid or list for saved items?' }] } },
      { type: 'user', uuid: 'u5', timestamp: '2026-10-08T12:06:00.000Z', message: { content: 'List, newest first' } },
    ].map((l) => JSON.stringify(l)).join('\n');
    const reads: string[] = [];
    agents.readTranscript = (id) => (reads.push(id), Promise.resolve(transcript));
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    claude.turns[0].hooks.cost(0.42);
    await agents.dismiss(lead.id);
    await until(() => store.ledger.some((e) => e.kind === 'session-digest'));
    const digest = store.ledger.find((e) => e.kind === 'session-digest');
    expect(digest).toMatchObject({ key: 'session-1:u5', sessionId: 'session-1', task: 'lead', goal: 'Saved items', facts: { minutes: 6, toolCalls: 1, failedCalls: 1, wastedCalls: 1, costUsd: 0.42 } });
    expect(reads).toEqual(['session-1']);
    // a lead's span keeps what the captain said, beside what the lead had just said
    await until(() => store.ledger.some((e) => e.kind === 'captain-replies'));
    expect(store.ledger.find((e) => e.kind === 'captain-replies')).toMatchObject({
      key: 'session-1:u5', goal: 'Saved items', replies: [{ at: '2026-10-08T12:06:00.000Z', lead: 'Grid or list for saved items?', captain: 'List, newest first' }],
    });
  });

  it('keeps the captain’s replies from leads’ spans digested before replies were kept, once each, dated as their digests', async () => {
    const { agents, store } = focus();
    const lead = [
      { type: 'assistant', uuid: 'l1', message: { content: [{ type: 'text', text: 'Ship it?' }] } },
      { type: 'user', uuid: 'l2', message: { content: 'ship it' } },
    ].map((l) => JSON.stringify(l)).join('\n');
    const facts = { minutes: 1, turns: 1, toolCalls: 0, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 1, nudges: 1, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0 };
    store.record({ kind: 'session-digest', key: 's-lead:l2', sessionId: 's-lead', agentId: 'lead_x', agent: 'Lt. X', task: 'lead', prs: [], goal: 'G', toUuid: 'l2', facts, at: 5, projectId: 'p' });
    store.record({ kind: 'session-digest', key: 's-dev:d1', sessionId: 's-dev', agentId: 'agent_y', agent: 'Ens. Y', task: 'issue', prs: [], toUuid: 'd1', facts, at: 6, projectId: 'p' });
    agents.transcripts = () => Promise.resolve([{ name: 'lead-proj-p__s-lead', kind: 'lead' as const, sessionId: 's-lead', read: () => Promise.resolve(lead) }]);
    expect(await agents.backfillReplies()).toEqual({ spans: 1 });
    expect(store.ledger.filter((e) => e.kind === 'captain-replies')).toMatchObject([
      { key: 's-lead:l2', at: 5, projectId: 'p', agent: 'Lt. X', goal: 'G', backfilled: true, replies: [{ lead: 'Ship it?', captain: 'ship it' }] },
    ]);
    expect(await agents.backfillReplies()).toEqual({ spans: 0 });
  });

  it('digests older transcripts once each, dated when their session ended, facts only', async () => {
    const { agents, store } = focus();
    const qa = [
      { type: 'user', uuid: 'q1', timestamp: '2026-10-05T09:00:00.000Z', message: { content: 'Please QA pull request #42 in demo/webshop-frontend: Wishlist' } },
      { type: 'assistant', uuid: 'q2', timestamp: '2026-10-05T09:20:00.000Z', message: { content: [{ type: 'text', text: 'The demo port was taken, so I moved to 4600. The wishlist page loads, hearts toggle, and the saved list survives a reload; the tests and the type check pass on this commit.' }] } },
    ].map((l) => JSON.stringify(l)).join('\n');
    const transcripts = [{ name: 'qa-proj-abc123__11111111', kind: 'qa' as const, sessionId: 's-old', read: () => Promise.resolve(qa) }];
    agents.transcripts = () => Promise.resolve(transcripts);
    expect((await agents.undigested()).map((t) => t.sessionId)).toEqual(['s-old']);
    expect(await agents.backfill()).toEqual({ sessions: 1 });
    await until(() => store.ledger.some((e) => e.kind === 'session-digest'));
    const digest = store.ledger.find((e) => e.kind === 'session-digest');
    expect(digest && 'frictions' in digest).toBe(false);
    expect(digest).toMatchObject({
      projectId: 'proj_abc123',
      at: Date.parse('2026-10-05T09:20:00.000Z'),
      backfilled: true,
      task: 'review',
      prs: [{ repo: 'demo/webshop-frontend', pr: 42 }],
      facts: { minutes: 20 },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(await agents.undigested()).toEqual([]);
    expect(await agents.backfill()).toEqual({ sessions: 0 });
  });

  it('commits a closing goal’s uncommitted work as a WIP snapshot on its branch before its checkouts go', async () => {
    const steps: string[] = [];
    let saves = true;
    let shipMidClose: Promise<unknown> | undefined;
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      // the API's checkout can't say whether it has changes: that counts as having them
      hasUncommittedChanges: async (dir) => {
        if (dir.endsWith('/webshop-api')) throw new Error('index.lock exists');
        return true;
      },
      branchState: async () => ({ onOrigin: false, unpushed: 2 }),
      snapshot: async (dir, message) => {
        if (!saves) throw new Error('disk full');
        // the lead, still mid-turn, tries to ship while the goal closes: the snapshot must never reach a pull request
        shipMidClose ??= claude.turns[0].req.tools!.ship({ title: 'Saved items', summary: 'Last bits.' }).then(() => 'shipped', (err: Error) => err.message);
        steps.push(`snapshot ${dir.split('/').at(-1)}: ${message}`);
        return true;
      },
      remove: async (_repo, agentId) => void steps.push(`remove ${agentId.split('/').at(-1)}`),
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const branch = store.agent(lead.id).branch;

    const first = await agents.closeGoal(lead.id);
    expect(first).toEqual({ warn: expect.arrayContaining([
      `Uncommitted changes in ./webshop-frontend and ./webshop-api are committed as a WIP snapshot on \`${branch}\`, kept only in the clone Ops keeps.`,
      `./webshop-api’s branch \`${branch}\` never reached GitHub: its 2 commits stay only in the clone Ops keeps.`,
      'The goal never shipped anything: no pull request was opened for it.',
    ]) });
    expect(steps).toEqual([]);

    // work that can't be saved keeps the goal open
    saves = false;
    await expect(agents.closeGoal(lead.id, true)).rejects.toThrow(/Couldn’t commit \.\/webshop-frontend’s uncommitted work as a WIP snapshot \(disk full\)/);
    expect(store.agents.has(lead.id)).toBe(true);
    expect(project.goals ?? []).toEqual([]);

    saves = true;
    expect(await agents.closeGoal(lead.id, true)).toEqual({ closed: true });
    const wip = 'WIP: uncommitted work when the goal “Saved items” closed';
    expect(steps.indexOf('remove webshop-frontend')).toBeGreaterThan(steps.indexOf(`snapshot webshop-frontend: ${wip}`));
    expect(steps.indexOf('remove webshop-api')).toBeGreaterThan(steps.indexOf(`snapshot webshop-api: ${wip}`));
    expect(await shipMidClose).toBe('The captain is closing the goal: nothing ships now');
    expect(project.goals![0]).toMatchObject({ id: lead.id, branch, sessionId: 'session-1', repos: [{ folder: 'webshop-frontend' }, { folder: 'webshop-api' }] });
  });

  // found by the goal's check for two things at once (goalInvariants.test.ts, docs/invariants.md#found-on-main)
  it('won’t close a goal while its slice is shipping, so the pull requests it opens stay on the goal', async () => {
    let pushed!: () => void;
    const pushing = new Promise<void>((resolve) => (pushed = resolve));
    const { agents, claude, store, project } = focus({ ...demoWorkspace, push: () => pushing });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const ship = claude.turns[0].req.tools!.ship({ title: 'Saved items', summary: 'A slice.' });
    await until(() => store.agent(lead.id).status === 'pushing');

    await expect(agents.closeGoal(lead.id, true)).rejects.toThrow('is shipping their slice: close the goal once it’s shipped');
    expect(store.agents.has(lead.id)).toBe(true);
    pushed();
    await ship;
    expect(await agents.closeGoal(lead.id, true)).toEqual({ closed: true });
    expect(project.goals![0].prs.map((p) => p.repo)).toEqual(['demo/webshop-frontend', 'demo/webshop-api']);
  });

  // found by the goal's check for two things at once (goalInvariants.test.ts, docs/invariants.md#found-on-main)
  it('leaves a closed goal’s question as it was filed when the lead asks another as it closes', async () => {
    let taken!: () => void;
    const taking = new Promise<void>((resolve) => (taken = resolve));
    let held = false;
    const { agents, claude, store, project } = focus(demoWorkspace, demoLayer, undefined, async () => {
      if (held) await taking;
      return { image: Buffer.from('jpeg'), errors: [] };
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const options = [{ label: 'Grid', html: '<p>grid</p>' }, { label: 'List', html: '<p>list</p>' }];
    await claude.turns[0].req.tools!.ask({ question: 'Which layout?', options });
    held = true;
    const again = claude.turns[0].req.tools!.ask({ question: 'Which layout, really?', options });
    expect(await agents.closeGoal(lead.id, true)).toEqual({ closed: true });
    taken();
    expect(await again).toBe('The goal closed before the question went up.');
    expect(project.goals![0].questions!.map((q) => q.question)).toEqual(['Which layout?']);
    expect(await store.readArtifact(lead.id, 'q1.a.html')).toEqual(Buffer.from('<p>grid</p>'));
    expect(await store.readArtifact(lead.id, 'q2.a.html')).toBeUndefined();
  });

  // found by the goal's check for a restart (goalInvariants.test.ts, docs/invariants.md#found-on-main)
  it('finishes closing a goal Focus went down in the middle of, so its WIP snapshot never stays on an open goal', async () => {
    const snapshots: string[] = [];
    let dirty = true;
    const workspace: WorkspaceOps = {
      ...demoWorkspace,
      hasUncommittedChanges: async () => dirty,
      snapshot: async (dir) => (dirty && snapshots.push(dir), true),
    };
    const first = focus({ ...workspace, snapshot: (dir) => (snapshots.push(dir), new Promise<boolean>(() => undefined)) });
    const { agent: lead } = first.agents.startGoal(first.project.id, 'Saved items') as { agent: { id: string } };
    await until(() => first.claude.turns.length === 1);
    // Focus goes down with the first snapshot taken, before the goal's filed
    void first.agents.closeGoal(lead.id, true);
    await until(() => snapshots.length === 1);
    dirty = false;
    first.agents.shutDown();
    expect(first.store.agent(lead.id).lead?.closeStarted).toBeDefined();

    const after = restarted(first.store, workspace);
    after.agents.recover();
    await until(() => !first.store.agents.has(lead.id));
    expect(first.project.goals![0]).toMatchObject({ id: lead.id });
    expect(first.project.goals![0]).not.toHaveProperty('closeStarted');
    // the lead never picked the goal back up
    expect(after.claude.turns).toEqual([]);
  });

  it('starts a queued goal with the captain’s last edits, at the first free station once theirs is taken, and takes it out of line', () => {
    const { agents, store, project } = focus();
    agents.startGoal(project.id, 'Saved items');
    const queued = agents.queueGoal(project.id, 'Wishlists', { effort: 'low', from: 'the bridge' });
    const lead = agents.startQueued(project.id, queued.id, { text: 'Wishlists you can share', station: 0 });
    expect(lead).toMatchObject({ task: 'lead', effort: 'low', lead: { station: 1, title: 'Wishlists you can share' } });
    expect(store.agent(lead.id).lead?.brief).toBe('Wishlists you can share');
    expect(project.goalQueue).toEqual([]);
    expect(() => agents.startQueued(project.id, queued.id)).toThrow('That goal is no longer in line');
  });

  it('spins a goal’s open contact or idea for next off as a goal of its own, closing it and telling its lead', () => {
    const { agents, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const work = store.agent(lead.id).lead!;
    store.agent(lead.id).lead = { ...work, contacts: [{ id: 'c1', text: 'Sync across devices?', slice: 1, at: 0 }], note: { done: 'Saved', learned: [], next: ['Show it in the header', 'Tidy the store'] } };

    const spun = agents.spinOffContact(lead.id, 'c1', 'Saved items follow you across devices') as { agent: { id: string } };
    const goal = store.agent(spun.agent.id);
    expect(goal.lead).toMatchObject({ station: 1, brief: 'Saved items follow you across devices' });
    expect(store.agent(lead.id).lead!.contacts![0].closed).toMatchObject({ as: 'spun off', goal: goal.id, title: goal.lead!.title });
    expect(store.recentLines(lead.id).at(-1)?.text).toContain('spun contact c1 (Sync across devices?) off as a goal of its own');
    expect(() => agents.spinOffContact(lead.id, 'c1', 'Again')).toThrow('Contact c1 was already spun off.');

    const idea = agents.spinOffIdea(lead.id, 'Tidy the store', 'Tidy the store code') as { agent: { id: string } };
    expect(store.agent(idea.agent.id).lead).toMatchObject({ station: 2 });
    expect(store.agent(lead.id).lead!.note!.next).toEqual(['Show it in the header']);
    expect(store.recentLines(lead.id).at(-1)?.text).toContain('spun your idea for next (Tidy the store) off');
    expect(() => agents.spinOffIdea(lead.id, 'Tidy the store', 'Again')).toThrow('isn’t one of the lead’s ideas');
  });

  it('retitles a new goal once Haiku answers, unless it was retitled meanwhile', async () => {
    const { agents, store, project } = focus();
    let answer!: (title: string | undefined) => void;
    agents.titleGoal = () => new Promise((resolve) => (answer = resolve));
    const { agent: lead } = agents.startGoal(project.id, 'we need better branch names - when merging PRS for example') as { agent: { id: string } };
    expect(store.agent(lead.id).lead!.title).toBe('we need better branch names - when merging PRS for example');
    answer('Readable branch names for slices');
    await until(() => store.agent(lead.id).lead!.title === 'Readable branch names for slices');
    expect(store.agent(lead.id).issue.title).toBe('Readable branch names for slices');

    // the lead titled the next goal before Haiku answered: theirs stays
    const { agent: other } = agents.startGoal(project.id, 'wishlists') as { agent: { id: string } };
    const work = store.agent(other.id).lead!;
    store.agent(other.id).lead = { ...work, title: 'Wishlists, by the lead' };
    answer('Wishlists for shoppers');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.agent(other.id).lead!.title).toBe('Wishlists, by the lead');
  });

  it('reopens a closed goal on its branch, with the same lead picking their conversation back up', async () => {
    const reopened: { id: string; branch: string }[] = [];
    const { agents, claude, store, project } = focus({ ...demoWorkspace, reopen: async (_repo, id, branch) => (reopened.push({ id, branch }), `/demo/${id}`) });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string; name: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');
    const { branch, lead: work } = store.agent(lead.id);
    expect(await agents.closeGoal(lead.id, true)).toEqual({ closed: true });
    expect(store.agents.has(lead.id)).toBe(false);

    // another goal took station 1 meanwhile
    agents.startGoal(project.id, 'Wishlists');
    const again = agents.reopenGoal(project.id, lead.id);
    expect(again).toMatchObject({ id: lead.id, name: lead.name, branch, lead: { station: 1, slice: 1, title: 'Saved items' } });
    expect(project.goals).toEqual([]);
    expect(() => agents.reopenGoal(project.id, lead.id)).toThrow(/isn’t in the room’s log/);
    await until(() => leads().length === 2);
    // each repo comes back on the branch it shipped from, named after the slice's work
    expect(reopened).toEqual(work!.repos.map((r) => ({ id: `${lead.id}/${r.folder}`, branch: r.branch })));
    expect(work!.repos.map((r) => r.branch)).toEqual(work!.repos.map(() => expect.stringMatching(/^focus\/saved-items-first-slice-/) as unknown));
    expect(leads()[1].req.resumeSessionId).toBe('session-1');
    expect(leads()[1].req.prompt).toMatch(new RegExp(`^\\[Ops\\] The captain reopened this goal, .* checked out again on \`${branch}\`, as you left them: \\./webshop-frontend, \\./webshop-api\\. .* Still open on GitHub: `));
    expect(store.agent(lead.id).lead).toMatchObject({ repos: work!.repos, prs: work!.prs });

    // Claude Code no longer has the conversation: a new one hears where the goal stands
    leads()[1].end({ ok: false, summary: '', error: 'No conversation found with session ID: session-1' });
    await until(() => leads().length === 3);
    expect(leads()[2].req.resumeSessionId).toBeUndefined();
    expect(leads()[2].req.prompt).toContain("You're carrying on with this goal in a new conversation");
    expect(leads()[2].req.prompt).toContain('[Ops] The captain reopened this goal');
  });

  it('checks a reopened goal’s repos out again before picking up its conversation, however often that fails first', async () => {
    let failures = 1;
    const reopened: string[] = [];
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      reopen: async (_repo, id) => {
        if (failures-- > 0) throw new Error('fetch failed: could not resolve host');
        reopened.push(id);
        return `/demo/${id}`;
      },
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    leads()[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');
    const { repos } = store.agent(lead.id).lead!;
    await agents.closeGoal(lead.id, true);

    agents.reopenGoal(project.id, lead.id);
    await until(() => store.agent(lead.id).status === 'error');
    expect(leads()).toHaveLength(1);
    // the captain tries again: the repos are checked out first, then the conversation picks back up
    agents.message(lead.id, 'Try again?');
    await until(() => leads().length === 2);
    expect(reopened).toEqual(repos.map((r) => `${lead.id}/${r.folder}`));
    expect(leads()[1].req.resumeSessionId).toBe('session-1');
    expect(leads()[1].req.prompt).toMatch(/^\[Ops\] The captain reopened this goal, [^]*\n\nTry again\?$/);
    expect(store.agent(lead.id).lead).toMatchObject({ repos, reopening: undefined });
  });

  it('files a reopened goal that never got its repos back so it can be reopened again', async () => {
    const { agents, claude, store, project } = focus({ ...demoWorkspace, reopen: () => Promise.reject(new Error('fetch failed')) });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const { branch, lead: work } = store.agent(lead.id);
    await agents.closeGoal(lead.id, true);
    agents.reopenGoal(project.id, lead.id);
    await until(() => store.agent(lead.id).status === 'error');

    // nothing was checked out, so there's nothing to check: only that it never shipped
    expect(await agents.closeGoal(lead.id)).toEqual({ warn: ['The goal never shipped anything: no pull request was opened for it.'] });
    expect(await agents.closeGoal(lead.id, true)).toEqual({ closed: true });
    expect(project.goals).toEqual([expect.objectContaining({ id: lead.id, branch, repos: work!.repos, sessionId: 'session-1' })]);
    expect(agents.reopenGoal(project.id, lead.id)).toMatchObject({ id: lead.id, branch });
  });

  it('reopens a goal only to a free team station', async () => {
    const { agents, claude, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await agents.closeGoal(lead.id, true);
    for (const text of ['One', 'Two', 'Three', 'Four']) agents.startGoal(project.id, text);
    expect(() => agents.reopenGoal(project.id, lead.id)).toThrow(/Every team station in Shop has a goal: close one first/);
    expect(project.goals?.map((g) => g.id)).toEqual([lead.id]);
  });

  it('spins a contact off as a goal of its own, at a free station or in line, closes it linked to the new goal, and tells the lead', () => {
    const { agents, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: Agent };
    const work = store.agent(lead.id).lead;
    if (!work) throw new Error('No lead work');
    store.putAgent({ ...store.agent(lead.id), lead: { ...work, contacts: [{ id: 'c1', text: 'Auth off the LAN?', slice: 1, at: 0 }, { id: 'c2', text: 'Dark mode', slice: 1, at: 0 }] } });

    const started = agents.spinOffContact(lead.id, 'c1', 'Auth off the LAN\n\n(Spun off from “Saved items”)');
    if (!('agent' in started)) throw new Error('It went in line');
    const closed = store.agent(lead.id).lead?.contacts?.[0].closed;
    expect(closed).toMatchObject({ as: 'spun off', goal: started.agent.id, title: 'Auth off the LAN', slice: 1 });
    expect(store.recentLines(lead.id).at(-1)?.text).toBe(`▶ Star chart: The captain spun contact c1 (Auth off the LAN?) off as a goal of its own, “Auth off the LAN”, at team station ${(started.agent.lead?.station ?? 0) + 1}. It's closed on your chart: leave that thread to the new goal.`);
    expect(() => agents.spinOffContact(lead.id, 'c1', 'Again')).toThrow('Contact c1 was already spun off.');
    expect(() => agents.spinOffContact(lead.id, 'c9', 'Who?')).toThrow("There's no contact c9. Open contacts: c2 (Dark mode).");

    // every station taken: the new goal waits in line, by its first words, and the lead hears that
    for (const text of ['Three', 'Four']) agents.startGoal(project.id, text);
    expect(agents.spinOffContact(lead.id, 'c2', 'Dark mode for the shop')).toMatchObject({ queued: { text: 'Dark mode for the shop' } });
    expect(store.agent(lead.id).lead?.contacts?.[1].closed).toEqual({ as: 'spun off', title: 'Dark mode for the shop', slice: 1, at: expect.any(Number) });
    expect(store.recentLines(lead.id).at(-1)?.text).toContain('“Dark mode for the shop”, waiting in line for a team station.');
  });

  it('puts what the lead shows on their goal, with a picture when it can take one, and files it with the goal when it closes', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const show = (input: { id: string; title: string; html: string }) => claude.turns[0].req.tools!.show(input);
    expect(await show({ id: 'data-flow', title: 'Data flow', html: '<h1>Flow</h1>' })).toMatch(/“Data flow” is on your station's screen/);
    expect(await show({ id: 'mockup', title: 'Mockup', html: '<p>unrenderable</p>' })).toMatch(/couldn't take a picture of it for the screen \(no browser\)/);
    await expect(show({ id: '../etc', title: 'Nope', html: '<p>x</p>' })).rejects.toThrow(/lowercase letters/);
    expect(store.agent(lead.id).lead!.artifacts).toEqual([
      // each with the slice it was shown in, for its waypoint's evidence
      { id: 'data-flow', title: 'Data flow', at: expect.any(Number), image: true, slice: 1 },
      { id: 'mockup', title: 'Mockup', at: expect.any(Number), slice: 1 },
    ]);
    expect((await store.readArtifact(lead.id, 'data-flow.html'))?.toString()).toBe('<h1>Flow</h1>');
    expect(await store.readArtifact(lead.id, 'data-flow.jpg')).toBeDefined();
    expect(await store.readArtifact(lead.id, 'mockup.jpg')).toBeUndefined();

    await agents.closeGoal(lead.id, true);
    expect(project.goals?.[0].artifacts?.map((a) => a.id)).toEqual(['data-flow', 'mockup']);
    expect((await store.readArtifact(lead.id, 'data-flow.html'))?.toString()).toBe('<h1>Flow</h1>');
  });

  it('puts the lead’s model on their goal as a page of the three views, checked against their workspace', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const model = {
      question: 'How is an item saved?',
      nodes: [
        { id: 'page', label: 'Saved page', kind: 'ui' as const, layer: 'UI', cite: { file: '/nowhere/Page.tsx', line: 3 }, change: 'added' as const },
        { id: 'api', label: 'Save endpoint', kind: 'route' as const, layer: 'API' },
      ],
      edges: [{ from: 'page', to: 'api', kind: 'calls' as const }],
      trace: [{ from: 'page', to: 'api', label: 'POST the item', payload: 'Item { id }' }],
      simplified: [],
    };
    const said = await claude.turns[0].req.tools!.model({ id: 'save-flow', title: 'Saving an item', model });
    expect(said).toMatch(/“Saving an item” is on your station's screen/);
    // nothing it cites is in the lead's workspace, so the check says so, for the lead to fix
    expect(said).toMatch(/found 3 problems.*Part page: \/nowhere\/Page\.tsx isn't there.*Part api has no cite.*Connection page → api has no cite/);
    const page = (await store.readArtifact(lead.id, 'save-flow.html'))!.toString();
    expect(page).toContain('data-part="page"');
    expect(page).toContain('data-steps=" 0 "');
    expect(page).toContain('NEW');
    await expect(claude.turns[0].req.tools!.model({ id: 'bad', title: 'Bad', model: { ...model, trace: [{ from: 'api', to: 'nope', label: 'x' }] } })).rejects.toThrow(/doesn't follow a connection/);
  });

  it('puts the lead’s question to the captain with an option apiece, and tells the lead which they picked', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const ask = (question: string) => claude.turns[0].req.tools!.ask({ question, options: [{ label: 'Cards', html: '<p>A</p>' }, { label: 'List', html: '<p>unrenderable</p>' }] });
    expect(await ask('Which layout?')).toMatch(/2 options \(Ops couldn't take a picture of 1 of them/);
    expect(await ask('Which layout, really?')).toMatch(/end your turn here/);
    const [question] = store.agent(lead.id).lead!.questions!;
    expect(question).toMatchObject({ id: 'q2', question: 'Which layout, really?', options: [{ id: 'a', label: 'Cards', image: true }, { id: 'b', label: 'List' }] });
    // the question it replaced goes, pages and all
    expect(await store.readArtifact(lead.id, 'q1.a.html')).toBeUndefined();
    expect((await store.readArtifact(lead.id, 'q2.a.html'))?.toString()).toBe('<p>A</p>');

    // two at once: the later one replaces the earlier, and keeps pages of its own
    await Promise.all([ask('Which colour?'), ask('Which colour, really?')]);
    const [latest] = store.agent(lead.id).lead!.questions!;
    expect(latest).toMatchObject({ id: 'q4', question: 'Which colour, really?' });
    expect((await store.readArtifact(lead.id, 'q4.a.html'))?.toString()).toBe('<p>A</p>');
    expect(await store.readArtifact(lead.id, 'q3.a.html')).toBeUndefined();
    expect(await store.readArtifact(lead.id, 'q2.a.html')).toBeUndefined();
    await ask('Which layout, really?');

    agents.answer(lead.id, 'q5', 'b', 'Keep the header');
    expect(store.agent(lead.id).lead!.questions![0].answer).toMatchObject({ option: 'b', note: 'Keep the header' });
    expect(claude.turns[0].sent).toEqual(['I picked B, “List”, for your question “Which layout, really?”.\n\nKeep the header']);
    expect(() => agents.answer(lead.id, 'q5', 'a')).toThrow(/already picked B/);
  });

  it('settles the lead’s open question when the captain replies in chat instead of picking', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const ask = (question: string) => claude.turns[0].req.tools!.ask({ question, options: [{ label: 'Cards', html: '<p>A</p>' }, { label: 'List', html: '<p>B</p>' }] });
    const questions = () => store.agent(lead.id).lead!.questions!;

    // news from someone else aboard isn't the captain's answer
    await ask('Which layout?');
    agents.message(lead.id, 'The build is green', 'Ops');
    expect(openQuestion(store.agent(lead.id))).toBeDefined();

    agents.message(lead.id, '  Go with the list  ');
    expect(openQuestion(store.agent(lead.id))).toBeUndefined();
    expect(questions().at(-1)!.answer).toEqual({ note: 'Go with the list', at: expect.any(Number) });
    expect(claude.turns[0].sent.at(-1)).toBe('Go with the list');
    expect(() => agents.answer(lead.id, 'q1', 'b')).toThrow(/already answered it in chat/);

    // with nothing open, a message changes nothing
    const before = structuredClone(questions());
    agents.message(lead.id, 'Thanks');
    expect(questions()).toEqual(before);

    // a pick on screen is recorded with its option, not also as a reply in chat
    await ask('Which colour?');
    agents.answer(lead.id, 'q2', 'a');
    expect(questions().at(-1)!.answer).toEqual({ option: 'a', at: expect.any(Number) });
  });

  it('sends a PR back to QA at Ops’ merge of the base, so the verdict doesn’t stay on the commit before', async () => {
    const { agents, claude, store, project } = focus({ ...demoWorkspace, mergeBase: async () => ({ kind: 'merged', sha: 'merge-sha1234', from: 'old-sha' }) });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [pr] = store.agent(lead.id).lead!.prs;
    const report: QaReport = { verdict: 'pass', summary: 'Works', checks: [], commands: [], captions: [] };
    store.reviewJournal(prKey(pr.repo, pr.number), { kind: 'imported', review: { projectId: project.id, repo: pr.repo, number: pr.number, title: 'PR', status: 'passed', sha: pr.sha, report, requestedAt: 1, finishedAt: 2 } });

    await agents.resolveConflicts(project.id, { repo: pr.repo, number: pr.number, title: 'Saved items', branch: store.agent(lead.id).branch, baseBranch: 'main' } as PullRequest);
    expect(store.reviews.get(prKey(pr.repo, pr.number))).toMatchObject({ status: 'queued', shippedHead: 'merge-sha1234' });
  });

  it('merges the base into a slice’s conflicting PR itself, and tells the lead to pull with the captain’s next message', async () => {
    const auto = ['CLAUDE.md', 'client/public/ship/holodeck-deck.glb'];
    const { agents, claude, store, project } = focus({ ...demoWorkspace, mergeBase: async () => ({ kind: 'merged', sha: 'merge-sha', from: 'old-sha', auto }) });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [pr] = store.agent(lead.id).lead!.prs;

    const outcome = await agents.resolveConflicts(project.id, { repo: pr.repo, number: pr.number, branch: store.agent(lead.id).branch, baseBranch: 'main' } as PullRequest);
    expect(outcome).toEqual({ kind: 'merged', auto });
    // settled by the repo's rules, without an agent
    expect(store.ledger.filter((e) => e.kind === 'conflicts')).toEqual([expect.objectContaining({ repo: pr.repo, pr: pr.number, resolved: 'auto', files: auto })]);
    expect([...store.agents.values()].some((a) => a.task === 'conflicts')).toBe(false);
    expect(store.agent(lead.id).lead!.prs.find((p) => p.number === pr.number)?.sha).toBe('merge-sha');
    // nothing reaches them mid-turn, and the note doesn't start another one when it ends
    expect(leads()[0].sent).toEqual([]);
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');
    await new Promise((r) => setTimeout(r, 50));
    expect(leads()).toHaveLength(1);

    agents.message(lead.id, 'How did it go?');
    await until(() => leads().length === 2);
    const heard = [leads()[1].req.prompt, ...leads()[1].sent].join('\n\n');
    expect(heard).toMatch(new RegExp(`^\\[Ops\\] ${pr.repo}#${pr.number} had merge conflicts with \`main\`: Ops merged`));
    expect(heard).toContain('How did it go?');
  });

  it('sends a developer their PR’s conflicts as Ops’ news, never as the captain’s words', async () => {
    const { agents, claude, store, project } = focus();
    const { id } = agents.hire(project.id, 'demo/webshop-frontend', { number: 1, title: 'Add a dark mode toggle to the header' });
    await until(() => claude.turns.length === 1);
    claude.turns[0].end({ ok: true, summary: 'Dark mode toggle' });
    await until(() => store.agent(id).status === 'done' && !!store.agent(id).pr);
    const pr = store.agent(id).pr!;
    const outcome = await agents.resolveConflicts(project.id, { repo: 'demo/webshop-frontend', number: pr.number, title: 'Dark mode', url: pr.url, branch: store.agent(id).branch, baseBranch: 'main' } as PullRequest);
    expect(outcome).toMatchObject({ kind: 'agent', agent: { id } });
    await until(() => claude.turns.filter((t) => t.req.agentId === id).length === 2);
    expect(claude.turns.filter((t) => t.req.agentId === id)[1].req.prompt).toMatch(/^\[Ops\] Pull request #\d+ \(branch `.*`\) has merge conflicts with `main`/);
  });

  describe('QA’s verdict on a goal’s pull request', () => {
    const failed: QaReport = { verdict: 'fail', summary: 'Empty list crashes', fixInstructions: 'Guard the empty case', checks: [], commands: [], captions: [] };
    /** A lead whose slice is shipped and whose turn has ended, and QA failing its first pull request. */
    async function shippedAndIdle(plugins: Parameters<AgentManager['startPlugins']>[0] = []) {
      const o = focus();
      o.project.autoSendBack = true;
      if (plugins.length) o.agents.startPlugins(plugins, { demo: false, ownRepo: () => undefined });
      const { agent: lead } = o.agents.startGoal(o.project.id, 'Saved items') as { agent: { id: string } };
      const leads = () => o.claude.turns.filter((t) => t.req.agentId === lead.id);
      await until(() => leads().length === 1);
      await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
      leads()[0].end({ ok: true, summary: 'Shipped' });
      await until(() => o.store.agent(lead.id).status === 'done');
      const [pr] = o.store.agent(lead.id).lead!.prs;
      const core = Reflect.get(o.agents, 'core') as { leads: { leadHearsVerdict(repo: string, number: number, from: string, report: QaReport, failedRounds: number): void } };
      const toasts = vi.spyOn(Hub.prototype, 'toast');
      const fail = (rounds = 1) => core.leads.leadHearsVerdict(pr.repo, pr.number, 'QA officer Ada', failed, rounds);
      return { ...o, lead: lead.id, leads, pr, fail, toasts };
    }

    it('is a note for the captain’s next message, even with send-back on, and the captain hears the lead waits on them', async () => {
      const o = await shippedAndIdle();
      o.fail();
      await new Promise((r) => setTimeout(r, 30));
      expect(o.leads()).toHaveLength(1);
      expect(o.store.agent(o.lead).status).toBe('done');
      expect(o.toasts).toHaveBeenCalledWith('error', `🙋 QA failed ${o.pr.repo.split('/')[1]}#${o.pr.number}: ${o.store.agent(o.lead).name} waits on you`, o.lead);
      o.toasts.mockRestore();

      o.agents.message(o.lead, 'Fix it, please');
      await until(() => o.leads().length === 2);
      expect(o.leads()[1].req.prompt).toBe(`[QA officer Ada] QA failed ${o.pr.repo}#${o.pr.number}: Empty list crashes\n\nWhat to fix: Guard the empty case\n\nFix it, please`);
    });

    it('tells the captain a lead waits on them when a fail noted mid-turn is still unheard as the turn ends', async () => {
      const o = await shippedAndIdle();
      o.agents.message(o.lead, 'Look at the copy');
      await until(() => o.leads().length === 2);
      o.fail();
      const name = o.store.agent(o.lead).name;
      const failed = `QA failed ${o.pr.repo.split('/')[1]}#${o.pr.number}`;
      expect(o.toasts).toHaveBeenCalledWith('info', `🔧 ${failed}: ${name} hears it with their next message`, o.lead);
      expect(o.toasts).not.toHaveBeenCalledWith('error', expect.anything(), o.lead);
      o.leads()[1].end({ ok: true, summary: 'Fixed the copy' });
      await until(() => o.store.agent(o.lead).status === 'done');
      expect(o.toasts).toHaveBeenCalledWith('error', `🙋 ${failed}: ${name} waits on you`, o.lead);
      o.toasts.mockRestore();
    });

    it('says nothing more as the turn ends when the lead heard the fail mid-turn', async () => {
      const o = await shippedAndIdle();
      o.agents.message(o.lead, 'Look at the copy');
      await until(() => o.leads().length === 2);
      o.fail();
      o.agents.message(o.lead, 'And the fail');
      await until(() => o.leads()[1].sent.length > 0 || o.leads().length > 2);
      o.leads().at(-1)!.end({ ok: true, summary: 'Fixed both' });
      await until(() => o.store.agent(o.lead).status === 'done');
      expect(o.toasts).not.toHaveBeenCalledWith('error', expect.anything(), o.lead);
      o.toasts.mockRestore();
    });

    it('wakes the lead when a plugin sends them a message for it, and then the captain isn’t told they wait', async () => {
      const o = await shippedAndIdle([{
        id: 'waker',
        start: (host) => ({ leadNoted: (lead, note) => void (note.about.kind === 'qa-verdict' && host.goals.message(lead.id, 'Fix it.', { from: note.from })) }),
      }]);
      o.fail();
      await until(() => o.leads().length === 2);
      expect(o.leads()[1].req.prompt).toMatch(/^\[QA officer Ada\] QA failed .*\n\n\[QA officer Ada\] Fix it\.$/s);
      // the note leaves when to the message it comes with
      expect(o.leads()[1].req.prompt).not.toMatch(/waits on the captain/);
      expect(o.toasts).not.toHaveBeenCalledWith('error', expect.stringContaining('QA failed'), o.lead);
      o.toasts.mockRestore();
    });
  });

  it('seats an agent of its own on a slice’s PR when git can’t merge it, rather than interrupting the lead', async () => {
    const created: { agentId: string; branch: string; local?: string }[] = [];
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      create: async (_repo, agentId, branch, _start, _aboard, local) => (created.push({ agentId, branch, local }), `/demo/${agentId}`),
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [pr] = store.agent(lead.id).lead!.prs;
    const branch = store.agent(lead.id).branch;

    const outcome = await agents.resolveConflicts(project.id, { repo: pr.repo, number: pr.number, title: 'Saved items', url: pr.url, branch, baseBranch: 'main' } as PullRequest);
    if (outcome.kind !== 'agent') throw new Error(`expected an agent, got ${outcome.kind}`);
    expect(outcome.agent.task).toBe('conflicts');
    expect(store.ledger.filter((e) => e.kind === 'conflicts')).toEqual([expect.objectContaining({ resolved: 'agent', files: ['src/header.ts'] })]);
    await expect(agents.resolveConflicts(project.id, { repo: pr.repo, number: pr.number, branch, baseBranch: 'main' } as PullRequest)).rejects.toThrow(/already resolving/);
    const resolver = () => claude.turns.find((t) => t.req.agentId === outcome.agent.id);
    await until(() => !!resolver());
    // in a worktree of their own, on a local branch of their own: the lead's checkout has the PR's
    expect(created.find((c) => c.agentId === outcome.agent.id)).toEqual({ agentId: outcome.agent.id, branch, local: `${branch}-conflicts-${outcome.agent.id.slice(-4)}` });
    expect(leads()[0].sent).toEqual([]);

    resolver()!.end({ ok: true, summary: 'Kept both sides of the header' });
    await until(() => store.agent(outcome.agent.id).status === 'done');
    expect(leads()).toHaveLength(1);
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');
    agents.message(lead.id, 'Next?');
    await until(() => leads().length === 2);
    expect([leads()[1].req.prompt, ...leads()[1].sent].join('\n\n')).toContain(`${outcome.agent.name} merged \`main\` into \`${branch}\` and pushed it`);
  });

  it('won’t ship a lead’s repo over commits Ops pushed to its branch', async () => {
    let behind = false;
    const { agents, claude, store, project } = focus({ ...demoWorkspace, head: async () => 'lead-head', missingRemoteCommits: async () => behind });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const ship = () => claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    await ship();
    const work = store.agent(lead.id).lead!;
    store.agent(lead.id).lead = { ...work, prs: work.prs.map((p) => ({ ...p, sha: 'merge-sha' })) };
    behind = true;
    await expect(ship()).rejects.toThrow(/^Nothing shipped: GitHub's `[^`]+` has commits \.\/webshop-/);
  });

  it('ships through GitHub 5xx answers, trying the push and the PR again', async () => {
    let pushFailures = 2;
    let prFailures = 2;
    // the demo GitHub, except that opening a PR answers 502 twice first
    const flaky = Layer.effect(GitHub, Effect.gen(function* () {
      const gh = yield* GitHub;
      return GitHub.of({
        ...gh,
        createPullRequest: (repo, pr) =>
          Effect.suspend(() =>
            prFailures-- > 0 ? Effect.fail(new GhServerError({ args: ['pr', 'create'], stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' })) : gh.createPullRequest(repo, pr),
          ),
      });
    })).pipe(Layer.provide(demoLayer));
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      push: async (dir, branch) => {
        if (pushFailures-- > 0) throw new Error("git push --force-with-lease failed: remote: Internal Server Error\nfatal: unable to access 'https://github.com/demo/webshop-frontend.git/': The requested URL returned error: 502");
        return demoWorkspace.push(dir, branch);
      },
    }, flaky);
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);

    const reply = await claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    expect(JSON.stringify(reply)).toMatch(/Opened demo\/webshop-/);
    expect(store.agent(lead.id).lead!.prs.length).toBeGreaterThan(0);
    const said = store.recentLines(lead.id).map((l) => l.text);
    expect(said).toContain('✻ GitHub answered the push in demo/webshop-frontend with HTTP 502: trying again (1 of 3)');
    expect(said).toContain('✻ GitHub answered opening the pull request with HTTP 502: trying again (2 of 3)');
  });

  it('gives up shipping after GitHub answers 5xx four times, and never retries other failures', async () => {
    let pushes = 0;
    let failure = 'The requested URL returned error: 503';
    const { agents, claude, project } = focus({
      ...demoWorkspace,
      push: async () => {
        pushes++;
        throw new Error(failure);
      },
    });
    agents.startGoal(project.id, 'Saved items');
    await until(() => claude.turns.length === 1);
    const ship = () => claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    await expect(ship()).rejects.toThrow('The requested URL returned error: 503');
    expect(pushes).toBe(4);

    pushes = 0;
    failure = '! [rejected] (stale info)';
    await expect(ship()).rejects.toThrow('stale info');
    expect(pushes).toBe(1);
  });

  it('carries the goal into the next slice, as the captain put it, at the captain’s next message once the last one has landed', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items\nShoppers keep a list across devices') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');

    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    // only the captain starts a goal lead's next turn: the landing is a note for then
    await new Promise((r) => setTimeout(r, 30));
    expect(leads()).toHaveLength(1);
    expect(store.agent(lead.id).status).toBe('done');
    expect(store.run(lead.id).notes).toEqual([expect.stringMatching(/^\[Ops\] Slice 1 has landed/)]);

    agents.message(lead.id, 'Go on');
    // the conversation carries on as it is: compacting is the captain's call
    await until(() => leads().length === 2);
    const next = leads()[1].req;
    expect(next.resumeSessionId).toBe('session-1');
    expect(next.prompt).toMatch(/^Slice 2 starts on fresh code/);
    expect(next.prompt).not.toContain('summarised');
    expect(next.prompt).toContain('The goal: Saved items\n\nAs the captain first put it:\n> Saved items\n> Shoppers keep a list across devices');
    expect(next.prompt).toMatch(/\[Ops\] Slice 1 has landed: .*\n\nGo on$/);
  });

  it('tells a lead whose slice lands mid-turn nothing until the captain’s next message, and moves their repos at the start of the next turn', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const branch = store.agent(lead.id).branch;

    // still in the turn they shipped from when the pull requests merge: nothing goes into it
    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    expect(leads()[0].sent).toEqual([]);
    expect(store.agent(lead.id).branch).toBe(branch);

    // and its end doesn't carry them on
    leads()[0].end({ ok: true, summary: 'Finished the next piece' });
    await until(() => store.agent(lead.id).status === 'done');
    await new Promise((r) => setTimeout(r, 30));
    expect(leads()).toHaveLength(1);
    agents.message(lead.id, 'Go ahead');
    await until(() => leads().length === 2);
    expect(leads()[1].req.prompt).toMatch(/^Slice 2 starts on fresh code/);
    expect(leads()[1].req.prompt).toMatch(/\[Ops\] Slice 1 has landed: .*\n\nGo ahead$/);
  });

  it('hands a lead mid-turn their notes with the captain’s message into the turn, ahead of it', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    agents.message(lead.id, 'And the header');
    expect(leads()[0].sent).toEqual([expect.stringMatching(/^\[Ops\] Slice 1 has landed/), 'And the header']);
    expect(store.run(lead.id).notes).toEqual([]);
    expect(store.run(lead.id).open?.sent).toEqual(leads()[0].sent);
  });

  it('counts a lead’s notes heard once they’re in, even when the message after them isn’t', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    leads()[0].refusing.push('And the header');
    agents.message(lead.id, 'And the header');
    expect(leads()[0].sent).toEqual([expect.stringMatching(/^\[Ops\] Slice 1 has landed/)]);
    expect(store.run(lead.id).notes).toEqual([]);
    expect(store.run(lead.id).inbox).toEqual(['And the header']);
  });

  it('lets a plugin wake a goal’s lead for a note, which goes ahead of its message', async () => {
    const { agents, claude, store, project } = focus();
    const heard: { from: string; about: string; inTurn: boolean }[] = [];
    agents.startPlugins([{
      id: 'waker',
      start: (host) => ({
        leadNoted: (lead, note) => {
          heard.push({ from: note.from, about: note.about.kind, inTurn: note.inTurn });
          if (note.about.kind === 'slice-landed') host.goals.message(lead.id, 'Carry on.', { from: note.from });
        },
      }),
    }], { demo: false, ownRepo: () => undefined });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');

    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    await until(() => leads().length === 2);
    expect(heard).toEqual([{ from: 'Ops', about: 'slice-landed', inTurn: false }]);
    expect(leads()[1].req.prompt).toMatch(/\[Ops\] Slice 1 has landed: .*\n\n\[Ops\] Carry on\.$/);
  });

  it('finishes the move to a new slice on their next message when its checkout failed', async () => {
    let failNext = false;
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      create: async (...args) => {
        // Focus restarted mid-move, killing git fetch
        if (failNext) {
          failNext = false;
          throw new Error('git fetch origin --prune failed');
        }
        return demoWorkspace.create(...args);
      },
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');

    failNext = true;
    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    agents.message(lead.id, 'Go on');
    await until(() => store.agent(lead.id).status === 'error');
    expect(leads()).toHaveLength(1);
    expect(store.agent(lead.id).lead!.repos).toEqual([]);

    agents.message(lead.id, 'Carry on');
    await until(() => leads().length === 2);
    const branch = store.agent(lead.id).branch;
    expect(store.agent(lead.id).lead!.repos.map((r) => r.repo)).toEqual(project.repos);
    const prompt = leads()[1].req.prompt;
    expect(prompt).toMatch(/^Slice 2 starts on fresh code/);
    expect(store.slice(lead.id)).toMatchObject({ phase: 'working', slice: 2, branch });
    expect(prompt).toContain(`- ./webshop-frontend: demo/webshop-frontend, on branch \`${branch}\``);
    expect(prompt).toContain('Carry on');
  });

  it('brings commits the lead hadn’t shipped along to the next slice', async () => {
    const picked: { dir: string; commits: string[] }[] = [];
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      // the lead carried on after shipping: a commit in each repo, and the API's won't apply to fresh code
      unshippedCommits: async (dir) => [dir.endsWith('/webshop-api') ? 'api-next' : 'web-next'],
      cherryPick: async (dir, commits) => {
        picked.push({ dir, commits });
        if (dir.endsWith('/webshop-api')) throw new Error('conflict');
      },
    });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');
    const firstBranch = store.agent(lead.id).branch;

    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    agents.message(lead.id, 'Go on');
    await until(() => leads().length === 2);
    expect(picked.map((p) => p.commits)).toEqual([['web-next'], ['api-next']]);
    const next = leads()[1].req.prompt;
    expect(next).toContain("- ./webshop-frontend: the commit you hadn't shipped came along onto the new branch.");
    expect(next).toContain(`- ./webshop-api: the commit you hadn't shipped didn't apply cleanly to fresh code, so it's only on \`${firstBranch}\`. Bring it over with \`git cherry-pick api-next\``);
  });

  it('never ships a repo again from a branch whose pull request merged: it gets a fresh branch with only the unshipped commits', async () => {
    const fresh: { dir: string; branch: string; base: string }[] = [];
    const picked: string[][] = [];
    const opened: { repo: string; head: string }[] = [];
    const recording = Layer.effect(GitHub, Effect.gen(function* () {
      const gh = yield* GitHub;
      return GitHub.of({ ...gh, createPullRequest: (repo, pr) => Effect.suspend(() => (opened.push({ repo, head: pr.head }), gh.createPullRequest(repo, pr))) });
    })).pipe(Layer.provide(demoLayer));
    const { agents, claude, store, project } = focus({
      ...demoWorkspace,
      push: async () => undefined,
      // the lead carried on after shipping: one new commit in each repo
      unshippedCommits: async (dir) => [dir.endsWith('/webshop-api') ? 'api-next' : 'web-next'],
      freshBranch: async (dir, branch, base) => void fresh.push({ dir, branch, base }),
      cherryPick: async (_dir, commits) => void picked.push(commits),
    }, recording);
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const ship = () => claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' }) as Promise<unknown>;
    await ship();
    const working = store.agent(lead.id).branch;
    const web = store.agent(lead.id).lead!.prs.find((p) => p.repo === 'demo/webshop-frontend')!;
    // the first ship renamed the slice's working branch after its work
    const first = web.branch!;
    expect(first).toBe(`focus/saved-items-first-slice-${working.slice(-4)}`);
    expect(store.agent(lead.id).lead!.repos.find((r) => r.repo === 'demo/webshop-frontend')!.branch).toBe(first);

    // the frontend's pull request is squash-merged while the API's stays open: the slice hasn't landed
    agents.prClosed(web.repo, web.number, true);
    const reply = JSON.stringify(await ship());
    expect(fresh).toEqual([{ dir: expect.stringMatching(/\/webshop-frontend$/) as unknown, branch: expect.not.stringMatching(first) as unknown, base: 'main' }]);
    expect(picked).toEqual([['web-next']]);
    // ...named after the slice's work, like the first
    const next = fresh[0].branch;
    expect(next).toMatch(/^focus\/saved-items-first-slice-/);
    const repos = store.agent(lead.id).lead!.repos;
    expect(repos.find((r) => r.repo === 'demo/webshop-frontend')!.branch).toBe(next);
    expect(repos.find((r) => r.repo === 'demo/webshop-api')!.branch).toBe(`focus/saved-items-first-slice-${working.slice(-4)}`);
    // a new pull request from the fresh branch; the API's open one is only updated
    expect(opened.slice(2)).toEqual([{ repo: 'demo/webshop-frontend', head: next }]);
    expect(reply).toContain(`./webshop-frontend's pull request from \`${first}\` has merged, so Ops moved it to a new branch, \`${next}\``);
    expect(store.agent(lead.id).lead!.prs.find((p) => p.repo === 'demo/webshop-frontend' && !p.outcome)!.branch).toBe(next);

    // shipping again leaves it on that branch, whose pull request is open
    await ship();
    expect(fresh).toHaveLength(1);
  });

  it('tells a lead whose conversation can’t be picked back up where the goal stands', async () => {
    const { agents, claude, store, project } = focus();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items\nShoppers keep a list across devices') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.prompt).not.toContain('new conversation');
    claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
    await until(() => store.agent(lead.id).status === 'done');

    store.agent(lead.id).sessionId = undefined;
    agents.message(lead.id, 'Go ahead');
    await until(() => claude.turns.length === 2);
    const fresh = claude.turns[1].req;
    expect(fresh.resumeSessionId).toBeUndefined();
    expect(fresh.prompt).toContain("You're carrying on with this goal in a new conversation");
    expect(fresh.prompt).toContain('> Shoppers keep a list across devices');
    expect(fresh.prompt).toMatch(/Go ahead$/);
  });

  it('seats an agent saved at a desk the room no longer has the next time they start', async () => {
    const { agents, claude, store, project } = focus();
    store.putAgent({
      id: 'old', name: 'Lt. Old', avatar: randomAvatar(), projectId: project.id, repo: 'demo/webshop-frontend', task: 'issue',
      issue: { number: 1, title: 'Dark mode', url: '' }, desk: 4, status: 'stopped', activity: 'Interrupted', sessionId: 'old-session',
      branch: 'focus/1-dark-mode', baseBranch: 'main', costUsd: 0, startedAt: 0,
    });
    agents.message('old', 'Carry on');
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.resumeSessionId).toBe('old-session');
    expect(store.agent('old').desk).toBe(0);
  });

  it('says why when a goal can’t have the station it asked for, and queues one when every station is taken', () => {
    const { agents, project } = focus();
    agents.startGoal(project.id, 'One', { station: 1 });
    expect(() => agents.startGoal(project.id, 'Two', { station: 1 })).toThrow('Team station 2 already has a goal: One');
    expect(() => agents.startGoal(project.id, ' ')).toThrow('Tell them what you’re after');
    for (const goal of ['Two', 'Three', 'Four']) agents.startGoal(project.id, goal);
    expect(agents.startGoal(project.id, 'Five')).toMatchObject({ queued: { text: 'Five' } });
  });

  it('carries QA’s pass over a clean merge of main without seating QA, never re-tests a commit with a verdict, and re-tests a real change', async () => {
    const { agents, claude, store, project } = focus();
    const repo = 'demo/webshop-frontend';
    const push = demoGitHub.demoPush!;
    const number = [...Array(20).keys()].find((n) => {
      try {
        push(repo, n, 'merge-base');
        return true;
      } catch {
        return false;
      }
    })!;
    const report: QaReport = { verdict: 'pass', summary: 'Works', checks: [], commands: [], captions: [] };
    const passedAt = (sha: string) => store.reviewJournal(prKey(repo, number), { kind: 'imported', review: { projectId: project.id, repo, number, title: 'PR', status: 'passed', sha, report, requestedAt: 1, finishedAt: 2 } });
    passedAt(push(repo, number, 'change'));

    // the same commit again: back to its verdict
    agents.requestReview(project.id, repo, number, 'PR');
    await until(() => store.reviews.get(`${repo}#${number}`)?.status === 'passed');

    // a merge of main: checks only, and the pass moves onto the new head, keeping a merge the captain asked for meanwhile
    const merged = push(repo, number, 'merge-base');
    agents.requestReview(project.id, repo, number, 'PR');
    agents.requestMerge(repo, number, true);
    await until(() => store.reviews.get(`${repo}#${number}`)?.sha === merged);
    expect(store.reviews.get(`${repo}#${number}`)).toMatchObject({ status: 'passed', carriedFrom: expect.any(String) as unknown, mergeRequested: { at: expect.any(Number) as unknown } });
    agents.requestMerge(repo, number, false);

    // a change of its own: QA tests it
    push(repo, number, 'change');
    agents.requestReview(project.id, repo, number, 'PR');
    await until(() => claude.turns.length === 1);
    expect(claude.turns[0].req.prompt).toContain(`#${number}`);
  });

  /** A demo pull request the tests can push to, and its head. */
  const pushable = () => {
    const repo = 'demo/webshop-frontend';
    const push = demoGitHub.demoPush!;
    const number = [...Array(20).keys()].find((n) => {
      try {
        push(repo, n, 'change');
        return true;
      } catch {
        return false;
      }
    })!;
    return { repo, number, push: () => push(repo, number, 'change') };
  };

  it('re-tests a lead’s ship after a verdict even while GitHub still answers with the commit QA tested', async () => {
    const { agents, claude, store, project } = focus();
    const { repo, number, push } = pushable();
    const report: QaReport = { verdict: 'fail', summary: 'Broken', checks: [], commands: [], captions: [] };
    store.reviewJournal(prKey(repo, number), { kind: 'imported', review: { projectId: project.id, repo, number, title: 'PR', status: 'failed', sha: push(), report, requestedAt: 1, finishedAt: 2 } });

    // GitHub hasn't caught up with the push yet: its head is still the one QA failed
    agents.requestReview(project.id, repo, number, 'PR', undefined, false, 'abc1234def5678');
    await until(() => claude.turns.length === 1);
    expect(store.reviews.get(`${repo}#${number}`)).toMatchObject({ status: 'testing', shippedHead: 'abc1234def5678' });
  });

  it('sends a PR the lead shipped again while QA tested it straight back to QA once they give their verdict', async () => {
    const { agents, claude, store, project } = focus();
    const { repo, number, push } = pushable();
    agents.requestReview(project.id, repo, number, 'PR');
    await until(() => claude.turns.length === 1);
    const tested = store.reviews.get(`${repo}#${number}`)?.sha;

    // the lead ships a fix while QA is still at the commit before
    const shipped = push();
    agents.requestReview(project.id, repo, number, 'PR', undefined, false, shipped);
    expect(store.reviews.get(`${repo}#${number}`)).toMatchObject({ status: 'testing', sha: tested, shippedHead: shipped });

    claude.turns[0].end({ ok: true, summary: '', structured: { verdict: 'fail', summary: 'Broken.', checks: [], commands: [], files: [] } });
    await until(() => claude.turns.length === 2);
    expect(claude.turns[1].req.prompt).toContain(`#${number}`);
  });

  describe('moving to the cloud', () => {
    const issue = { number: 1, title: 'Add a dark mode toggle to the header' };

    it('moves a working agent to a cloud session a terminal starts, carrying on from their branch', async () => {
      const { agents, claude, store, project } = focus();
      const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
      await until(() => claude.turns.length === 1);
      expect(claude.turns[0].req.cloud).toBeUndefined();

      await agents.moveToCloud(id);
      expect(claude.turns[0].stopped).toBe(true);
      const waiting = store.agent(id);
      expect(waiting).toMatchObject({ status: 'waiting', cloud: true, handover: { fresh: false, localSessionId: 'session-1' } });
      expect(waiting.sessionId).toBeUndefined();

      // the terminal shows the session's link once it has started it
      claude.shown = 'Starting a cloud session…\n\x1b[2m☁ https://claude.ai/code/session_01abcDEF234\x1b[0m';
      await agents.openCloudTerminal(id);
      expect(claude.terminals).toEqual([{ agentId: id, agentName: waiting.name, cwd: `/demo/${id}`, description: expect.stringMatching(/reply only with the word Ready\.$/) }]);
      await until(() => claude.turns.length === 2);
      const attach = claude.turns[1].req;
      expect(attach).toMatchObject({ resumeSessionId: 'session_01abcDEF234', cloud: { branch: waiting.branch } });
      // a session the captain started gets Ops' instructions with the work
      expect(attach.prompt).toMatch(/^# You are .*\n---\n\nYou're taking over GitHub issue #1/s);
      expect(store.agent(id)).toMatchObject({ handover: undefined, cloud: true, sessionId: 'session_01abcDEF234', status: 'working' });
    });

    it('has a cloud hire Claude Code won’t start without a terminal wait for the session the captain pastes', async () => {
      const { agents, claude, store, project } = focus();
      const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue, { cloud: true });
      await until(() => claude.turns.length === 1);
      claude.turns[0].end({ ok: false, summary: '', error: CLOUD_UNAVAILABLE });
      await until(() => !!store.agent(id).handover);
      expect(store.agent(id)).toMatchObject({ status: 'waiting', cloud: true, handover: { fresh: true } });

      agents.message(id, 'Use CSS variables');
      await expect(agents.attachCloud(id, 'https://claude.ai/code')).rejects.toThrow(/isn’t a cloud session/);
      await agents.attachCloud(id, 'https://claude.ai/code/session_01XYZabc999');
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req.resumeSessionId).toBe('session_01XYZabc999');
      // they start their task there, and hear what the captain said meanwhile
      expect(claude.turns[1].req.prompt).toContain('Add a dark mode toggle to the header');
      expect(claude.turns[1].sent).toEqual(['Use CSS variables']);

      // a session Ops couldn't attach to leaves them waiting for another
      claude.turns[1].end({ ok: false, summary: '', error: 'cloud session session_01XYZabc999 not found' });
      await until(() => !!store.agent(id).handover);
      expect(store.agent(id)).toMatchObject({ status: 'waiting', handover: { fresh: true } });
      expect(claude.turns).toHaveLength(2);
    });

    it('carries a cloud hire on here when Claude Code won’t attach to the session the captain started, and stops sending later ones to wait', async () => {
      const { agents, claude, store, project } = focus();
      const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue, { cloud: true });
      await until(() => claude.turns.length === 1);
      claude.turns[0].end({ ok: false, summary: '', error: CLOUD_UNAVAILABLE });
      await until(() => !!store.agent(id).handover);
      await agents.attachCloud(id, 'https://claude.ai/code/session_01XYZabc999');
      await until(() => claude.turns.length === 2);

      // Claude Code refuses --cloud <session_id> with the SDK's stream-json: they start their task on this machine
      claude.turns[1].end({ ok: false, summary: '', error: CLOUD_UNAVAILABLE });
      await until(() => claude.turns.length === 3);
      expect(claude.turns[2].req).toMatchObject({ cloud: undefined, resumeSessionId: undefined });
      expect(claude.turns[2].req.prompt).toContain('Add a dark mode toggle to the header');
      expect(store.agent(id)).toMatchObject({ status: 'working', handover: undefined, cloud: undefined, sessionId: 'session-1' });
      const said = store.recentLines(id).map((l) => l.text);
      expect(said.filter((t) => t === CARRYING_ON_HERE)).toHaveLength(1);
      expect(said.some((t) => t.includes('Couldn’t attach') || t.includes("Couldn't attach"))).toBe(false);

      // the next cloud hire Claude Code won't start a session for carries on here rather than waiting for one
      const next = agents.hire(project.id, 'demo/webshop-api', { number: 2, title: 'Rate-limit the login endpoint' }, { cloud: true });
      await until(() => claude.turns.length === 4);
      claude.turns[3].end({ ok: false, summary: '', error: CLOUD_UNAVAILABLE });
      await until(() => claude.turns.length === 5);
      expect(claude.turns[4].req).toMatchObject({ cloud: undefined, resumeSessionId: undefined });
      expect(store.agent(next.id)).toMatchObject({ status: 'working', handover: undefined, cloud: undefined });
      expect(store.recentLines(next.id).map((l) => l.text)).toContain(CARRYING_ON_HERE);
    });

    it('carries a moved agent on here, in their own conversation, when Claude Code won’t attach to their cloud session', async () => {
      const { agents, claude, store, project } = focus();
      const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
      await until(() => claude.turns.length === 1);
      await agents.moveToCloud(id);
      await agents.attachCloud(id, 'https://claude.ai/code/session_01XYZabc999');
      await until(() => claude.turns.length === 2);

      claude.turns[1].end({ ok: false, summary: '', error: CLOUD_UNAVAILABLE });
      await until(() => claude.turns.length === 3);
      expect(claude.turns[2].req).toMatchObject({ cloud: undefined, resumeSessionId: 'session-1' });
      expect(claude.turns[2].req.prompt).toMatch(/^Carry on with the work from where it was left off/);
      expect(store.agent(id)).toMatchObject({ status: 'working', handover: undefined, cloud: undefined, sessionId: 'session-1' });
    });

    it('keeps a waiting agent here: one who hasn’t started starts their task on this machine', async () => {
      const { agents, claude, store, project } = focus();
      const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue, { cloud: true });
      await until(() => claude.turns.length === 1);
      claude.turns[0].end({ ok: false, summary: '', error: CLOUD_UNAVAILABLE });
      await until(() => !!store.agent(id).handover);

      await agents.stayLocal(id);
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req).toMatchObject({ cloud: undefined, resumeSessionId: undefined });
      expect(store.agent(id)).toMatchObject({ handover: undefined, cloud: undefined });
    });

    it('takes back a moved agent who stays, with their own conversation, until the captain says carry on', async () => {
      const { agents, claude, store, project } = focus();
      const { id } = agents.hire(project.id, 'demo/webshop-frontend', issue);
      await until(() => claude.turns.length === 1);
      await agents.moveToCloud(id);
      await expect(agents.moveToCloud(id)).rejects.toThrow(/already waiting/);

      agents.stop(id);
      await until(() => !store.agent(id).handover);
      expect(store.agent(id)).toMatchObject({ status: 'stopped', cloud: undefined, sessionId: 'session-1' });
      agents.message(id, 'Carry on here');
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req).toMatchObject({ resumeSessionId: 'session-1', cloud: undefined, prompt: 'Carry on here' });
    });
  });

  describe('when the plan’s usage limit is reached', () => {
    /** A lead mid-turn, `tokens` into their conversation, whom the plan's limit stops for `ms`. */
    async function limitedLead(tokens: number, ms: number) {
      const { agents, claude, store, project } = focus();
      // holding a long conversation, not compacting it, is what these are about
      store.settings.leadCompactAt = 0;
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      claude.turns[0].hooks.context!({ percent: 60, tokens, max: 1_000_000 });
      // what the runner does when Claude Code reports the limit
      keyFallback.limitHit(Date.now() + ms);
      claude.turns[0].end({ ok: false, summary: '', limited: true, started: true });
      return { agents, claude, store, id: lead.id };
    }

    it('carries a short conversation straight on with the API key', async () => {
      const { claude, store, id } = await limitedLead(20_000, 300);
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req).toMatchObject({ resumeSessionId: 'session-1', prompt: CARRY_ON_AFTER_LIMIT });
      expect(store.agent(id).held).toBeUndefined();
      await new Promise((r) => setTimeout(r, 300));
    });

    it('holds a long one, asks the captain before picking it up on the key, and holds anyone else’s news', async () => {
      const { agents, claude, store, id } = await limitedLead(600_000, 300);
      await until(() => !!store.agent(id).held);
      expect(store.agent(id).status).toBe('stopped');
      const lines = store.recentLines(id).length;

      // a question they'd asked stays open while the captain's message hasn't gone
      store.agent(id).lead!.questions = [{ id: 'q1', question: 'Which?', options: [], at: 1 }];
      expect(agents.message(id, 'Go on')).toEqual({ costly: { usd: 3, tokens: 600_000, resetsAt: store.agent(id).held!.until } });
      expect(store.recentLines(id)).toHaveLength(lines);
      expect(openQuestion(store.agent(id))).toBeDefined();
      expect(agents.message(id, 'QA passed it', 'QA')).toEqual({ sent: true });
      expect(agents.message(id, 'Go on', undefined, 'wait')).toEqual({ sent: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(claude.turns).toHaveLength(1);

      expect(agents.message(id, 'Now, please', undefined, 'key')).toEqual({ sent: true });
      await until(() => claude.turns.length === 2);
      const turn = claude.turns[1];
      expect(turn.req.resumeSessionId).toBe('session-1');
      expect([turn.req.prompt, ...turn.sent].join('\n\n')).toBe(`${CARRY_ON_AFTER_LIMIT}\n\n[QA] QA passed it\n\nGo on\n\nNow, please`);
      expect(store.agent(id).held).toBeUndefined();
      await new Promise((r) => setTimeout(r, 300));
    });

    it('picks a held conversation back up when the limit resets, unless the captain stopped them', async () => {
      const { claude, store, id } = await limitedLead(600_000, 200);
      await until(() => !!store.agent(id).held);
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req).toMatchObject({ resumeSessionId: 'session-1', prompt: CARRY_ON_AFTER_LIMIT });
      expect(store.agent(id).held).toBeUndefined();

      const second = await limitedLead(600_000, 200);
      await until(() => !!second.store.agent(second.id).held);
      second.agents.stop(second.id);
      await new Promise((r) => setTimeout(r, 1500));
      expect(second.claude.turns).toHaveLength(1);
    });
  });

  describe('a lead’s big conversation', () => {
    /** A goal's lead whose first turn ended `tokens` into their conversation. */
    async function bigLead(tokens: number) {
      const { agents, claude, store, project } = focus();
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      claude.turns[0].hooks.context!({ percent: 25, tokens, max: 1_000_000 });
      claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
      await until(() => store.agent(lead.id).status === 'done');
      return { agents, claude, store, id: lead.id };
    }

    it('is compacted, keeping what the goal needs, before their next turn picks it back up', async () => {
      const { agents, claude, store, id } = await bigLead(250_000);
      agents.message(id, 'Go ahead');
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req).toMatchObject({ resumeSessionId: 'session-1' });
      expect(claude.turns[1].req.prompt).toMatch(/^\/compact Summarise this conversation for the lead of the goal "Saved items"/);
      claude.turns[1].hooks.context!({ percent: 4, tokens: 40_000, max: 1_000_000 });
      claude.turns[1].end({ ok: true, summary: '' });
      await until(() => claude.turns.length === 3);
      expect(claude.turns[2].req).toMatchObject({ resumeSessionId: 'session-1', prompt: 'Go ahead' });
      claude.turns[2].end({ ok: true, summary: 'Shipped' });
      await until(() => store.agent(id).status === 'done');
    });

    it('carries straight on under the threshold, or with it switched off', async () => {
      const small = await bigLead(150_000);
      small.agents.message(small.id, 'Go ahead');
      await until(() => small.claude.turns.length === 2);
      expect(small.claude.turns[1].req.prompt).toBe('Go ahead');

      const off = await bigLead(600_000);
      off.store.settings.leadCompactAt = 0;
      off.agents.message(off.id, 'Go ahead');
      await until(() => off.claude.turns.length === 2);
      expect(off.claude.turns[1].req.prompt).toBe('Go ahead');
    });

    it('carries on as it is when compacting fails, and doesn’t try again in that conversation', async () => {
      const { agents, claude, store, id } = await bigLead(250_000);
      agents.message(id, 'Go ahead');
      await until(() => claude.turns.length === 2);
      claude.turns[1].end({ ok: false, summary: '', error: 'no room' });
      await until(() => claude.turns.length === 3);
      expect(claude.turns[2].req).toMatchObject({ resumeSessionId: 'session-1', prompt: 'Go ahead' });
      claude.turns[2].hooks.context!({ percent: 30, tokens: 300_000, max: 1_000_000 });
      claude.turns[2].end({ ok: true, summary: 'Shipped' });
      await until(() => store.agent(id).status === 'done');
      agents.message(id, 'And the next');
      await until(() => claude.turns.length === 4);
      expect(claude.turns[3].req.prompt).toBe('And the next');
    });
  });

  describe('installing dependencies', () => {
    /** A workspace whose installs fail everywhere but in the api's checkouts, noting where each ran. */
    function installs() {
      const ran: string[] = [];
      const workspace: WorkspaceOps = {
        ...demoWorkspace,
        install: async (dir) => {
          ran.push(dir);
          return dir.endsWith('webshop-api') ? undefined : `Couldn't install in ${dir}`;
        },
      };
      return { ran, workspace };
    }

    it('installs in a new checkout before the agent starts, and tells them up front when it fails', async () => {
      const { ran, workspace } = installs();
      const { agents, claude, project } = focus(workspace);
      const { id } = auditor(agents).host().seat(project.id, 'demo/webshop-frontend', { id: 'auditor', kind: 'audit', title: 'Auditing', branch: 'focus/audit-1', baseBranch: 'main' });
      await until(() => claude.turns.length === 1);
      expect(ran).toEqual([`/demo/${id}`]);
      expect(claude.turns[0].req.prompt).toContain(`Couldn't install in /demo/${id}`);
    });

    it('installs in each of a lead’s repos, and the lead hears which failed', async () => {
      const { ran, workspace } = installs();
      const { agents, claude, project } = focus(workspace);
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      expect(ran).toEqual([expect.stringMatching(new RegExp(`${lead.id}/webshop-frontend$`)), expect.stringMatching(new RegExp(`${lead.id}/webshop-api$`))]);
      expect(claude.turns[0].req.prompt).toContain(`Couldn't install in ${ran[0]}`);
      expect(claude.turns[0].req.prompt).not.toContain(`Couldn't install in ${ran[1]}`);
    });
  });

  describe('a plugin’s lead tool', () => {
    it('puts its page on the lead’s screen with pictures of it at the moments it asks for, and answers the lead with them', async () => {
      const { agents, claude, store, project } = focus();
      project.plugins = ['framer'];
      agents.startPlugins([{
        id: 'framer',
        start: () => ({
          leadTools: [{
            name: 'frame',
            description: 'Frames a page',
            input: {},
            run: async (lead) => {
              const shown = await lead.showFrames({ id: 'film', title: 'A film', html: '<p>film</p>' }, { at: [1, 2.5], clip: { x: 0, y: 0, width: 100, height: 50 } });
              return { text: `${shown.text} Saw ${shown.frames.map((f) => JSON.stringify(f.seen)).join(', ')}`, images: shown.frames.map((f) => f.image) };
            },
          }],
        }),
      }], { demo: false, ownRepo: () => undefined });
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      const [frame] = claude.turns[0].req.tools!.extra!;
      const reply = await frame.run({});
      if (typeof reply === 'string') throw new Error(`No pictures came back: ${reply}`);
      expect(reply.text).toMatch(/“A film” is on your station's screen.* Saw \{"flat":0.7,"labels":\[\]\}, \{"flat":0.7,"labels":\[\]\}$/);
      expect(reply.images.map(String)).toEqual(['beat at 1', 'beat at 2.5']);
      expect(store.agent(lead.id).lead!.artifacts).toEqual([{ id: 'film', title: 'A film', at: expect.any(Number), image: true, slice: 1 }]);
    });
  });

  describe('a plugin’s brief', () => {
    it('hands it to an agent away from the room’s desks, and opens their pull request as the plugin names it', async () => {
      const { agents, claude, store, project } = focus();
      const auditing = auditor(agents);
      const agent = auditing.host().seat(project.id, 'demo/webshop-frontend', { id: 'auditor', kind: 'audit', title: 'Auditing', branch: 'focus/audit-1', baseBranch: 'main' });
      expect(agent).toMatchObject({ task: 'brief', desk: AWAY_DESK, brief: { plugin: 'auditor', kind: 'audit', label: 'Audit', icon: '🔎' } });
      await until(() => claude.turns.length === 1);
      expect(claude.turns[0].req.prompt).toBe('Audit demo/webshop-frontend.');
      expect(claude.turns[0].req.systemAppend).toContain('You are the auditor.');
      expect(claude.turns[0].req.systemAppend).toContain('End with a title.');

      claude.turns[0].end({ ok: true, summary: '# Tighten the checks\n\nThree gaps.' });
      await until(() => !!store.agent(agent.id).pr);
      const pr = store.agent(agent.id).pr!;
      expect(store.agent(agent.id).issue.title).toBe('Tighten the checks');
      expect(auditing.heard).toEqual([`opened #${pr.number}`]);
      // its pull request is the plugin's to merge or not, even once the agent's gone
      expect(agents.plugins.captainMerges({ branch: 'focus/audit-1' })).toBe(true);
      expect(agents.plugins.captainMerges({ branch: 'focus/7-cart' })).toBe(false);

      agents.prClosed('demo/webshop-frontend', pr.number, true, 'captain');
      expect(auditing.heard).toEqual([`opened #${pr.number}`, `closed #${pr.number}`]);
    });

    it('tells plugins of a goal’s pull request merging, once the goal knows it has', async () => {
      const { agents, claude, store, project } = focus();
      const auditing = auditor(agents);
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      await claude.turns[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
      const [pr] = store.agent(lead.id).lead!.prs;
      agents.prClosed(pr.repo, pr.number, true);
      expect(auditing.heard).toEqual([`closed #${pr.number}`]);
      expect(store.agent(lead.id).lead!.prs[0].outcome).toBe('merged');
    });

    it('tells plugins as each turn starts and ends, one cut short too, and of each line in the ledger, and lends them transcripts', async () => {
      const { agents, claude, store, project } = focus();
      const heard: string[] = [];
      let lent: PluginHost | undefined;
      agents.startPlugins([{
        id: 'watcher',
        start: (host) => {
          lent = host;
          return { turn: (a, phase) => void heard.push(`${a.task} ${phase}`), ledgerRecorded: (e) => void heard.push(e.kind) };
        },
      }], { demo: false, ownRepo: () => undefined });
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      expect(heard).toEqual(['lead start']);
      claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
      await until(() => store.agent(lead.id).status === 'done');
      agents.message(lead.id, 'Go ahead');
      await until(() => claude.turns.length === 2);
      expect(lent!.agents().map((a) => a.id)).toEqual([lead.id]);
      await agents.dismiss(lead.id);
      expect(heard).toEqual(['lead start', 'lead end', 'lead start', 'lead end']);
      agents.record(project.id, { kind: 'closed', repo: 'demo/webshop-api', pr: 3, by: 'github', qa: 'none', failedRounds: 0, triages: 0 });
      expect(heard.at(-1)).toBe('closed');

      expect(await lent!.transcript('session-1')).toBeUndefined();
      agents.readTranscript = (id) => Promise.resolve(`the transcript of ${id}`);
      expect(await lent!.transcript('session-1')).toBe('the transcript of session-1');
    });

    it('checks out only the captain’s repos for a plugin, and lends it Focus’s own checkout', async () => {
      const { agents } = focus();
      const host = auditor(agents).host();
      await expect(host.checkout('someone/else')).rejects.toThrow('someone/else isn’t one of the captain’s repositories');
      expect(fs.existsSync(path.join(host.focusDir, 'package.json'))).toBe(true);
    });

    it('lends a plugin copies: what it changes of the agents, projects, settings and ledger it reads never reaches Focus', async () => {
      const { agents, claude, store, project } = focus();
      let lent: PluginHost | undefined;
      const heard: string[] = [];
      agents.startPlugins([{
        id: 'meddler',
        start: (host) => {
          lent = host;
          return {
            // a plugin that writes to what its hook hears of (past the read-only type, as plain JavaScript could)
            turn: (agent) => {
              heard.push(agent.name);
              Object.assign(agent, { name: 'Meddled', status: 'failed' });
            },
          };
        },
      }], { demo: false, ownRepo: () => undefined });
      const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
      await until(() => claude.turns.length === 1);
      const name = store.agent(lead.id).name;
      expect(heard).toEqual([name]);
      expect(store.agent(lead.id)).toMatchObject({ name, status: 'working' });

      const host = lent!;
      Object.assign(host.agent(lead.id)!, { name: 'Meddled' });
      Object.assign(host.agents()[0], { name: 'Meddled' });
      Object.assign(host.projects()[0], { name: 'Meddled' });
      Object.assign(host.settings(), { model: 'meddled' });
      agents.record(project.id, { kind: 'closed', repo: 'demo/webshop-api', pr: 3, by: 'github', qa: 'none', failedRounds: 0, triages: 0 });
      const ledger = host.ledger();
      Object.assign(ledger[0], { repo: 'meddled/repo' });
      ledger.length = 0;
      expect(store.agent(lead.id).name).toBe(name);
      expect(store.projects[0].name).toBe(project.name);
      expect(store.settings.model).not.toBe('meddled');
      expect(store.ledger.at(-1)).toMatchObject({ kind: 'closed', repo: 'demo/webshop-api' });

      // and printing on its copy prints on Focus's own agent
      host.print(host.agent(lead.id)!, 'From the meddler');
      expect(store.recentLines(lead.id).at(-1)).toMatchObject({ kind: 'system', text: 'From the meddler' });
      await agents.dismiss(lead.id);
    });

    it('keeps the plugin’s state in its own slot, with what it adds later filled in fresh', () => {
      const { agents, store } = focus();
      const host = auditor(agents).host();
      const state = host.state(() => ({ audits: 0, strict: false }));
      state.set({ audits: 1 });
      expect(store.plugins.auditor).toEqual({ audits: 1, strict: false });
      expect(agents.plugins.states()).toEqual({ auditor: { audits: 1, strict: false } });
      store.plugins.auditor = { audits: 2 };
      expect(state.get()).toEqual({ audits: 2, strict: false });
    });

    it('lends plugins the ledger to write in, the captain’s settings, and filing issues only in the project’s own repos', async () => {
      const { agents, store, project } = focus();
      const filed: string[] = [];
      let lent: PluginHost | undefined;
      agents.startPlugins([{ id: 'filer', start: (host) => ((lent = host), {}) }], {
        demo: false,
        ownRepo: () => undefined,
        fileIssue: (projectId, repo, title, body) => (filed.push(`${projectId} ${repo} ${title}`), Promise.resolve<Issue>({ repo, number: 7, title, body, url: `https://github.com/${repo}/issues/7`, labels: [], createdAt: '' })),
      });
      const host = lent!;
      host.record(project.id, { kind: 'closed', repo: 'demo/webshop-api', pr: 3, by: 'github', qa: 'none', failedRounds: 0, triages: 0 }, 1000);
      expect(store.ledger.at(-1)).toMatchObject({ kind: 'closed', projectId: project.id, at: 1000 });
      store.settings.model = 'claude-opus-5-5';
      expect(host.settings().model).toBe('claude-opus-5-5');
      expect((await host.fileIssue(project.id, 'demo/webshop-api', 'Ports', 'body')).number).toBe(7);
      await expect(host.fileIssue(project.id, 'someone/else', 'Ports', 'body')).rejects.toThrow('someone/else isn’t one of Shop’s repositories');
      await expect(host.fileIssue('nowhere', 'demo/webshop-api', 'Ports', 'body')).rejects.toThrow('isn’t one of the project’s repositories');
      expect(filed).toEqual([`${project.id} demo/webshop-api Ports`]);
    });

    it('lends plugins Focus’s snapshot and the ship’s status, and the captain’s goals to act on', async () => {
      const { agents, claude, store, project } = focus();
      let lent: PluginHost | undefined;
      agents.startPlugins([{ id: 'xo', start: (host) => ((lent = host), {}) }], {
        demo: false,
        ownRepo: () => undefined,
        snapshot: () => Promise.resolve({ projects: store.projects } as Snapshot),
        shipStatus: () => Promise.resolve({ projects: [] }),
      });
      const host = lent!;
      expect((await host.snapshot()).projects).toEqual([project]);
      expect(await host.shipStatus()).toEqual({ projects: [] });

      const started = host.goals.start(project.id, 'Saved items', { from: 'a call' });
      if (!('agent' in started)) throw new Error('the goal should have a station');
      const lead = started.agent;
      expect(store.recentLines(lead.id).map((l) => l.text)).toContain('▶ Captain, from a call: Saved items');
      await until(() => claude.turns.length === 1);
      claude.turns[0].end({ ok: true, summary: 'Proposed a slice' });
      await until(() => store.agent(lead.id).status === 'done');
      expect(host.goals.message(lead.id, 'Go ahead')).toEqual({ sent: true });
      await until(() => claude.turns.length === 2);
      expect(claude.turns[1].req.prompt).toContain('Go ahead');
    });

    it('tells a plugin, in a test, that Focus has no snapshot or ship’s status to lend', async () => {
      const { agents } = focus();
      const host = auditor(agents).host();
      await expect(host.snapshot()).rejects.toThrow('Focus has no snapshot to lend here');
      await expect(host.shipStatus()).rejects.toThrow('Focus has no ship’s status to lend here');
    });
  });
});
