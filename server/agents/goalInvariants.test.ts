import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { closedGoals } from '../../shared/ledger';
import { openQuestion } from '../../shared/artifacts';
import type { GoalArtifact, GoalQuestion, LeadPr } from '../../shared/types';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { demoWorkspace } from './demoRunner';
import { everyPr, leadWorktreeId } from './lead';
import { focus, type Render, restarted } from './fakeFocus';
import { type Action, checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';
import type { OpsTools, WorkspaceOps } from './types';

// A goal's life to its close, under Focus's two rules (docs/invariants.md): a restart is atomic, and two things at
// once end as one after the other would. A goal's lead shows the captain things (artifacts) and asks them questions,
// which they answer by picking an option or in chat; the lead leaves work uncommitted in its checkouts and ships slices;
// the captain closes the goal, and may reopen it. Closing keeps what should outlive the goal (docs/goals.md, "Ending a
// goal" and "Showing you things"): its artifacts and questions as they stood, every slice's pull requests, and
// uncommitted work as a WIP snapshot on its branch. Described here (what can happen to a goal, what must survive), not
// told what to expect.

// a soak (FOCUS_INVARIANT_RUNS) takes as many times longer
vi.setConfig({ testTimeout: 120_000 * Math.max(1, Number(process.env.FOCUS_INVARIANT_RUNS ?? 1) || 1) });

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
 * The disk, as it's kept across lives: each checkout's uncommitted work (gone with the checkout), the work committed on
 * each branch in Ops' clone (kept), and each checkout's commits, counted, for what a ship pushes.
 */
interface Disk {
  checkouts: Map<string, { branch: string; uncommitted: string[] }>;
  branches: Map<string, string[]>;
  commits: Map<string, number>;
}

/** The demo's workspace on `disk`, its slow steps (checkouts, removing them, a snapshot, a push) answered through `later`. */
const workspace = (later: Later, disk: Disk): WorkspaceOps => {
  const checkout = (agentId: string, branch: string) => later('checkout', () => {
    const dir = demoWorkspace.dir(agentId);
    disk.checkouts.set(dir, { branch, uncommitted: [] });
    return Promise.resolve(dir);
  });
  return {
    ...demoWorkspace,
    create: (_repo, agentId, branch) => checkout(agentId, branch),
    // a closed goal's branch as it was left: its commits are on it in the clone already
    reopen: (_repo, agentId, branch) => checkout(agentId, branch),
    // what's uncommitted goes with the checkout
    remove: (_repo, agentId) => later('remove', () => Promise.resolve(void disk.checkouts.delete(demoWorkspace.dir(agentId)))),
    hasUncommittedChanges: (dir) => {
      const c = disk.checkouts.get(dir);
      return c ? Promise.resolve(c.uncommitted.length > 0) : Promise.reject(new Error(`no checkout at ${dir}`));
    },
    snapshot: (dir) => later('snapshot', () => {
      const c = disk.checkouts.get(dir);
      if (!c?.uncommitted.length) return Promise.resolve(false);
      disk.branches.set(c.branch, [...(disk.branches.get(c.branch) ?? []), ...c.uncommitted]);
      c.uncommitted = [];
      return Promise.resolve(true);
    }),
    head: (dir) => Promise.resolve(`${dir}@${disk.commits.get(dir) ?? 0}`),
    unshippedCommits: (dir, _base, shipped) => Promise.resolve(shipped === `${dir}@${disk.commits.get(dir) ?? 0}` ? [] : [`${dir}@${disk.commits.get(dir) ?? 0}`]),
    push: () => later('push', () => Promise.resolve()),
  };
};

/** Pictures of the lead's pages, taken through `later`: they take a moment. */
const pictures = (later: Later): Render => () => later('picture', () => Promise.resolve({ image: Buffer.from('jpeg'), errors: [] }));

interface Kept {
  /** The lead's at its station, and the goal's in the room's log. */
  open: boolean;
  logged: boolean;
  /** The goal as the ledger keeps it for good, each time it closed: its artifacts and questions. */
  archived: string[];
  /** Where the goal is (the lead's, or the room's log): what it showed, what it asked and how it was answered, every pull request. */
  artifacts: string[];
  questions: string[];
  prs: string[];
  /** The pages of what the goal has (each artifact's and each option's, and their pictures) that Focus has lost.
   *  A page written for something that never went up is left over, not lost: it isn't counted. */
  lost: string[];
  /** The pull requests open on GitHub. */
  github: string[];
  /** The lead's work and where it's kept: uncommitted in a checkout, or committed on a branch (a WIP snapshot). */
  work: string[];
}

const artifact = (a: GoalArtifact) => `${a.id} ${a.title}${a.image ? ' pictured' : ''}`;
const question = (q: GoalQuestion) => `${q.id} ${q.question} ${q.answer ? (q.answer.option ? `picked ${q.answer.option}` : `in chat: ${q.answer.note ?? ''}`) : 'open'}`;
const pr = (p: Pick<LeadPr, 'repo' | 'number' | 'outcome'>) => `${p.repo}#${p.number}${p.outcome ? ` ${p.outcome}` : ''}`;

/** A goal's life to its close; `only`: the actions offered, by name, when a check is after one thing. */
const goal = (only?: RegExp): Subject<Kept> => ({
  name: 'goal',
  start: async (start) => {
    // GitHub, kept across lives as GitHub keeps it: the pull requests Ops opens asked for through `later`
    const gh = Effect.runSync(Effect.provide(GitHub, demoLayer));
    const opened: { repo: string; number: number; branch: string }[] = [];
    const github = (later: Later) =>
      Layer.succeed(GitHub, GitHub.of({
        ...gh,
        findPullRequest: (repo, branch) =>
          Effect.sync(() => opened.find((p) => p.repo === repo && p.branch === branch)).pipe(
            Effect.map((p) => (p ? { number: p.number, url: `https://github.com/${repo}/pull/${p.number}` } : null)),
          ),
        createPullRequest: (repo, req) =>
          Effect.promise(() => later('open', () => {
            const number = 100 + opened.length;
            opened.push({ repo, number, branch: req.head });
            return Promise.resolve({ number, url: `https://github.com/${repo}/pull/${number}` });
          })),
        pullRequestState: (repo, number) => Effect.succeed(opened.some((p) => p.repo === repo && p.number === number) ? 'OPEN' as const : 'CLOSED' as const),
      }));
    const disk: Disk = { checkouts: new Map(), branches: new Map(), commits: new Map() };
    // the goal's own setting up (its first checkouts) isn't what's under test: it's done before the first action
    let setUp = false;
    const later: Later = (label, work) => (setUp ? start(label, work) : work());
    const first = focus(workspace(later, disk), github(later), undefined, pictures(later));
    // QA's reviews are held to the rules on their own (reviewInvariants.test.ts)
    first.project.autoQa = false;
    const { store, project } = first;
    const started = first.agents.startGoal(project.id, 'Saved items');
    if (!('agent' in started)) throw new Error('the goal was queued');
    const id = started.agent.id;
    // the goal's pages, as Focus keeps them (on disk, outside the test)
    const files = new Set<string>();
    const save = store.saveArtifact.bind(store);
    const drop = store.deleteArtifact.bind(store);
    store.saveArtifact = (leadId, file, bytes) => (leadId === id && files.add(file), save(leadId, file, bytes));
    store.deleteArtifact = (leadId, file) => (leadId === id && files.delete(file), drop(leadId, file));
    // the lead's edits, numbered as they're made
    let edits = 0;
    const kept = (): Kept => {
      const lead = store.agents.get(id)?.lead;
      const record = project.goals?.find((g) => g.id === id);
      const where = lead ?? record;
      return {
        open: !!lead,
        logged: !!record,
        archived: closedGoals(store.ledger, project.id).filter((g) => g.id === id).map((g) => `${(g.artifacts ?? []).map(artifact).join(', ')} | ${(g.questions ?? []).map(question).join(', ')}`),
        artifacts: (where?.artifacts ?? []).map(artifact),
        questions: (where?.questions ?? []).map(question),
        prs: (lead ? everyPr(lead) : (record?.prs ?? [])).map(pr).sort(),
        lost: [
          ...(where?.artifacts ?? []).flatMap((a) => [`${a.id}.html`, ...(a.image ? [`${a.id}.jpg`] : [])]),
          ...(where?.questions ?? []).flatMap((q) => q.options.flatMap((o) => [`${q.id}.${o.id}.html`, ...(o.image ? [`${q.id}.${o.id}.jpg`] : [])])),
        ].filter((f) => !files.has(f)),
        github: opened.map(pr).sort(),
        work: [...[...disk.checkouts.values()].flatMap((c) => c.uncommitted.map((w) => `${w}, uncommitted`)), ...[...disk.branches.values()].flat().map((w) => `${w}, committed`)].sort(),
      };
    };
    const life = (o: Pick<ReturnType<typeof focus>, 'agents' | 'claude'>): Running<Kept> => {
      const ended = new Set<number>();
      // Claude Code calls a tool that changes things one at a time: never two of the lead's at once
      let busy = false;
      const turn = () => {
        const t = o.claude.turns.find((t, i) => !t.stopped && !ended.has(i));
        if (!t?.req.tools) throw new Error('no turn under way');
        return t;
      };
      const tool = <T,>(use: (tools: OpsTools) => Promise<T>) => {
        if (busy) throw new Error('the lead is using another tool');
        const tools = turn().req.tools;
        if (!tools) throw new Error('no Ops tools');
        busy = true;
        return use(tools).finally(() => (busy = false));
      };
      const show = (page: string): Action => ({ name: `the lead shows “${page}”`, run: () => tool((t) => t.show({ id: page, title: page, html: `<h1>${page}</h1>` })) });
      const all = (): Action[] => [
        show('flow'),
        show('plan'),
        { name: 'the lead asks', run: () => tool((t) => t.ask({ question: 'Which layout?', options: [{ label: 'Grid', html: '<p>grid</p>' }, { label: 'List', html: '<p>list</p>' }] })) },
        {
          name: 'the lead leaves work uncommitted',
          run: () => {
            if (busy) throw new Error('the lead is using another tool');
            turn();
            const repo = store.agent(id).lead?.repos[0];
            const c = repo && disk.checkouts.get(demoWorkspace.dir(leadWorktreeId(id, repo.folder)));
            if (!c) throw new Error('nothing checked out');
            c.uncommitted.push(`edit ${++edits}`);
          },
        },
        {
          name: 'the lead ships',
          run: () =>
            tool((t) => {
              // they commit, then ship
              for (const r of store.agent(id).lead?.repos ?? []) {
                const dir = demoWorkspace.dir(leadWorktreeId(id, r.folder));
                disk.commits.set(dir, (disk.commits.get(dir) ?? 0) + 1);
              }
              return t.ship({ title: 'Saved items', summary: 'A slice.' });
            }),
        },
        {
          name: 'the turn ends',
          run: () => {
            const t = turn();
            ended.add(o.claude.turns.indexOf(t));
            t.end({ ok: true, summary: 'done', started: true });
          },
        },
        {
          name: 'the captain picks A',
          run: () => {
            const q = openQuestion(store.agents.get(id));
            if (!q) throw new Error('nothing asked');
            return o.agents.answer(id, q.id, 'a');
          },
        },
        { name: 'the captain writes', run: () => o.agents.message(id, 'Go with the grid') },
        { name: 'the captain closes the goal', run: () => o.agents.closeGoal(id, true) },
        { name: 'the captain reopens the goal', run: () => o.agents.reopenGoal(project.id, id) },
      ];
      return {
        actions: () => all().filter((a) => !only || only.test(a.name)),
        durable: kept,
        settle: () => steady(() => [kept(), o.claude.turns.length, store.agents.get(id)?.status]),
        close: () => o.agents.shutDown(),
        restart: (later) => {
          o.agents.shutDown();
          const after = restarted(store, workspace(later, disk), github(later), pictures(later));
          after.agents.recover();
          return life(after);
        },
      };
    };
    const running = life(first);
    await running.settle();
    setUp = true;
    return running;
  },
});

describe('a goal’s life to its close, under Focus’s two rules', () => {
  // a description that never got a goal closed with something on it would pass both rules and prove nothing
  it('reaches a goal closed with what it showed, asked, shipped and left uncommitted, and reopened, taken one at a time', async () => {
    const g = await goal().start(now);
    const take = async (name: string) => {
      const action = g.actions().find((a) => a.name === name);
      expect(action, name).toBeDefined();
      await Promise.resolve(action!.run());
      await g.settle();
      return g.durable();
    };
    await take('the lead shows “flow”');
    await take('the lead asks');
    // answered in chat, which starts a turn; asked again, and picked
    await take('the turn ends');
    expect((await take('the captain writes')).questions).toEqual(['q1 Which layout? in chat: Go with the grid']);
    await take('the lead asks');
    await take('the turn ends');
    await take('the captain picks A');
    await take('the lead ships');
    await take('the lead leaves work uncommitted');
    expect(g.durable()).toMatchObject({ open: true, logged: false, work: ['edit 1, uncommitted'], prs: [expect.stringContaining('#'), expect.stringContaining('#')] });
    const closed = await take('the captain closes the goal');
    expect(closed).toMatchObject({
      open: false,
      logged: true,
      artifacts: ['flow flow pictured'],
      questions: ['q1 Which layout? in chat: Go with the grid', 'q2 Which layout? picked a'],
      prs: closed.github,
      lost: [],
      // committed as a WIP snapshot on the goal's branch, its checkout gone
      work: ['edit 1, committed'],
    });
    expect(closed.archived).toHaveLength(1);
    const reopened = await take('the captain reopens the goal');
    g.close?.();
    expect(reopened).toMatchObject({ open: true, logged: false, artifacts: closed.artifacts, questions: closed.questions, prs: closed.prs, work: ['edit 1, committed'] });
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(goal(), { runs: 25 });
  });

  // closing is the step this part is about: a restart part way through a close of a goal with work left uncommitted,
  // which a check over everything reaches only now and then
  it('end a restart during a close as if it had never started, or had finished', async () => {
    await checkRestart(goal(/uncommitted|closes/), { runs: 25, prefix: 2 });
  });

  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(goal(), { runs: 25 });
  });

  // the captain closing while the lead asks again: the questions the closed goal filed keep their pages
  it('end a close and a question at once as one after the other would', async () => {
    await checkAtOnce(goal(/asks|closes/), { runs: 40, prefix: 2 });
  });

  // the captain closing while the lead ships: the pull requests the ship opens stay on the goal
  it('end a close and a ship at once as one after the other would', async () => {
    await checkAtOnce(goal(/uncommitted|ships|closes/), { runs: 25, prefix: 1 });
  });
});
