import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { qaOfficerFor } from '../shared/crew';
import { prKey } from '../shared/qa';
import { type Agent, type ClosedPr, DESKS_PER_ROOM } from '../shared/types';
import { checkAtOnce, checkRestart, type Running, type Subject } from './agents/invariants';
import { paths } from './config';
import { Store } from './store';

// Who's aboard, and the pull requests the operations officer closed (server/store.ts, kept in state.json), under
// Focus's two rules (docs/invariants.md): a restart ends as if a change had never started, or had finished, and two
// changes at once as one after the other would. Its promises are docs/agents.md's ("Who's aboard is kept") and
// docs/qa.md's (a closed PR's issue tells the next agent why). A change waits on nothing outside: each is taken whole,
// and Focus going down saves what's waiting (the store's exit hook), so a restart falls between changes. That also
// means two changes can't interleave; the at-once check holds that if one ever waits on something.

// every run opens a store on state.json and the ledger, twice with a restart: a couple of seconds, more on a busy machine
vi.setConfig({ testTimeout: 30_000 * Math.max(1, Number(process.env.FOCUS_INVARIANT_RUNS ?? 1) || 1) });

/** What survives of each agent (a restart stops whoever was at work, so not their status), and the closed PRs. */
interface Kept {
  aboard: { id: string; projectId: string; task: Agent['task']; issue: number; desk: number }[];
  closed: { key: string; pr: number; note: string }[];
}

const PROJECTS = ['proj_a', 'proj_b'];
const CREW = ['ada', 'bo', 'cy'];
const ISSUES = [1, 2];

const developer = (name: string, projectId: string, desk: number): Agent => ({
  id: `agent_${name}`,
  name,
  avatar: qaOfficerFor(projectId).avatar,
  projectId,
  repo: 'demo/shop',
  task: 'issue',
  issue: { number: name.length, title: `${name}'s issue`, url: '' },
  desk,
  status: 'queued',
  activity: '',
  branch: `focus/${name}`,
  baseBranch: 'main',
  startedAt: 1,
  costUsd: 0,
});

const closedPr = (issue: number): ClosedPr => ({ repo: 'demo/shop', issue, pr: 100 + issue, officer: 'Lt. Hale', note: `wrong approach to #${issue}`, at: 1 });


const kept = (store: Store): Kept => ({
  aboard: [...store.agents.values()].map((a) => ({ id: a.id, projectId: a.projectId, task: a.task, issue: a.issue.number, desk: a.desk })).sort((a, b) => a.id.localeCompare(b.id)),
  closed: [...store.closedPrs.entries()].map(([key, c]) => ({ key, pr: c.pr, note: c.note })).sort((a, b) => a.key.localeCompare(b.key)),
});

/** Every store the description has opened and not yet put away. */
const opened: Store[] = [];

const freeDesk = (store: Store, projectId: string) => [...Array(DESKS_PER_ROOM).keys()].find((d) => !store.agentsIn(projectId).some((a) => a.desk === d));

/**
 * A store on a fresh state.json, and what a life of it offers. `make` is the store each life opens and `shutDown` how
 * Focus going down treats it: the real ones, or a break planted in their place.
 */
const storeSubject = (how: { make?: () => Store; shutDown?: (store: Store) => void } = {}): Subject<Kept> => ({
  name: 'the store',
  start: () => {
    // a store from an earlier run may still have a save waiting (a quarter of a second): it writes now, not over this run
    for (const old of opened.splice(0)) old.flush();
    fs.rmSync(paths.state, { force: true });
    const life = (): Running<Kept> & { store: Store } => {
      const store = how.make?.() ?? new Store(true);
      store.load();
      opened.push(store);
      return {
        store,
        actions: () => [
          // hired only to a free desk: one saved off the floor is reseated as Focus starts (deskRules' fitDesks), on purpose
          ...CREW.flatMap((name) => PROJECTS.flatMap((projectId) =>
            store.agents.has(`agent_${name}`) || freeDesk(store, projectId) === undefined ? [] : [{
              name: `hire ${name} in ${projectId}`,
              // the desk is the one free as the hire is made, as seating picks it, refused once there's none
              run: () => {
                const desk = freeDesk(store, projectId);
                if (desk === undefined || store.agents.has(`agent_${name}`)) throw new Error('No desk free');
                store.putAgent(developer(name, projectId, desk));
              },
            }])),
          ...[...store.agents.values()].flatMap((a) => [
            { name: `set ${a.id} to work`, run: () => store.putAgent({ ...store.agent(a.id), status: 'working', activity: 'Editing' }) },
            { name: `send ${a.id} home`, run: () => store.removeAgent(a.id) },
          ]),
          ...ISSUES.map((issue) => ({ name: `close the PR on #${issue}`, run: () => store.putClosedPr(closedPr(issue)) })),
          // as hiring on the issue does, once its developer has heard why
          ...ISSUES.map((issue) => ({ name: `tell the next developer on #${issue}`, run: () => store.removeClosedPr('demo/shop', issue) })),
        ],
        durable: () => kept(store),
        settle: () => Promise.resolve(),
        restart: () => {
          (how.shutDown ?? ((s) => s.flush()))(store);
          return life();
        },
      };
    };
    return life();
  },
});

const store = storeSubject();

/** The promises' run: two hired, one set to work, one sent home, a PR closed, then Focus restarted. */
async function crewRestart(subject: Subject<Kept>): Promise<{ before: Kept; after: Kept; ada: Agent | undefined }> {
  const r = await subject.start((_l, work) => work());
  const take = (name: string) => {
    const action = r.actions().find((a) => a.name === name);
    if (!action) throw new Error(`no "${name}" to take`);
    action.run();
  };
  for (const name of ['hire ada in proj_a', 'hire bo in proj_a', 'hire cy in proj_b', 'set agent_ada to work', 'send agent_bo home', 'close the PR on #2']) take(name);
  const before = r.durable();
  const again = await r.restart((_l, work) => work());
  const ada = 'store' in again && again.store instanceof Store ? again.store.agents.get('agent_ada') : undefined;
  return { before, after: again.durable(), ada };
}

describe('the store, under Focus’s two rules', () => {
  it('ends a restart as if a change had never started, or had finished', async () => {
    await checkRestart(store, { runs: 25 });
  });

  it('ends two changes at once as one after the other would', async () => {
    await checkAtOnce(store, { runs: 25 });
  });

  // docs/agents.md: "Everyone aboard when Focus went down is aboard when it starts again, on the same project, task
  // and issue and at the same desk, and no one sent home comes back. Whoever was at work stops"
  it('brings everyone aboard back at their desk, no one sent home, and whoever was at work stopped', async () => {
    const { before, after, ada } = await crewRestart(store);
    expect(after.aboard).toEqual(before.aboard);
    expect(after.aboard.map((a) => [a.id, a.desk])).toEqual([['agent_ada', 0], ['agent_cy', 0]]);
    expect(ada).toMatchObject({ status: 'stopped', activity: expect.stringContaining('Interrupted') });
  });

  // docs/qa.md: a closed PR's issue "stays open, and the next agent assigned to it hears why, even after a restart"
  it('remembers the PR the officer closed on its issue across a restart, with why', async () => {
    const { after } = await crewRestart(store);
    expect(after.closed).toEqual([{ key: prKey('demo/shop', 2), pr: 102, note: 'wrong approach to #2' }]);
  });

  it('reaches the states that matter: someone at work, someone sent home, a PR closed, all across a restart', async () => {
    const { before } = await crewRestart(store);
    expect(before.aboard).toHaveLength(2);
    expect(before.closed).toHaveLength(1);
  });

  it('catches a break with the restart rule: Focus going down without saving what was waiting', async () => {
    const unsaved = storeSubject({ shutDown: () => undefined });
    await expect(checkRestart(unsaved, { runs: 25 })).rejects.toThrow(/restarted during/);
  });

  it('catches a break with that promise: a store that doesn’t take the closed PRs back as it loads', async () => {
    class Forgetful extends Store {
      override load(): void {
        super.load();
        this.closedPrs.clear();
      }
    }
    const forgetful = storeSubject({ make: () => new Forgetful(true) });
    expect((await crewRestart(forgetful)).after.closed).toEqual([]);
  });
});

// A session's images (Store.saveSessionImage, server/sessionImages.ts), files named by their content: what's kept is
// each saved file's bytes. A save waits on nothing outside, so a restart falls between saves; a save cut off part way
// is the promise's to show (docs/agents.md, "A session's transcript keeps everything the agent did, whole").

const IMAGES = { a: Buffer.from('first image'), b: Buffer.from('second image, a little longer') };

/** Each saved image's bytes, by file: what a browser asking for it would get. */
const savedImages = (): Record<string, string> => {
  const files = fs.existsSync(paths.sessionImages) ? fs.readdirSync(paths.sessionImages).filter((f) => !f.endsWith('.tmp')).sort() : [];
  return Object.fromEntries(files.map((f) => [f, fs.readFileSync(`${paths.sessionImages}/${f}`, 'utf8')]));
};

const imagesSubject = (make: () => Store = () => new Store(true)): Subject<Record<string, string>> => ({
  name: "a session's images",
  start: () => {
    fs.rmSync(paths.sessionImages, { recursive: true, force: true });
    const life = (): Running<Record<string, string>> => {
      const store = make();
      return {
        actions: () => Object.entries(IMAGES).map(([name, bytes]) => ({ name: `save image ${name}`, run: () => store.saveSessionImage(`${name}.png`, bytes) })),
        durable: savedImages,
        settle: () => Promise.resolve(),
        restart: () => life(),
      };
    };
    return life();
  },
});

/** Focus going down part way through saving image a: half its bytes written, by `store`'s own way of saving. */
function cutOffSave(store: Store): void {
  const write = fs.writeFileSync;
  const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, ...rest) => {
    write(file, Buffer.isBuffer(data) ? data.subarray(0, 3) : data, ...rest);
    throw new Error('Focus went down');
  });
  try {
    store.saveSessionImage('a.png', IMAGES.a);
  } catch {
    // as Focus going down leaves it
  } finally {
    spy.mockRestore();
  }
}

describe("a session's images, under Focus's two rules", () => {
  it('ends a restart as if a save had never started, or had finished', async () => {
    await checkRestart(imagesSubject(), { runs: 25 });
  });

  it('ends two saves at once as one after the other would', async () => {
    await checkAtOnce(imagesSubject(), { runs: 25 });
  });

  // docs/agents.md: "an image saved is read back whole after a restart, and one cut off as Focus went down is written
  // again the next time it comes"
  it('reads an image back whole after a restart, and writes one cut off as Focus went down again the next time', async () => {
    fs.rmSync(paths.sessionImages, { recursive: true, force: true });
    cutOffSave(new Store(true));
    expect(savedImages()).toEqual({});
    const after = new Store(true);
    after.saveSessionImage('a.png', IMAGES.a);
    after.saveSessionImage('b.png', IMAGES.b);
    expect(await new Store(true).readSessionImage('a.png')).toEqual(IMAGES.a);
    expect(savedImages()).toEqual({ 'a.png': 'first image', 'b.png': 'second image, a little longer' });
    // a store that keeps nothing on disk (a demo's) keeps them for as long as it runs
    const demo = new Store(false);
    demo.saveSessionImage('a.png', IMAGES.a);
    expect(await demo.readSessionImage('a.png')).toEqual(IMAGES.a);
  });

  it('catches a break with that promise: a store that writes an image straight to its name', async () => {
    class Straight extends Store {
      override saveSessionImage(file: string, bytes: Buffer): void {
        const full = `${paths.sessionImages}/${file}`;
        if (fs.existsSync(full)) return;
        fs.mkdirSync(paths.sessionImages, { recursive: true });
        fs.writeFileSync(full, bytes);
      }
    }
    fs.rmSync(paths.sessionImages, { recursive: true, force: true });
    cutOffSave(new Straight(true));
    new Straight(true).saveSessionImage('a.png', IMAGES.a);
    expect(savedImages()['a.png']).not.toBe('first image');
  });
});
