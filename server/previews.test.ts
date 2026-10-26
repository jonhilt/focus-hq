import { Clock, Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewConfig, ServerEvent } from '../shared/types';
import { demoLayer } from './github/demo';
import { toProvider } from './github/service';
import { Hub } from './hub';
import { type ExitStatus, PreviewMachine } from './previewMachine';
import { Previews } from './previews';

/** How a fake command behaves: what it prints, and when (if ever) it exits on its own. */
interface Behaviour {
  lines?: string[];
  /** Milliseconds after it's awaited; never exits by itself without it. */
  exitAfter?: number;
  code?: number;
  /** Shrugs off SIGTERM, so only SIGKILL takes it down. */
  stubborn?: boolean;
}

class RecordingHub extends Hub {
  events: ServerEvent[] = [];
  override send(event: ServerEvent): void {
    this.events.push(event);
  }
}

/** A machine that runs nothing: commands behave as `behave` says, and URLs in `answering` answer 200. */
function fakeMachine(behave: (command: string) => Behaviour) {
  const answering = new Set<string>();
  const alive = new Set<number>();
  /** What happened, in order: "spawn <command>", "<signal> <command>", "exit <command>". */
  const events: { at: number; what: string }[] = [];
  const commands = new Map<number, string>();
  const kills = new Map<number, Deferred.Deferred<ExitStatus>>();
  let nextPid = 100;
  const record = (what: string) => Clock.currentTimeMillis.pipe(Effect.map((at) => void events.push({ at, what })));

  const layer = Layer.succeed(PreviewMachine, PreviewMachine.of({
    spawn: (command, options) =>
      Effect.gen(function* () {
        const pid = nextPid++;
        const behaviour = behave(command);
        const killed = Deferred.makeUnsafe<ExitStatus>();
        alive.add(pid);
        commands.set(pid, command);
        kills.set(pid, killed);
        yield* record(`spawn ${command}`);
        for (const line of behaviour.lines ?? []) options.onStdout(Buffer.from(`${line}\n`));
        const byItself = behaviour.exitAfter === undefined
          ? Effect.never
          : Effect.sleep(behaviour.exitAfter).pipe(Effect.as<ExitStatus>({ code: behaviour.code ?? 0, signal: null }));
        const exited = Effect.raceFirst(byItself, Deferred.await(killed)).pipe(
          Effect.tap(() => Effect.sync(() => alive.delete(pid))),
          Effect.tap(() => record(`exit ${command}`)),
        );
        return { pid, exited };
      }),
    signal: (pid, signal) =>
      Effect.gen(function* () {
        if (signal === 0) return alive.has(pid);
        yield* record(`${signal} ${commands.get(pid)}`);
        if (!alive.has(pid)) return false;
        if (signal === 'SIGKILL' || !behave(commands.get(pid)!).stubborn) {
          alive.delete(pid);
          Deferred.doneUnsafe(kills.get(pid)!, Effect.succeed({ code: null, signal }));
        }
        return true;
      }),
    probe: (url) => Effect.succeed(answering.has(url) ? 200 : null),
    freePort: Effect.succeed(4100),
    checkout: (_repo, dir) => Effect.succeed({ sha: 'abc1234def567', path: dir }),
  }));
  return { layer, answering, alive, events, what: () => events.map((e) => e.what) };
}

const runtimes: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});

function setup(behave: (command: string) => Behaviour) {
  const machine = fakeMachine(behave);
  const runtime = ManagedRuntime.make(Layer.merge(machine.layer, TestClock.layer()));
  runtimes.push(runtime);
  const hub = new RecordingHub();
  const previews = new Previews(hub, toProvider(demoLayer), false, runtime);
  /** Moves the clock on, letting every fiber that wakes up run. */
  const wait = (ms: number) => runtime.runPromise(TestClock.adjust(ms));
  const start = (projectId: string, config: PreviewConfig) =>
    previews.start({ projectId, repos: ['demo/space-dodger'], repo: 'demo/space-dodger', number: 12, title: 'Save for later', set: {}, config });
  const preview = (projectId: string) => previews.list().find((p) => p.projectId === projectId);
  const logLines = () => hub.events.flatMap((e) => (e.type === 'preview-log' ? e.log.lines : []));
  return { machine, previews, hub, wait, start, preview, logLines };
}

const devServer: PreviewConfig = { command: 'npm run dev -- --port {port}' };

describe('Previews', () => {
  it('starts a preview and marks it running once the URL it printed answers', async () => {
    const t = setup(() => ({ lines: ['  ➜  Local:   http://localhost:4100/'] }));
    t.machine.answering.add('http://localhost:4100/');
    await t.start('p1', devServer);
    await t.wait(1000);

    expect(t.preview('p1')).toMatchObject({
      status: 'running',
      command: 'npm run dev -- --port 4100',
      activity: 'Up at http://localhost:4100/',
      links: [{ url: 'http://localhost:4100/', health: 'up', code: 200 }],
      sha: 'abc1234def567',
    });
    expect(t.previews.log('p1').lines).toContain('✔ http://localhost:4100/ is answering');
    expect(t.machine.what()).toEqual(['spawn npm run dev -- --port 4100']);
  });

  it('fails the preview when the start command exits before a site answers, and shows why', async () => {
    const t = setup(() => ({ lines: ['Error: Cannot find module vite'], exitAfter: 300, code: 1 }));
    await t.start('p1', devServer);
    await t.wait(1000);

    expect(t.preview('p1')).toMatchObject({ status: 'failed', error: 'The command exited with code 1', activity: 'The command exited with code 1' });
    expect(t.previews.log('p1').lines.slice(-2)).toEqual(['Error: Cannot find module vite', '✘ The command exited with code 1']);
    // the scope closed: what's left of the tree is signalled, and nothing is
    expect(t.machine.what()).toEqual(['spawn npm run dev -- --port 4100', 'exit npm run dev -- --port 4100', 'SIGTERM npm run dev -- --port 4100']);
    expect(t.machine.alive.size).toBe(0);
  });

  it('runs the stop command, then kills the start command’s tree, with SIGKILL after the grace period', async () => {
    const t = setup((command) => (command === 'stack down' ? { lines: ['stack is down'], exitAfter: 2000 } : { stubborn: true, lines: ['http://localhost:4100/'] }));
    t.machine.answering.add('http://localhost:4100/');
    await t.start('p1', { command: 'stack up', stopCommand: 'stack down' });
    await t.wait(1000);
    expect(t.preview('p1')?.status).toBe('running');

    const stopped = t.previews.stop('p1');
    expect(t.preview('p1')?.status).toBe('stopping');
    await t.wait(2000); // the stop command exits
    await t.wait(5000); // the start command ignores SIGTERM for the whole grace period
    await stopped;

    const events = t.machine.events.filter((e) => e.what !== 'spawn stack up');
    expect(events.map((e) => e.what)).toEqual(['spawn stack down', 'exit stack down', 'SIGTERM stack up', 'SIGKILL stack up', 'exit stack up']);
    const at = (what: string) => events.find((e) => e.what === what)!.at;
    expect(at('SIGKILL stack up') - at('SIGTERM stack up')).toBe(5000);
    expect(t.logLines()).toEqual(expect.arrayContaining(['$ stack down', 'stack is down']));
    expect(t.previews.list()).toEqual([]);
    expect(t.hub.events.at(-1)).toEqual({ type: 'preview', projectId: 'p1', preview: null });
    expect(t.machine.alive.size).toBe(0);
  });

  it('kills a stop command that hangs, says so in the log, and still takes the tree down', async () => {
    const t = setup((command) => (command === 'stack down' ? {} : { lines: ['http://localhost:4100/'] }));
    t.machine.answering.add('http://localhost:4100/');
    await t.start('p1', { command: 'stack up', stopCommand: 'stack down' });
    await t.wait(1000);

    let done = false;
    const stopped = t.previews.stop('p1').then(() => (done = true));
    await t.wait(5 * 60_000 - 1);
    expect(done).toBe(false);
    await t.wait(1);
    await stopped;

    // nobody waits for the stop command's exit any more once it has timed out
    expect(t.machine.what().slice(1)).toEqual(['spawn stack down', 'SIGTERM stack down', 'SIGTERM stack up', 'exit stack up']);
    expect(t.logLines()).toContain('⚠ The stop command timed out after 5 minutes');
    expect(t.machine.alive.size).toBe(0);
  });

  it('shutdown() stops every running preview', async () => {
    const t = setup(() => ({ lines: ['http://localhost:4100/'] }));
    t.machine.answering.add('http://localhost:4100/');
    await t.start('p1', devServer);
    await t.start('p2', devServer);
    await t.wait(1000);
    expect(t.previews.list().map((p) => p.status)).toEqual(['running', 'running']);

    await t.previews.shutdown();

    expect(t.previews.list()).toEqual([]);
    expect(t.machine.what().filter((w) => w.startsWith('SIGTERM'))).toHaveLength(2);
    expect(t.machine.alive.size).toBe(0);
  });

  describe('once it is running', () => {
    const url = 'http://localhost:4100/';
    /** Moves the clock on a second at a time: each check the watch forks only sleeps once the one before has run. */
    const pass = async (t: ReturnType<typeof setup>, ms: number) => {
      for (let waited = 0; waited < ms; waited += 1000) await t.wait(1000);
    };

    it('shows a site that stops answering, and fails the preview after three checks once its command has gone', async () => {
      const t = setup(() => ({ lines: [url], exitAfter: 2000 }));
      t.machine.answering.add(url);
      await t.start('p1', devServer);
      await pass(t, 3000);
      expect(t.preview('p1')?.status).toBe('running');
      expect(t.previews.log('p1').lines).toContain('▸ The command finished; the sites keep running on their own');

      t.machine.answering.delete(url);
      await pass(t, 10_000);
      expect(t.preview('p1')).toMatchObject({ status: 'running', links: [{ url, health: 'down' }] });
      await pass(t, 10_000);
      expect(t.preview('p1')?.status).toBe('running');
      await pass(t, 10_000);
      expect(t.preview('p1')).toMatchObject({ status: 'failed', error: 'The site stopped answering' });
      expect(t.previews.log('p1').lines.at(-1)).toBe('✘ The site stopped answering');
    });

    it('follows the stack’s own status in its warning, and fails the preview once the stack leaves the list', async () => {
      // the progress command lists every stack; ours is the one naming our checkout
      let stacks = (dir: string): Record<string, string>[] => [{ dir, status: 'ready' }];
      const t = setup((command) => {
        if (!command.startsWith('stack status ')) return { lines: [url] };
        const dir = command.slice('stack status '.length).replace(/^'|'$/g, '');
        return { lines: [JSON.stringify({ sessions: stacks(dir) })], exitAfter: 100 };
      });
      t.machine.answering.add(url);
      await t.start('p1', { command: 'stack up', statusCommand: 'stack status {dir}' });
      await t.wait(1000);
      expect(t.preview('p1')?.status).toBe('running');
      expect(t.preview('p1')?.warning).toBeUndefined();

      stacks = (dir) => [{ dir, status: 'unhealthy', error: 'the database is down' }];
      await pass(t, 10_000);
      expect(t.preview('p1')).toMatchObject({ status: 'running', warning: 'The stack reports itself as unhealthy: the database is down' });

      stacks = (dir) => [{ dir, status: 'ready' }];
      await pass(t, 10_000);
      expect(t.preview('p1')?.warning).toBeUndefined();

      stacks = () => [{ dir: '/somewhere/else', status: 'ready' }];
      await pass(t, 20_000);
      expect(t.preview('p1')).toMatchObject({ status: 'failed', error: 'The stack went away: it is no longer in the progress command’s list' });
    });
  });
});
