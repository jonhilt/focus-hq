import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { demoWorkspace } from './demoRunner';
import { leadWorktreeId } from './lead';
import { office, restarted } from './fakeOffice';
import { type Action, checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';
import type { WorkspaceOps } from './types';

// A goal lead's slices, under the office's two rules (docs/invariants.md): a restart is atomic, and two things at once
// end as one after the other would. A slice ships (its pull requests pushed and opened), lands (each merged), and moves
// on to fresh code (checkouts gone and made again, what never shipped brought over), each told by the slice journal
// (sliceJournal.ts). Described here (what can happen to a lead's slices, what must survive), not told what to expect.

vi.setConfig({ testTimeout: 120_000 });

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

/** The lead's checkouts as the disk keeps them across lives: each one's commits, counted. */
type Disk = Map<string, number>;

/** The demo's workspace, its commits counted on `disk`, and its slow steps (checkouts, pushes, moving commits) answered through `later`. */
const workspace = (later: Later, disk: Disk): WorkspaceOps => ({
  ...demoWorkspace,
  create: (_repo, id) => later('checkout', () => Promise.resolve(`/demo/${id}`)),
  remove: () => later('remove', () => Promise.resolve()),
  head: (dir) => Promise.resolve(`${dir}@${disk.get(dir) ?? 0}`),
  // what's been committed since the last ship
  unshippedCommits: (dir, _base, shipped) => Promise.resolve(shipped === `${dir}@${disk.get(dir) ?? 0}` ? [] : [`${dir}@${disk.get(dir) ?? 0}`]),
  cherryPick: () => later('cherry-pick', () => Promise.resolve()),
  push: () => later('push', () => Promise.resolve()),
});

interface Kept {
  phase: string;
  slice: number;
  /** The slice's pull requests as the journal tells them, and as the lead has them. */
  journal: string[];
  lead: string[];
  /** Pull requests open on GitHub, as GitHub has them. */
  open: string[];
  repos: number;
  /** The lead's branch is the one the journal says the slice is on. */
  onBranch: boolean;
  /** The slices the lead's been told landed: heard (in a turn's prompt, or into a session that ran on) or still waiting
   *  (not just taken for a turn that was never asked for: once settled, nothing will hear that). */
  told: number[];
}

const pr = (p: { repo: string; number: number; outcome?: string }) => `${p.repo}#${p.number}${p.outcome ? ` ${p.outcome}` : ''}`;

/**
 * The lead's slices, from a goal just set up, or (`shipped`) with its first slice shipped (and their turn ended). `mergesMidShip`: whether
 * the captain can merge a pull request while the lead's ship is under way (a known race, below). `only`: the actions
 * offered, by name, when a check is after one thing. `landsMidTurn`: whether the captain can merge the slice's last pull request while the lead's turn
 * is under way. The office moves a landed slice on at the start of the lead's next turn, and a restart starts one (the
 * resumed turn), so a slice that landed mid-turn moves on a turn early after a restart: by design, and nothing half-done,
 * but not what the rule for a restart allows. The restart check leaves that case out; the check for two at once has it.
 */
const slices = ({ landsMidTurn, mergesMidShip = true, shipped = false, only }: { landsMidTurn: boolean; mergesMidShip?: boolean; shipped?: boolean | 'and their turn ended'; only?: RegExp }): Subject<Kept> => ({
  name: 'slices',
  start: async (start) => {
    // GitHub, kept across lives as GitHub keeps it: the pull requests the office opens asked for through `later`
    const gh = Effect.runSync(Effect.provide(GitHub, demoLayer));
    const opened: { repo: string; number: number; branch: string; merged?: boolean }[] = [];
    const github = (later: Later) =>
      Layer.succeed(GitHub, GitHub.of({
        ...gh,
        // a read changes nothing out there: answered at once, so a restart's cuts fall between the steps that do
        findPullRequest: (repo, branch) =>
          Effect.sync(() => opened.find((p) => p.repo === repo && p.branch === branch && !p.merged)).pipe(
            Effect.map((p) => (p ? { number: p.number, url: `https://github.com/${repo}/pull/${p.number}` } : null)),
          ),
        createPullRequest: (repo, req) =>
          Effect.promise(() => later('open', () => {
            const number = 100 + opened.length;
            opened.push({ repo, number, branch: req.head });
            return Promise.resolve({ number, url: `https://github.com/${repo}/pull/${number}` });
          })),
      }));
    const disk: Disk = new Map();
    // the goal's own setting up (its first checkouts) isn't what's under test: it's done before the first action
    let setUp = false;
    const later: Later = (label, work) => (setUp ? start(label, work) : work());
    const first = office(workspace(later, disk), github(later));
    // QA's reviews are held to the rules on their own (reviewInvariants.test.ts)
    first.project.autoQa = false;
    const started = first.agents.startGoal(first.project.id, 'Saved items');
    if (!('agent' in started)) throw new Error('the goal was queued');
    const id = started.agent.id;
    const store = first.store;
    // every life's Claude Code, for what the lead heard in each
    const claudes = [first.claude];
    const kept = (): Kept => {
      const journal = store.slice(id);
      const agent = store.agent(id);
      const run = store.run(id);
      const heard = [...claudes.flatMap((c) => c.turns.flatMap((t) => [t.req.prompt, ...(t.stopped ? [] : t.sent)])), ...run.inbox, ...run.later];
      return {
        phase: JSON.stringify(journal.phase),
        slice: journal.slice,
        journal: journal.prs.map(pr).sort(),
        lead: (agent.lead?.prs ?? []).map(pr).sort(),
        open: opened.filter((p) => !p.merged).map(pr).sort(),
        repos: agent.lead?.repos.length ?? 0,
        onBranch: agent.branch === journal.branch,
        told: [1, 2, 3].filter((n) => heard.some((h) => h.includes(`Slice ${n} has landed`))),
      };
    };
    const life = (o: Pick<ReturnType<typeof office>, 'agents' | 'claude'>): Running<Kept> & { all: () => Action[] } => {
      const ended = new Set<number>();
      // Claude Code calls a tool that changes things (ship isn't marked read-only) one at a time: never two ships at once
      let shipping = false;
      // the lead's turn under way: with none, they can't ship or end it
      const turn = () => {
        const t = o.claude.turns.find((t, i) => !t.stopped && !ended.has(i));
        if (!t) throw new Error('no turn under way');
        return t;
      };
      const all = (): Action[] => [
          {
            name: 'the lead ships',
            run: () => {
              if (shipping) throw new Error('the lead is already shipping');
              const t = turn();
              // they commit, then ship
              for (const r of store.agent(id).lead?.repos ?? []) {
                const dir = demoWorkspace.dir(leadWorktreeId(id, r.folder));
                disk.set(dir, (disk.get(dir) ?? 0) + 1);
              }
              shipping = true;
              return t.req.tools!.ship({ title: 'Saved items', summary: 'A slice.' }).finally(() => (shipping = false));
            },
          },
          {
            name: 'the turn ends',
            run: () => {
              const t = turn();
              ended.add(o.claude.turns.indexOf(t));
              t.end({ ok: true, summary: 'done', started: true });
            },
          },
          { name: 'the captain writes', run: () => o.agents.message(id, 'Next') },
          // the pull requests open on GitHub: the captain merges one
          ...opened.filter((p) => !p.merged).map((p) => ({
            name: `${p.repo}#${p.number} merges`,
            run: () => {
              // merged by the time it's taken (two at once)
              if (p.merged) throw new Error('already merged');
              if (!mergesMidShip && shipping) throw new Error('not while the lead is shipping');
              const rest = (store.agent(id).lead?.prs ?? []).filter((q) => !q.outcome && !(q.repo === p.repo && q.number === p.number));
              if (!landsMidTurn && !rest.length && o.claude.turns.some((t, i) => !t.stopped && !ended.has(i))) throw new Error('not while the lead’s turn is under way');
              p.merged = true;
              o.agents.prClosed(p.repo, p.number, true);
            },
          })),
        ];
      return {
        all,
        actions: () => all().filter((a) => !only || only.test(a.name)),
        durable: kept,
        settle: () => steady(() => [kept(), o.claude.turns.length, store.agent(id).status]),
        close: () => o.agents.shutDown(),
        restart: (later) => {
          o.agents.shutDown();
          const after = restarted(store, workspace(later, disk), github(later));
          claudes.push(after.claude);
          after.agents.recover();
          return life(after);
        },
      };
    };
    const running = life(first);
    await running.settle();
    if (shipped) {
      await running.all().find((a) => a.name === 'the lead ships')?.run();
      await running.settle();
      if (shipped === 'and their turn ended') {
        running.all().find((a) => a.name === 'the turn ends')?.run();
        await running.settle();
      }
    }
    setUp = true;
    return running;
  },
});

describe('a lead’s slices, under the office’s two rules', () => {
  // a description that never got a slice shipped, landed and moved on would pass both rules and prove nothing
  it('reaches a slice shipped, landed and moved on to fresh code, taken one at a time', async () => {
    const s = await slices({ landsMidTurn: true }).start(now);
    const phases: string[] = [];
    const take = async (name: string) => {
      const action = s.actions().find((a) => a.name.endsWith(name));
      expect(action, name).toBeDefined();
      await Promise.resolve(action!.run());
      await s.settle();
      phases.push(s.durable().phase);
    };
    await take('the lead ships');
    expect(s.durable()).toMatchObject({ phase: '"in-review"', open: [expect.stringContaining('#'), expect.stringContaining('#')] });
    // the captain merges while the lead's turn is still under way: the repos move at the start of their next one
    for (const p of s.durable().open) await take(`${p} merges`);
    expect(s.durable().phase).toBe('"landed"');
    await take('the turn ends');
    if (s.durable().phase !== '"working"') await take('the captain writes');
    s.close?.();
    expect(phases).toEqual(expect.arrayContaining(['"in-review"', '"landed"']));
    // moved on: the move's facts (moving, then moved) are what took it to the next slice
    expect(s.durable()).toMatchObject({ phase: '"working"', slice: 2, journal: [], lead: [], repos: 2, onBranch: true, told: [1] });
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(slices({ landsMidTurn: false }), { runs: 15 });
  });

  // a slice that lands and moves on to fresh code takes a ship and every merge first: rare from a goal just set up
  it('end a restart during a move to fresh code as if it had never started, or had finished', async () => {
    await checkRestart(slices({ landsMidTurn: false, shipped: 'and their turn ended', only: /merges/ }), { runs: 15, prefix: 1 });
  });

  // fails on a known bug, on purpose until it's fixed: a pull request that merges while the lead is shipping is put back
  // in the slice journal as open (docs/invariants.md#found-on-main; the same bug's own test is in sliceRecovery.test.ts).
  // From a shipped slice, straight into a ship and a merge at once, so it finds it every time; fold it back into the
  // fuller check below (with merges mid-ship) once it's fixed
  it.fails('end a ship and a merge at once as one after the other would', async () => {
    await checkAtOnce(slices({ landsMidTurn: true, shipped: true, only: /ships|merges/ }), { runs: 30, prefix: 0 });
  });

  // everything else at once, from a goal just set up: the known race above left out
  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(slices({ landsMidTurn: true, mergesMidShip: false }), { runs: 15 });
  });
});
