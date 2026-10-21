import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { prKey } from '../../shared/qa';
import { GhServerError } from '../github/runner';
import { demoLayer } from '../github/demo';
import { GitHub, GitHubRejected } from '../github/service';
import { demoWorkspace } from './demoRunner';
import { type FakeClaude, focus, restarted } from './fakeFocus';
import { type Action, checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';
import { COMMIT_NUDGE } from './prompts';
import { RESUMED_NOTE } from './runJournal';
import type { WorkspaceOps } from './types';

// A developer's work going onto GitHub (`Delivery`, server/agents/manager/delivery.ts), under Focus's two rules
// (docs/invariants.md): a restart is atomic, and two things at once end as one after the other would. After a
// developer's turn Ops asks them once to commit what they left, then pushes their branch and opens (or updates)
// their pull request, journaling each step so a restart part way finishes it without another turn (docs/AGENTS.md,
// "Deliver", "The run journal" and "After a restart"). Described here (what can happen to a delivery, what must
// survive), not told what to expect.

// a soak (FOCUS_INVARIANT_RUNS) takes as many times longer
vi.setConfig({ testTimeout: 120_000 * Math.max(1, Number(process.env.FOCUS_INVARIANT_RUNS ?? 1) || 1) });

const REPO = 'demo/webshop-frontend';
const ISSUE = { number: 1, title: 'Add a dark mode toggle to the header' };

/** Until what `read` says stops changing (three looks 5 ms apart, two seconds at most). */
const steady = async (read: () => unknown) => {
  let last = JSON.stringify(read());
  for (let same = 0, i = 0; same < 3 && i < 400; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const now = JSON.stringify(read());
    same = now === last ? same + 1 : 0;
    last = now;
  }
};

/**
 * The world outside Focus, kept across its lives: the developer's checkout (what they left uncommitted, and the
 * commits on their branch), the branch as GitHub has it (what was pushed), GitHub's pull requests, and how many more
 * times GitHub answers a push, or opening a pull request, with a 5xx.
 */
interface World {
  uncommitted: string[];
  commits: string[];
  pushed: string[];
  prs: { number: number; branch: string; state: 'OPEN' | 'MERGED' | 'CLOSED' }[];
  failPushes: number;
  failOpens: number;
  /** The developer's edits, numbered as they're made. */
  edits: number;
  /** What happens as Ops asks for the next push, before it goes: the captain writing, say. */
  atPush?: () => void;
}

/** The developer's checkout on `world`, a commit's id its place on the branch; looking for changes and pushing go through `later`. */
const workspace = (later: Later, world: World): WorkspaceOps => ({
  ...demoWorkspace,
  hasUncommittedChanges: () => later('look for changes', () => Promise.resolve(world.uncommitted.length > 0)),
  commitsAhead: () => Promise.resolve(world.commits.length),
  // HEAD stays put until a commit, which moves it (the workspace contract)
  head: () => Promise.resolve(`c${world.commits.length}`),
  // someone else's commits on GitHub's branch: what was pushed that the checkout hasn't got
  missingRemoteCommits: () => Promise.resolve(world.pushed.some((c, i) => world.commits[i] !== c)),
  push: () => {
    const write = world.atPush;
    world.atPush = undefined;
    write?.();
    return later('push', () => {
      if (world.failPushes > 0) {
        world.failPushes--;
        return Promise.reject(new Error("git push --force-with-lease failed: remote: Internal Server Error\nfatal: unable to access 'https://github.com/demo/webshop-frontend.git/': The requested URL returned error: 502"));
      }
      world.pushed = [...world.commits];
      return Promise.resolve();
    });
  },
  // QA's checkout of the pull request (QA's reviews are held on their own, reviewInvariants.test.ts)
  checkoutPullRequest: () => Promise.resolve(''),
});

/** The demo's GitHub, its pull requests the world's, looking one up and opening one asked for through `later`. */
const github = (later: Later, world: World) => {
  const gh = Effect.runSync(Effect.provide(GitHub, demoLayer));
  const url = (number: number) => `https://github.com/${REPO}/pull/${number}`;
  return Layer.succeed(GitHub, GitHub.of({
    ...gh,
    // only an open pull request is found from a branch (the demo GitHub's contract)
    findPullRequest: (_repo, branch) =>
      Effect.promise(() => later('find the pull request', () => {
        const open = world.prs.find((p) => p.branch === branch && p.state === 'OPEN');
        return Promise.resolve(open ? { number: open.number, url: url(open.number) } : null);
      })),
    createPullRequest: (_repo, req) =>
      Effect.promise(() => later<GhServerError | GitHubRejected | { number: number; url: string }>('open the pull request', () => {
        if (world.failOpens > 0) {
          world.failOpens--;
          return Promise.resolve(new GhServerError({ args: ['pr', 'create'], stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' }));
        }
        // GitHub refuses a second open pull request from the same branch (the demo GitHub's contract)
        const open = world.prs.find((p) => p.branch === req.head && p.state === 'OPEN');
        if (open) return Promise.resolve(new GitHubRejected({ message: `A pull request already exists for ${REPO}:${req.head}: ${url(open.number)}` }));
        const number = 100 + world.prs.length;
        world.prs.push({ number, branch: req.head, state: 'OPEN' });
        return Promise.resolve({ number, url: url(number) });
      })).pipe(Effect.flatMap((r) => (r instanceof GhServerError || r instanceof GitHubRejected ? Effect.fail(r) : Effect.succeed(r)))),
    pullRequestState: (_repo, number) => Effect.succeed(world.prs.find((p) => p.number === number)?.state ?? 'CLOSED'),
  }));
};

interface Kept {
  /** The run journal's phase (the delivery's, once one's under way), and how its last delivery ended. */
  phase: string;
  delivered?: string;
  /** Where the developer is: their status, and the pull request Ops has for them. */
  status?: string;
  pr?: number;
  /** The checkout, and the branch as GitHub has it. */
  uncommitted: string[];
  commits: string[];
  pushed: string[];
  /** The pull requests on GitHub, and the commit QA was asked to test on each. */
  github: string[];
  qa: string[];
  /** What the developer was told: how many times they were asked to commit, and the captain's messages they heard. */
  nudges: number;
  heard: string[];
}

const phaseOf = (phase: unknown): string =>
  typeof phase === 'string' ? phase : typeof phase === 'object' && phase ? Object.entries(phase).map(([k, v]) => `${k}.${phaseOf(v)}`).join(',') : '';

/** How many turns the developer has had, across Focus's lives: what a description lets its plain tests count. */
interface Spy {
  turns: () => number;
}

/**
 * A developer at work on an issue, from their first turn. `only`: the actions offered, by name, when a check is after
 * one thing; `writes`: the captain can write as the work goes up (the two rules start two actions together, so a message
 * can't otherwise land part way through a delivery). It's left out of the checks for a restart: a restart before the push
 * would leave that action half done by the description's own making, the turn ended and nothing written.
 */
const delivery = ({ only, writes = false, spy = { turns: () => 0 } }: { only?: RegExp; writes?: boolean; spy?: Spy } = {}): Subject<Kept> => ({
  name: 'delivery',
  start: async (start) => {
    const world: World = { uncommitted: [], commits: [], pushed: [], prs: [], failPushes: 0, failOpens: 0, edits: 0 };
    // the developer's setting up (their checkout, their first turn) isn't what's under test: it's done before the first action
    let setUp = false;
    const later: Later = (label, work) => (setUp ? start(label, work) : work());
    const first = focus(workspace(later, world), github(later, world));
    const { store, project } = first;
    const id = first.agents.hire(project.id, REPO, ISSUE).id;
    // every life's Claude Code, for what the developer was told across them
    const lives: FakeClaude[] = [];
    let messages = 0;
    const turns = () => lives.flatMap((c) => c.turns).filter((t) => t.req.agentId === id);
    spy.turns = () => turns().length;
    const kept = (): Kept => {
      const agent = store.agents.get(id);
      const last = store.journalEntries(id).filter((e) => e.kind === 'delivered').at(-1);
      return {
        phase: phaseOf(store.run(id).phase),
        delivered: last?.kind === 'delivered' ? `${last.outcome}${last.pr ? ` #${last.pr}` : ''}` : undefined,
        status: agent?.status,
        pr: agent?.pr?.number,
        uncommitted: [...world.uncommitted],
        commits: [...world.commits],
        pushed: [...world.pushed],
        github: world.prs.map((p) => `#${p.number} ${p.state}`),
        qa: world.prs.map((p) => `#${p.number} at ${store.reviews.get(prKey(REPO, p.number))?.shippedHead ?? 'none'}`),
        // a turn carried on after a restart is the same turn, not something more they were told
        nudges: turns().filter((t) => !t.req.prompt.includes(RESUMED_NOTE) && t.req.prompt === COMMIT_NUDGE).length,
        heard: [...new Set(turns().flatMap((t) => [t.req.prompt, ...t.sent]).flatMap((s) => s.match(/follow-up \d+/g) ?? []))].sort(),
      };
    };
    const life = (o: Pick<ReturnType<typeof focus>, 'agents' | 'claude'>, later: Later): Running<Kept> => {
      lives.push(o.claude);
      // this life of Focus is over: what an action of it was still waiting to do, it never does
      let gone = false;
      const ended = new Set<number>();
      // the developer's turn under way: with none, there's nobody at the keyboard
      const turn = () => {
        const at = o.claude.turns.findIndex((t, i) => t.req.agentId === id && !t.stopped && !ended.has(i));
        const t = o.claude.turns[at];
        if (!t) throw new Error('the developer has no turn under way');
        return { t, at };
      };
      const landed = (state: 'MERGED' | 'CLOSED'): Action => ({
        name: `the pull request is ${state === 'MERGED' ? 'merged' : 'closed'} on GitHub`,
        // it lands on GitHub in its own time, and Ops hears of it (its board's refresh) once it has
        run: async () => {
          const open = world.prs.find((p) => p.state === 'OPEN');
          if (!open) throw new Error('no pull request open');
          // one that isn't open by then (merged or closed meanwhile) is refused, as GitHub refuses it
          await later(state === 'MERGED' ? 'merge' : 'close', () => (open.state === 'OPEN' ? Promise.resolve(void (open.state = state)) : Promise.reject(new Error(`#${open.number} isn't open`))));
          if (!gone) o.agents.prClosed(REPO, open.number, state === 'MERGED');
        },
      });
      const all = (): Action[] => [
        { name: 'the developer commits', run: () => (turn(), world.commits.push(`w${world.commits.length + 1}`)) },
        { name: 'the developer leaves work uncommitted', run: () => (turn(), world.uncommitted.push(`edit ${++world.edits}`)) },
        {
          name: 'the developer commits what they left',
          run: () => {
            turn();
            if (!world.uncommitted.length) throw new Error('nothing uncommitted');
            world.uncommitted = [];
            world.commits.push(`w${world.commits.length + 1}`);
          },
        },
        {
          name: 'the turn ends',
          run: () => {
            const { t, at } = turn();
            ended.add(at);
            t.end({ ok: true, summary: 'Dark mode toggle in the header' });
          },
        },
        { name: 'the captain sends a follow-up', run: () => o.agents.message(id, `Please also do follow-up ${++messages}`) },
        ...(writes
          ? [{
            name: 'the turn ends, and the captain writes as the work goes up',
            run: () => {
              const { t, at } = turn();
              // what they write reaches Ops in its own time, from the moment the push is asked for
              world.atPush = () => void later('the captain writes', () => Promise.resolve()).then(() => gone || o.agents.message(id, `Please also do follow-up ${++messages}`));
              ended.add(at);
              t.end({ ok: true, summary: 'Dark mode toggle in the header' });
            },
          }]
          : []),
        { name: 'GitHub answers the next push with a 502', run: () => void world.failPushes++ },
        { name: 'GitHub answers opening the next pull request with a 502', run: () => void world.failOpens++ },
        { name: 'GitHub answers every push with a 502', run: () => void (world.failPushes = 4) },
        { name: 'GitHub answers every try at opening a pull request with a 502', run: () => void (world.failOpens = 4) },
        {
          name: 'someone opens a pull request from the branch on GitHub',
          run: () => {
            const branch = store.agents.get(id)?.branch;
            if (!branch || !world.pushed.length || world.prs.some((p) => p.state === 'OPEN')) throw new Error('nothing to open one from');
            world.prs.push({ number: 100 + world.prs.length, branch, state: 'OPEN' });
          },
        },
        landed('MERGED'),
        landed('CLOSED'),
      ];
      return {
        actions: () => all().filter((a) => !only || only.test(a.name)),
        durable: kept,
        settle: () => steady(() => [kept(), o.claude.turns.length, store.agents.get(id)?.activity]),
        close: () => o.agents.shutDown(),
        restart: (later) => {
          gone = true;
          o.agents.shutDown();
          const after = restarted(store, workspace(later, world), github(later, world));
          after.agents.recover();
          return life(after, later);
        },
      };
    };
    const running = life(first, later);
    await running.settle();
    setUp = true;
    return running;
  },
});

/** Takes the named actions one at a time on a fresh delivery, and what it kept after each. */
async function take(names: string[]) {
  const d = await delivery({ writes: true }).start(now);
  const after: Kept[] = [];
  for (const name of names) {
    const action = d.actions().find((a) => a.name === name);
    expect(action, name).toBeDefined();
    await Promise.resolve(action?.run());
    await d.settle();
    after.push(d.durable());
  }
  d.close?.();
  return after;
}

/**
 * Takes the named actions on a fresh delivery, Focus going down at the first `label` it hands the world outside
 * (which lands out there, or is lost on the way), then starting again: what it kept just before, once it settled after,
 * and how many more turns the developer had.
 */
async function cutOff(label: string, as: 'landed' | 'lost', names: string[]) {
  let cut = false;
  const out: Later = (l, work) => {
    if (cut || l !== label) return work();
    cut = true;
    return as === 'landed' ? work().then(() => new Promise<never>(() => undefined)) : new Promise<never>(() => undefined);
  };
  const spy: Spy = { turns: () => 0 };
  const first = await delivery({ spy }).start(out);
  for (const name of names) {
    await Promise.resolve(first.actions().find((a) => a.name === name)?.run());
    await first.settle();
  }
  expect(cut, label).toBe(true);
  const before = first.durable();
  const turns = spy.turns();
  const d = await first.restart(now);
  await d.settle();
  const after = d.durable();
  d.close?.();
  return { before, after, turns: spy.turns() - turns };
}

describe('a developer’s work going onto GitHub, under Focus’s two rules', () => {
  // a description that never got the work onto GitHub would pass both rules and prove nothing
  it('reaches a delivery asked to commit, pushed through a 502, a pull request opened and updated, failed and merged, taken one at a time', async () => {
    const after = await take([
      'the developer commits',
      'the developer leaves work uncommitted',
      'the turn ends',
      'the developer commits what they left',
      'GitHub answers the next push with a 502',
      'GitHub answers opening the next pull request with a 502',
      'the turn ends',
      'the captain sends a follow-up',
      'the developer commits',
      'GitHub answers every push with a 502',
      'the turn ends',
      'the captain sends a follow-up',
      'the turn ends',
      'the pull request is merged on GitHub',
    ]);
    // asked to commit, then delivered: pushed and the pull request opened
    expect(after[2]).toMatchObject({ phase: 'turn.started', nudges: 1 });
    expect(after[6]).toMatchObject({ phase: 'delivered', delivered: 'pr #100', status: 'done', pr: 100, pushed: ['w1', 'w2'], github: ['#100 OPEN'] });
    // the follow-up's commit failed to go up: GitHub kept answering 502
    expect(after[10]).toMatchObject({ phase: 'failed', status: 'error', pushed: ['w1', 'w2'], commits: ['w1', 'w2', 'w3'] });
    // the next one updated the pull request
    expect(after[12]).toMatchObject({ phase: 'delivered', delivered: 'pr #100', pushed: ['w1', 'w2', 'w3'], github: ['#100 OPEN'], heard: ['follow-up 1', 'follow-up 2'] });
    expect(after[13]?.github).toEqual(['#100 MERGED']);
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(delivery(), { runs: 25 });
  });

  // the delivery is the step this part is about: a restart part way through one, which a check over everything
  // reaches only now and then
  it('end a restart during a delivery as if it had never started, or had finished', async () => {
    await checkRestart(delivery({ only: /^the developer (commits|leaves work uncommitted)$|^the turn ends$|next push/ }), { runs: 50, prefix: 2 });
  });

  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(delivery({ writes: true }), { runs: 25 });
  });

  // the captain writing as the work goes up: their message reaches Ops at any point of the delivery
  it('end a message and the delivery it lands in as one after the other would', async () => {
    await checkAtOnce(delivery({ only: /developer commits$|writes|502/, writes: true }), { runs: 25, prefix: 2 });
  });

  // the captain's message, or GitHub's merge, while the work goes up
  it('end a delivery and a follow-up or a merge at once as one after the other would', async () => {
    await checkAtOnce(delivery({ only: /developer commits$|turn ends|writes|follow-up|merged|closed|502/, writes: true }), { runs: 25, prefix: 3 });
  });
});

describe('a developer’s work going onto GitHub, as docs/AGENTS.md says', () => {
  // "Deliver": "if they left uncommitted changes, they're asked once to commit them. Then Ops pushes the branch
  // and opens the PR"
  it('asks them once to commit what they left, then pushes what they committed and opens the pull request', async () => {
    const after = await take(['the developer commits', 'the developer leaves work uncommitted', 'the turn ends', 'the turn ends']);
    expect(after[2]).toMatchObject({ nudges: 1, status: 'working', pushed: [] });
    // they didn't commit it: what they had committed goes up, and they aren't asked again
    expect(after[3]).toMatchObject({ nudges: 1, status: 'done', uncommitted: ['edit 1'], pushed: ['w1'], github: ['#100 OPEN'], pr: 100 });
  });

  // "Deliver": "they're asked once", a restart while they're being asked included. Found on main by the restart check
  // (docs/invariants.md, "Found on main"): the turn asking them picked back up, and as it ended they were asked again
  it('asks them once to commit, though Focus restarted while it asked', async () => {
    const d = await delivery().start(now);
    for (const name of ['the developer commits', 'the developer leaves work uncommitted', 'the turn ends']) {
      await Promise.resolve(d.actions().find((a) => a.name === name)?.run());
      await d.settle();
    }
    expect(d.durable()).toMatchObject({ phase: 'turn.started', nudges: 1 });
    const after = await d.restart(now);
    await after.settle();
    await Promise.resolve(after.actions().find((a) => a.name === 'the turn ends')?.run());
    await after.settle();
    const kept = after.durable();
    after.close?.();
    expect(kept).toMatchObject({ phase: 'delivered', delivered: 'pr #100', pushed: ['w1'], uncommitted: ['edit 1'], nudges: 1 });
  });

  // "The run journal": the delivery's steps are journaled "once past asking them to commit what they left"
  it('journals a delivery only once past asking them to commit', async () => {
    const after = await take(['the developer commits', 'the developer leaves work uncommitted', 'the turn ends']);
    expect(after[2]).toMatchObject({ phase: 'turn.started', nudges: 1, delivered: undefined });
  });

  // "After a restart": "a developer's work the journal says was going onto GitHub (delivering) is finished by Ops:
  // pushed again and its pull request found or opened, with no Claude turn and no nudge to commit"
  it('a restart part way finishes the pull request without another turn', async () => {
    // the push never comes back: Focus goes down while it's under way
    const { before, after, turns } = await cutOff('push', 'lost', ['the developer commits', 'the developer leaves work uncommitted', 'the turn ends', 'the developer commits what they left', 'the developer leaves work uncommitted', 'the turn ends']);
    expect(before).toMatchObject({ phase: 'delivering.pushing', pushed: [], nudges: 1 });
    expect(after).toMatchObject({ phase: 'delivered', delivered: 'pr #100', status: 'done', pr: 100, pushed: ['w1', 'w2'], uncommitted: ['edit 2'], github: ['#100 OPEN'], nudges: 1 });
    expect(turns).toBe(0);
  });

  // "After a restart": "pushed again and its pull request found or opened … (both steps are safe to repeat)": a push
  // that landed, and a pull request GitHub opened, as Focus went down, aren't done twice
  it('pushed again and its pull request found or opened, both steps safe to repeat', async () => {
    const pushed = await cutOff('push', 'landed', ['the developer commits', 'the turn ends']);
    expect(pushed.before).toMatchObject({ phase: 'delivering.pushing', pushed: ['w1'], github: [] });
    expect(pushed.after).toMatchObject({ phase: 'delivered', delivered: 'pr #100', pr: 100, pushed: ['w1'], github: ['#100 OPEN'] });
    const opened = await cutOff('open the pull request', 'landed', ['the developer commits', 'the turn ends']);
    expect(opened.before).toMatchObject({ phase: 'delivering.opening', pr: undefined, github: ['#100 OPEN'] });
    expect(opened.after).toMatchObject({ phase: 'delivered', delivered: 'pr #100', pr: 100, github: ['#100 OPEN'] });
    expect(opened.turns).toBe(0);
  });

  // "The run journal": "once past asking them to commit what they left", so a restart before then never puts their
  // work up without what they left, unasked
  it('a restart before they’re asked to commit doesn’t deliver without asking them', async () => {
    const { after } = await cutOff('look for changes', 'lost', ['the developer commits', 'the developer leaves work uncommitted', 'the turn ends']);
    expect(after).toMatchObject({ pushed: [], github: [], uncommitted: ['edit 1'] });
  });

  // "After a restart": one "decided" to be delivered "but not yet as far as asking them to commit what they left, is
  // delivered from the start". Found on main by the restart check (docs/invariants.md, "Found on main"): a restart while
  // Ops looked for uncommitted changes left the work off GitHub, the developer stopped, waiting for a message
  it('a restart as their turn ends, before the delivery is journaled, still asks them to commit and delivers', async () => {
    const asked = await cutOff('look for changes', 'lost', ['the developer commits', 'the developer leaves work uncommitted', 'the turn ends']);
    expect(asked.after).toMatchObject({ phase: 'turn.started', status: 'working', nudges: 1 });
    const delivered = await cutOff('look for changes', 'lost', ['the developer commits', 'the turn ends']);
    expect(delivered.after).toMatchObject({ phase: 'delivered', delivered: 'pr #100', status: 'done', pushed: ['w1'], github: ['#100 OPEN'] });
    expect(delivered.turns).toBe(0);
  });

  // "Deliver": "When GitHub answers the push or the PR with a 5xx, it tries again after 4, 8 and 16 seconds … before
  // giving up" (the waits themselves are services.test.ts's, on a test clock)
  it('a 5xx is retried after 4, 8 and 16 s, then given up', async () => {
    const after = await take(['the developer commits', 'GitHub answers the next push with a 502', 'GitHub answers opening the next pull request with a 502', 'the turn ends', 'the captain sends a follow-up', 'the developer commits', 'GitHub answers every push with a 502', 'the turn ends']);
    expect(after[3]).toMatchObject({ delivered: 'pr #100', pushed: ['w1'], github: ['#100 OPEN'] });
    expect(after[7]).toMatchObject({ phase: 'failed', status: 'error', pushed: ['w1'], commits: ['w1', 'w2'] });
  });

  // "Follow-ups": "Once they're done, the message resumes the same Claude session and the new commits update the PR"
  it('a follow-up’s commits update the pull request', async () => {
    const after = await take(['the developer commits', 'the turn ends', 'the captain sends a follow-up', 'the developer commits', 'the turn ends']);
    expect(after[4]).toMatchObject({ delivered: 'pr #100', pr: 100, pushed: ['w1', 'w2'], github: ['#100 OPEN'], heard: ['follow-up 1'] });
  });

  // "After a restart": "its pull request found or opened": one opened from the branch on GitHub is found, not opened again
  it('finds a pull request already open from the branch', async () => {
    const after = await take(['the developer commits', 'GitHub answers every try at opening a pull request with a 502', 'the turn ends', 'someone opens a pull request from the branch on GitHub', 'the captain sends a follow-up', 'the turn ends']);
    expect(after[2]).toMatchObject({ phase: 'failed', pushed: ['w1'], github: [] });
    expect(after[5]).toMatchObject({ delivered: 'pr #100', pr: 100, pushed: ['w1'], github: ['#100 OPEN'] });
  });

  // "Follow-ups": "message an agent at any time … Once they're done, the message resumes the same Claude session": one
  // written as the work goes up is heard once it's up, in the same conversation
  it('a message written as the work goes up is heard once it’s up', async () => {
    const after = await take(['the developer commits', 'the turn ends, and the captain writes as the work goes up']);
    expect(after[1]).toMatchObject({ delivered: 'pr #100', pushed: ['w1'], phase: 'turn.started', status: 'working', heard: ['follow-up 1'] });
  });

  // Found on main by this description's plain test (docs/invariants.md, "Found on main"): when the delivery failed, the
  // message stayed in their inbox unheard, the developer showing "Hit a problem – send a message to retry"
  it('a message written as the work goes up is heard even when GitHub fails it', async () => {
    const after = await take(['the developer commits', 'GitHub answers every try at opening a pull request with a 502', 'the turn ends, and the captain writes as the work goes up']);
    expect(after[2]).toMatchObject({ pushed: ['w1'], github: [], phase: 'turn.started', status: 'working', heard: ['follow-up 1'] });
  });

  // "Deliver": "if they left uncommitted changes, they're asked once to commit them": once for each delivery, a
  // follow-up's too, however the captain's message reached them
  // Found on main by this plain test (docs/invariants.md, "Found on main"): Ops still had them down as asked
  it('asks them to commit what a follow-up left, though the message came as the work went up', async () => {
    const after = await take(['the developer commits', 'the developer leaves work uncommitted', 'the turn ends', 'the turn ends, and the captain writes as the work goes up', 'the developer leaves work uncommitted', 'the turn ends']);
    expect(after[3]).toMatchObject({ nudges: 1, pushed: ['w1'], phase: 'turn.started', heard: ['follow-up 1'] });
    expect(after[5]).toMatchObject({ nudges: 2, phase: 'turn.started', status: 'working' });
  });

  // docs/qa.md: "a developer's push … tell QA the commit they pushed (QaReview.shippedHead)"
  it('tells QA the commit it pushed', async () => {
    const after = await take(['the developer commits', 'the turn ends', 'the captain sends a follow-up', 'the developer commits', 'the turn ends']);
    expect(after[1]?.qa).toEqual(['#100 at c1']);
    expect(after[4]?.qa).toEqual(['#100 at c2']);
  });
});
