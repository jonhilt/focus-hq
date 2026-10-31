import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { PullRequest } from '../../shared/types';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { demoWorkspace } from './demoRunner';
import { focus, restarted, until } from './fakeFocus';
import { checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';
import type { Restack, WorkspaceOps } from './types';

// A goal's stacked waypoints moved along (`Stacks`, server/agents/manager/stacks.ts), under Focus's two rules
// (docs/invariants.md). Waypoint 2's pull request (#11, on `wp2`) is stacked on waypoint 1's (#10, on `wp1`); the
// branch below gets pushes, some that clash, and lands, while the board refreshes. Moving a branch is git's and pointing
// a pull request is GitHub's, so both go through `later`; what's kept is where Ops knows #11 to sit (`stackedOn`), the
// lead's notes and the ledger's `restacked` lines. What's out in the world (`wp2` and #11's base) is the promises' to
// check: a move a restart cut off lands there unheard, and is Focus's to find as the board next refreshes. Its promises
// are docs/merging.md's, "A stacked waypoint waits for the one it's on".
//
// Broken on purpose and seen caught: forgetting where a move set out from (`moving`), so a move that went through as
// Focus went down is never told to the lead, failed the restart check (and its promise); dropping the guard on a move
// under way, so two refreshes at once both move it and both tell the lead, failed the check for two at once (on seed
// 2, and in a soak on seed 1: it's a rare draw); and leaving `stuck` unset on a clash, so the lead is told every
// refresh, failed "a move that clashes pushes nothing, and the lead hears it once" and the reach test.
//
// What its stand-ins assume, beyond the workspace contract (which holds Ops' restack to real git): that a branch's
// head is a name for the heads it was built on, so moving it onto the same head twice gives the same commit; that git
// refuses to replay from below where the branch was cut (`upstream`), where real git would replay commits that aren't
// its own; and that GitHub leaves a pull request based on a branch that has landed (it may point it at the base itself).

// a soak (FOCUS_INVARIANT_RUNS) takes as many times longer
vi.setConfig({ testTimeout: 60_000 * Math.max(1, Number(process.env.FOCUS_INVARIANT_RUNS ?? 1) || 1) });

const REPO = 'demo/webshop-frontend';

/** The world outside Focus, kept across its lives: the branches as GitHub has them, and #11's base. */
class World {
  heads = new Map([['main', 'm0'], ['wp1', 'a1'], ['wp2', 'b1']]);
  /** The head of the branch below that each stacked branch was built on. */
  sat = new Map([['wp2', 'a1']]);
  /** wp1's heads, oldest first: replaying wp2 from any at or after where it was cut replays only its own commits. */
  wp1 = ['a1'];
  base = 'wp1';
  landed = false;
  pushes = 0;

  head(branch: string): string {
    return this.heads.get(branch) ?? '';
  }

  /** git's `rebase --onto origin/<onto> <upstream>`, as Ops' restack runs it: a head starting `x` clashes with wp2's. */
  restack(branch: string, onto: string, upstream: string): Restack {
    const below = this.head(onto);
    if (this.sat.get(branch) === below) return { kind: 'up-to-date' };
    if (this.wp1.indexOf(upstream) < this.wp1.indexOf(this.sat.get(branch) ?? '')) throw new Error(`replaying ${branch} from ${upstream}, below where it was cut (${this.sat.get(branch)}): commits that aren't its own`);
    if (below.startsWith('x')) return { kind: 'conflicts', files: ['src/header.ts'] };
    const from = this.head(branch);
    const sha = `${branch}@${below}`;
    this.heads.set(branch, sha);
    this.sat.set(branch, below);
    return { kind: 'restacked', sha, from };
  }

  push(clashing: boolean): void {
    this.pushes++;
    this.heads.set('wp1', `${clashing ? 'x' : 'a'}${this.pushes + 1}`);
    this.wp1.push(this.head('wp1'));
  }

  /** Waypoint 1's pull request squash-merged: main takes its change (clashing with wp2's, when it did). */
  land(): void {
    this.landed = true;
    this.heads.set('main', `${this.head('wp1').startsWith('x') ? 'x' : ''}m1`);
  }

  board(): PullRequest[] {
    const pr = (number: number, branch: string, baseBranch: string): PullRequest => ({
      repo: REPO, number, title: `PR ${number}`, url: `https://github.com/${REPO}/pull/${number}`, branch, baseBranch, headSha: this.head(branch),
      isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '2026-10-30T00:00:00Z',
    });
    return [...(this.landed ? [] : [pr(10, 'wp1', 'main')]), pr(11, 'wp2', this.base)];
  }
}

/** Where Ops knows #11 to sit, what the lead was told, and the ledger's lines. */
interface Stacked {
  stackedOn?: { branch: string; sha: string; stuck?: { lower: string; head: string } };
  notes: string[];
  lines: string[];
}

/** Focus with a goal whose lead has waypoint 2 stacked on waypoint 1, its git and GitHub answering through `later`. */
async function stackedGoal(later: Later) {
  const world = new World();
  let reading: Later = later;
  const workspace: WorkspaceOps = {
    ...demoWorkspace,
    // the lead opened nothing Ops would claim: their pull requests are set below
    branchesSeen: () => Promise.resolve([]),
    restack: (_repo, branch, onto, upstream) => reading('restack', () => Promise.resolve().then(() => world.restack(branch, onto, upstream))),
  };
  const demo = Effect.runSync(Effect.provide(GitHub, demoLayer));
  const github = Layer.succeed(GitHub, GitHub.of({ ...demo, editPullRequestBase: (_repo, _number, base) => Effect.promise(() => reading('retarget', async () => void (world.base = base))) }));
  const first = focus(workspace, github);
  const { store, project } = first;
  // QA isn't this part's
  project.autoQa = false;
  const { agent } = first.agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
  await until(() => first.claude.turns.length === 1);
  const lead = store.agent(agent.id);
  const url = (n: number) => `https://github.com/${REPO}/pull/${n}`;
  lead.lead = {
    ...lead.lead!,
    slice: 2,
    prs: [{ repo: REPO, number: 10, url: url(10), branch: 'wp1', slice: 1 }, { repo: REPO, number: 11, url: url(11), branch: 'wp2', slice: 2 }],
    waypoints: [{ slice: 1, startedAt: 0 }, { slice: 2, startedAt: 1, on: 1 }],
  };
  store.putAgent(lead);
  const durable = (): Stacked => {
    const on = store.agent(agent.id).lead!.prs.find((p) => p.number === 11)?.stackedOn;
    return {
      // where it's moving from is Ops' own mark, until it hears how the move went
      ...(on && { stackedOn: { branch: on.branch, sha: on.sha, ...(on.stuck && { stuck: on.stuck }) } }),
      notes: store.journalEntries(agent.id).flatMap((e) => (e.kind === 'queued' && e.at === 'note' && e.text.startsWith('[Ops]') ? [e.text] : [])),
      lines: store.ledger.flatMap((e) => (e.kind === 'restacked' ? [`${e.pr} onto ${e.onto}${e.files ? ` clashed in ${e.files.join(', ')}` : ''}`] : [])),
    };
  };
  const life = (agents: typeof first.agents): Running<Stacked> => {
    let going: Promise<unknown> = Promise.resolve();
    const refresh = () => (going = Promise.all([going, agents.boardRefreshed(project.id, world.board())]));
    return {
      actions: () => [
        { name: 'the board refreshes', run: refresh },
        ...(world.landed ? [] : [
          { name: 'a push to the waypoint below', run: () => world.push(false) },
          { name: 'a clashing push to the waypoint below', run: () => world.push(true) },
          { name: 'the waypoint below lands', run: () => (world.land(), agents.prClosed(REPO, 10, true)) },
        ]),
      ],
      durable,
      settle: async () => void (await going),
      close: () => agents.shutDown(),
      restart: (next) => {
        agents.shutDown();
        reading = next;
        return life(restarted(store, workspace, github).agents);
      },
    };
  };
  return { world, store, project, agents: first.agents, leadId: agent.id, running: life(first.agents) };
}

const stacked: Subject<Stacked> = { name: 'stacked waypoints', start: async (later) => (await stackedGoal(later)).running };

/** Takes the actions named, in turn, each settled before the next. */
async function taking(r: Running<Stacked>, ...names: string[]): Promise<void> {
  await r.settle();
  for (const name of names) {
    const action = r.actions().find((a) => a.name === name);
    if (!action) throw new Error(`no "${name}" now`);
    await Promise.resolve(action.run());
    await r.settle();
  }
}

const moved = (from: string, onto: string, folder = 'webshop-frontend') =>
  `[Ops] Ops moved ${REPO}#11 onto \`${onto}\`, which it's based on now, so ./${folder} is behind GitHub. To bring your checkout along, run \`git -C ./${folder} fetch origin && git -C ./${folder} rebase --onto origin/wp2 ${from} wp2\`: it keeps commits you haven't pushed. Don't pull it with a merge.`;

describe('a goal’s stacked waypoints moved along, under Focus’s two rules', () => {
  /** What Ops kept, and wp2 and #11's base out in the world. */
  const seen = (o: { running: Running<Stacked>; world: World }) => ({ ...o.running.durable(), wp2: o.world.head('wp2'), base: o.world.base });

  // docs/merging.md: "A stacked pull request is moved onto the branch below it when that one gets a push or lands, and pointed at it."
  it('moves a stacked pull request onto the branch below when that one gets a push, then onto the base branch once it lands, pointed there, and holds it until then', async () => {
    const o = await stackedGoal(now);
    await taking(o.running, 'the board refreshes', 'a push to the waypoint below', 'the board refreshes');
    expect(seen(o)).toMatchObject({ stackedOn: { branch: 'wp1', sha: 'a2' }, wp2: 'wp2@a2', base: 'wp1' });
    await taking(o.running, 'the waypoint below lands');
    expect(o.agents.landingHold(REPO, 11)).toBe('Ops is moving it onto `main` first');
    await taking(o.running, 'the board refreshes');
    expect(seen(o)).toEqual({
      stackedOn: { branch: 'main', sha: '' },
      notes: [moved('b1', 'wp1'), expect.stringMatching(/^\[Ops\] Slice 1 has landed/), moved('wp2@a2', 'main')],
      lines: ['11 onto wp1', '11 onto main'],
      wp2: 'wp2@m1',
      base: 'main',
    });
    expect(o.agents.landingHold(REPO, 11)).toBeUndefined();
    o.running.close?.();
  });

  // docs/merging.md: "Moving it twice is the same as once, through a restart." and "The lead hears each move once"
  it('moves it once, and tells the lead once, however often the board refreshes, through a restart', async () => {
    const o = await stackedGoal(now);
    await taking(o.running, 'the board refreshes', 'a push to the waypoint below', 'the board refreshes', 'the board refreshes');
    const after = await o.running.restart(now);
    await taking(after, 'the board refreshes');
    expect(seen({ running: after, world: o.world })).toEqual({ stackedOn: { branch: 'wp1', sha: 'a2' }, notes: [moved('b1', 'wp1')], lines: ['11 onto wp1'], wp2: 'wp2@a2', base: 'wp1' });
    after.close?.();
  });

  // docs/merging.md: "Moving it twice is the same as once, through a restart." (a move a restart cut off is finished, not done again)
  it('tells the lead of a move that went through as Focus went down once the board refreshes again, and moves it no further', async () => {
    // git moves the branch, and Focus goes down before it hears so
    const unheard: Later = (label, work) => (label === 'restack' ? work().then(() => new Promise<never>(() => undefined)) : work());
    const o = await stackedGoal(unheard);
    await taking(o.running, 'the board refreshes', 'a push to the waypoint below');
    void o.agents.boardRefreshed(o.project.id, o.world.board());
    await until(() => o.world.head('wp2') === 'wp2@a2');
    const after = await o.running.restart(now);
    expect(after.durable()).toEqual({ stackedOn: { branch: 'wp1', sha: 'a1' }, notes: [], lines: [] });
    await taking(after, 'the board refreshes');
    expect(seen({ running: after, world: o.world })).toEqual({ stackedOn: { branch: 'wp1', sha: 'a2' }, notes: [moved('b1', 'wp1')], lines: ['11 onto wp1'], wp2: 'wp2@a2', base: 'wp1' });
    after.close?.();
  });

  // docs/merging.md: "A move that clashes pushes nothing, and the lead hears it once"
  it('pushes nothing when a move clashes, tells the lead once with the files and how, and tries again once the branch below moves on', async () => {
    const o = await stackedGoal(now);
    await taking(o.running, 'the board refreshes', 'a clashing push to the waypoint below', 'the board refreshes', 'the board refreshes');
    const stuck = seen(o);
    expect(stuck).toMatchObject({ stackedOn: { branch: 'wp1', sha: 'a1', stuck: { lower: 'x2', head: 'b1' } }, lines: ['11 onto wp1 clashed in src/header.ts'], wp2: 'b1' });
    expect(stuck.notes).toEqual([expect.stringMatching(/^\[Ops\] Ops couldn't move demo\/webshop-frontend#11 onto `wp1`.*src\/header\.ts, so nothing was pushed\..*git rebase --onto origin\/wp1 a1/)]);
    expect(o.agents.landingHold(REPO, 11)).toMatch(/waits on waypoint 1/);
    await taking(o.running, 'a push to the waypoint below', 'the board refreshes');
    expect(seen(o)).toMatchObject({ stackedOn: { branch: 'wp1', sha: 'a3' }, wp2: 'wp2@a3' });
    o.running.close?.();
  });

  it('reaches a pull request moved on a push, stuck on a clash, and moved onto the base branch as the one below lands, taken one at a time', async () => {
    const reached = new Set<string>();
    for (const names of [
      ['the board refreshes', 'a push to the waypoint below', 'the board refreshes', 'the waypoint below lands', 'the board refreshes'],
      ['the board refreshes', 'a clashing push to the waypoint below', 'the board refreshes', 'the waypoint below lands', 'the board refreshes'],
    ]) {
      const o = await stackedGoal(now);
      for (const name of names) {
        await taking(o.running, name);
        const d = seen(o);
        if (d.wp2 !== 'b1' && d.stackedOn?.branch === 'wp1') reached.add('moved on a push');
        if (d.stackedOn?.stuck) reached.add('stuck on a clash');
        if (d.stackedOn?.branch === 'main' && d.base === 'main' && d.wp2.endsWith('@m1')) reached.add('moved onto the base branch');
        // its clash came down to the base branch with it
        if (d.stackedOn?.stuck?.lower === '') reached.add('stuck as the one below lands');
      }
      o.running.close?.();
    }
    expect([...reached].sort()).toEqual(['moved on a push', 'moved onto the base branch', 'stuck as the one below lands', 'stuck on a clash']);
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(stacked, { runs: 25, prefix: 3 });
  });

  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(stacked, { runs: 25, prefix: 3 });
  });
});
