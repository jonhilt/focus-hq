import { Effect, Layer, Schedule } from 'effect';
import { describe, expect, it } from 'vitest';
import { randomAvatar } from '../../shared/crew';
import * as demoGitHub from '../github/demo';
import { prKey } from '../../shared/qa';
import { demoLayer } from '../github/demo';
import { GhServerError } from '../github/runner';
import { GitHub } from '../github/service';
import { Hub } from '../hub';
import { Store } from '../store';
import { demoWorkspace } from './demoRunner';
import { AgentManager } from './manager';
import { Renderer, Sessions, ShipRetry, Triage, Workspace } from './services';
import type { PullRequest, QaReport } from '../../shared/types';
import type { AgentRunner, AgentSession, RunHooks, RunOutcome, RunRequest, WorkspaceOps } from './types';

/** A Claude Code stand-in: each turn runs until the test ends it, and remembers being stopped and what it was sent. */
class FakeClaude implements AgentRunner {
  turns: { req: RunRequest; hooks: RunHooks; end: (outcome: RunOutcome) => void; stopped: boolean; sent: string[] }[] = [];

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    let end!: (outcome: RunOutcome) => void;
    const done = new Promise<RunOutcome>((resolve) => (end = resolve));
    const turn = { req, hooks, end, stopped: false, sent: [] as string[] };
    this.turns.push(turn);
    hooks.session(req.resumeSessionId ?? 'session-1');
    return {
      send: (text) => (turn.sent.push(text), true),
      stop: () => {
        turn.stopped = true;
        end({ ok: false, summary: '', aborted: true });
      },
      done,
    };
  }
}

function office(workspace: WorkspaceOps = demoWorkspace, github: Layer.Layer<GitHub> = demoLayer) {
  const store = new Store(false);
  const project = store.addProject('Shop');
  project.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
  const claude = new FakeClaude();
  const services = Layer.mergeAll(
    github,
    // retries after a GitHub 5xx come straight away
    Layer.succeed(ShipRetry, Schedule.spaced(0)),
    Workspace.fromOps(workspace),
    Sessions.fromRunner(claude),
    Triage.fromTriager({ triage: () => Promise.reject(new Error('no officer here')) }),
    Renderer.fromBrowser({ render: (html) => (html.includes('unrenderable') ? Promise.reject(new Error('no browser')) : Promise.resolve(Buffer.from('jpeg'))) }),
  );
  return { store, project, claude, agents: new AgentManager(store, new Hub(), services, () => undefined) };
}

/** Waits (a few seconds at most) for the office to get there. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

describe('AgentManager', () => {
  it('runs a goal’s lead one turn at a time, however often the office schedules', async () => {
    const { agents, claude, store, project } = office();
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

  it('stops a QA session whose PR merged, and won’t resume it for a message', async () => {
    const { agents, claude, store, project } = office();
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

  it('stops their Claude Code session when they’re sent home', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await agents.dismiss(lead.id);
    expect(claude.turns[0].stopped).toBe(true);
    expect(store.agents.has(lead.id)).toBe(false);
  });

  it('commits a closing goal’s uncommitted work as a WIP snapshot on its branch before its checkouts go', async () => {
    const steps: string[] = [];
    let saves = true;
    let shipMidClose: Promise<unknown> | undefined;
    const { agents, claude, store, project } = office({
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
      `Uncommitted changes in ./webshop-frontend and ./webshop-api are committed as a WIP snapshot on \`${branch}\`, kept only in the office’s clone.`,
      `./webshop-api’s branch \`${branch}\` never reached GitHub: its 2 commits stay only in the office’s clone.`,
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

  it('reopens a closed goal on its branch, with the same lead picking their conversation back up', async () => {
    const reopened: { id: string; branch: string }[] = [];
    const { agents, claude, store, project } = office({ ...demoWorkspace, reopen: async (_repo, id, branch) => (reopened.push({ id, branch }), `/demo/${id}`) });
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
    expect(reopened).toEqual(work!.repos.map((r) => ({ id: `${lead.id}/${r.folder}`, branch })));
    expect(leads()[1].req.resumeSessionId).toBe('session-1');
    expect(leads()[1].req.prompt).toMatch(new RegExp(`^\\[Office\\] The captain reopened this goal, .* checked out again on \`${branch}\`, as you left them: \\./webshop-frontend, \\./webshop-api\\. .* Still open on GitHub: `));
    expect(store.agent(lead.id).lead).toMatchObject({ repos: work!.repos, prs: work!.prs });

    // Claude Code no longer has the conversation: a new one hears where the goal stands
    leads()[1].end({ ok: false, summary: '', error: 'No conversation found with session ID: session-1' });
    await until(() => leads().length === 3);
    expect(leads()[2].req.resumeSessionId).toBeUndefined();
    expect(leads()[2].req.prompt).toContain("You're carrying on with this goal in a new conversation");
    expect(leads()[2].req.prompt).toContain('[Office] The captain reopened this goal');
  });

  it('checks a reopened goal’s repos out again before picking up its conversation, however often that fails first', async () => {
    let failures = 1;
    const reopened: string[] = [];
    const { agents, claude, store, project } = office({
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
    expect(leads()[1].req.prompt).toMatch(/^\[Office\] The captain reopened this goal, [^]*\n\nTry again\?$/);
    expect(store.agent(lead.id).lead).toMatchObject({ repos, reopening: undefined });
  });

  it('files a reopened goal that never got its repos back so it can be reopened again', async () => {
    const { agents, claude, store, project } = office({ ...demoWorkspace, reopen: () => Promise.reject(new Error('fetch failed')) });
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
    const { agents, claude, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    await agents.closeGoal(lead.id, true);
    for (const text of ['One', 'Two', 'Three', 'Four']) agents.startGoal(project.id, text);
    expect(() => agents.reopenGoal(project.id, lead.id)).toThrow(/Every team station in Shop has a goal: close one first/);
    expect(project.goals?.map((g) => g.id)).toEqual([lead.id]);
  });

  it('puts what the lead shows on their goal, with a picture when it can take one, until the goal closes', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => claude.turns.length === 1);
    const show = (input: { id: string; title: string; html: string }) => claude.turns[0].req.tools!.show(input);
    expect(await show({ id: 'data-flow', title: 'Data flow', html: '<h1>Flow</h1>' })).toMatch(/“Data flow” is on your station's screen/);
    expect(await show({ id: 'mockup', title: 'Mockup', html: '<p>unrenderable</p>' })).toMatch(/couldn't take a picture of it for the screen \(no browser\)/);
    await expect(show({ id: '../etc', title: 'Nope', html: '<p>x</p>' })).rejects.toThrow(/lowercase letters/);
    expect(store.agent(lead.id).lead!.artifacts).toEqual([
      { id: 'data-flow', title: 'Data flow', at: expect.any(Number), image: true },
      { id: 'mockup', title: 'Mockup', at: expect.any(Number) },
    ]);
    expect((await store.readArtifact(lead.id, 'data-flow.html'))?.toString()).toBe('<h1>Flow</h1>');
    expect(await store.readArtifact(lead.id, 'data-flow.jpg')).toBeDefined();
    expect(await store.readArtifact(lead.id, 'mockup.jpg')).toBeUndefined();

    await agents.closeGoal(lead.id, true);
    expect(await store.readArtifact(lead.id, 'data-flow.html')).toBeUndefined();
  });

  it('merges the base into a slice’s conflicting PR itself, and tells the lead to pull once their turn is over', async () => {
    const { agents, claude, store, project } = office({ ...demoWorkspace, mergeBase: async () => ({ kind: 'merged', sha: 'merge-sha', from: 'old-sha' }) });
    const { agent: lead } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    const [pr] = store.agent(lead.id).lead!.prs;

    const outcome = await agents.resolveConflicts(project.id, { repo: pr.repo, number: pr.number, branch: store.agent(lead.id).branch, baseBranch: 'main' } as PullRequest);
    expect(outcome).toEqual({ kind: 'merged' });
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
    expect(heard).toMatch(new RegExp(`^\\[Office\\] ${pr.repo}#${pr.number} had merge conflicts with \`main\`: the office merged`));
    expect(heard).toContain('How did it go?');
  });

  it('seats an agent of its own on a slice’s PR when git can’t merge it, rather than interrupting the lead', async () => {
    const created: { agentId: string; branch: string; local?: string }[] = [];
    const { agents, claude, store, project } = office({
      ...demoWorkspace,
      create: async (_repo, agentId, branch, _start, _inOffice, local) => (created.push({ agentId, branch, local }), `/demo/${agentId}`),
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

  it('won’t ship a lead’s repo over commits the office pushed to its branch', async () => {
    let behind = false;
    const { agents, claude, store, project } = office({ ...demoWorkspace, head: async () => 'lead-head', missingRemoteCommits: async () => behind });
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
    const { agents, claude, store, project } = office({
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
    const { agents, claude, project } = office({
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

  it('carries the goal into the next slice, as the captain put it, once the last one has landed', async () => {
    const { agents, claude, store, project } = office();
    const { agent: lead } = agents.startGoal(project.id, 'Saved items\nShoppers keep a list across devices') as { agent: { id: string } };
    const leads = () => claude.turns.filter((t) => t.req.agentId === lead.id);
    await until(() => leads().length === 1);
    await leads()[0].req.tools!.ship({ title: 'Saved items, first slice', summary: 'A thin first slice.' });
    leads()[0].end({ ok: true, summary: 'Shipped the first slice' });
    await until(() => store.agent(lead.id).status === 'done');

    for (const pr of store.agent(lead.id).lead!.prs) agents.prClosed(pr.repo, pr.number, true);
    // the conversation carries on as it is: compacting is the captain's call
    await until(() => leads().length === 2);
    const next = leads()[1].req;
    expect(next.resumeSessionId).toBe('session-1');
    expect(next.prompt).toMatch(/^Slice 2 starts on fresh code/);
    expect(next.prompt).not.toContain('summarised');
    expect(next.prompt).toContain('The goal: Saved items\n\nAs the captain first put it:\n> Saved items\n> Shoppers keep a list across devices');
    expect(next.prompt).toMatch(/\[Office\] Slice 1 has landed/);
  });

  it('brings commits the lead hadn’t shipped along to the next slice', async () => {
    const picked: { dir: string; commits: string[] }[] = [];
    const { agents, claude, store, project } = office({
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
    await until(() => leads().length === 2);
    expect(picked.map((p) => p.commits)).toEqual([['web-next'], ['api-next']]);
    const next = leads()[1].req.prompt;
    expect(next).toContain("- ./webshop-frontend: the commit you hadn't shipped came along onto the new branch.");
    expect(next).toContain(`- ./webshop-api: the commit you hadn't shipped didn't apply cleanly to fresh code, so it's only on \`${firstBranch}\`. Bring it over with \`git cherry-pick api-next\``);
  });

  it('tells a lead whose conversation can’t be picked back up where the goal stands', async () => {
    const { agents, claude, store, project } = office();
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
    const { agents, claude, store, project } = office();
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
    const { agents, project } = office();
    agents.startGoal(project.id, 'One', { station: 1 });
    expect(() => agents.startGoal(project.id, 'Two', { station: 1 })).toThrow('Team station 2 already has a goal: One');
    expect(() => agents.startGoal(project.id, ' ')).toThrow('Tell them what you’re after');
    for (const goal of ['Two', 'Three', 'Four']) agents.startGoal(project.id, goal);
    expect(agents.startGoal(project.id, 'Five')).toMatchObject({ queued: { text: 'Five' } });
  });

  it('carries QA’s pass over a clean merge of main without seating QA, never re-tests a commit with a verdict, and re-tests a real change', async () => {
    const { agents, claude, store, project } = office();
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
    const passedAt = (sha: string) => store.putReview({ projectId: project.id, repo, number, title: 'PR', status: 'passed', sha, report, requestedAt: 1, finishedAt: 2 });
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
});
