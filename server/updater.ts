import { ACTIVE_STATUSES } from '../shared/types';
import { config } from './config';
import type { Hub } from './hub';
import { dependenciesChanged, installCommand, missingPackageManager, packageManagerFor } from './packageManager';
import type { Store } from './store';
import { errorMessage, run } from './util';

/**
 * What the office sends server/supervise.ts, before it starts closing, to be started again. A message rather than an
 * exit code because how the process ends isn't entirely ours to decide: a native module can abort it on exit (onnxruntime
 * did on macOS, "mutex lock failed", before the crew's voices moved to a process of their own), and the restart must
 * survive that.
 */
export const RESTART_MESSAGE = 'restart';

const git = (args: string[]) => run('git', args, { cwd: config.root }).then((out) => out.trim());

/** The commit this office is running, shown to browsers so they reload when it changes. */
export async function currentVersion(): Promise<string> {
  return git(['rev-parse', '--short', 'HEAD']).catch(() => 'unknown');
}

/**
 * Why the checkout can't be fast-forwarded to its upstream, and what to do about it, or null when it can. `ahead` and
 * `behind` count commits against the upstream; `dirty` is uncommitted changes to tracked files.
 */
export function updateBlocked(s: { ahead: number; behind: number; dirty: boolean; upstream: string }): string | null {
  const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
  if (s.ahead > 0) {
    return `Auto update skipped: this checkout has ${commits(s.ahead)} that ${s.upstream} doesn't (and is ${commits(s.behind)} behind it), so it can't fast-forward. ` +
      `Push them or rebase them onto ${s.upstream} (git pull --rebase), and the next check updates it.`;
  }
  if (s.dirty) return `Auto update skipped: this checkout has uncommitted changes. Commit or stash them, and the next check updates it to ${s.upstream}.`;
  return null;
}

/**
 * Keeps a running office on the latest code: when the Focus checkout's upstream branch (usually origin/main) moves,
 * fast-forward to it, reinstall and rebuild as needed, and restart. Waits until no agent is busy, because a restart
 * interrupts every running Claude session.
 */
export class Updater {
  private checking = false;
  private waitingToldAt: string | null = null;
  private missingToldAt: string | null = null;
  private skippedToldAt: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly restart: () => Promise<void>,
  ) {}

  async start(): Promise<void> {
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '');
    if (!upstream) {
      console.log('  Auto update: off (this checkout has no upstream branch to follow)');
      return;
    }
    console.log(`  Auto update: following ${upstream}`);
    setInterval(() => void this.check(), config.updateCheckMs).unref();
  }

  private async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.tryUpdate();
    } catch (err) {
      console.warn(`  ⚠ Auto update failed: ${errorMessage(err)}`);
      this.hub.toast('error', `Focus auto update failed: ${errorMessage(err)}`);
    } finally {
      this.checking = false;
    }
  }

  private async tryUpdate(): Promise<void> {
    await git(['fetch', '--quiet']);
    const target = await git(['rev-parse', '@{u}']);
    const behind = Number(await git(['rev-list', '--count', `HEAD..${target}`]));
    if (behind === 0) return;

    const ahead = Number(await git(['rev-list', '--count', `${target}..HEAD`]));
    const dirty = ahead === 0 && (await git(['status', '--porcelain', '--untracked-files=no'])) !== '';
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => 'its upstream');
    const skipped = updateBlocked({ ahead, behind, dirty, upstream });
    if (skipped) {
      // Once per upstream commit rather than every check: the checkout stays as it is until the captain sorts it out.
      if (this.skippedToldAt === target) return;
      this.skippedToldAt = target;
      console.warn(`  ⚠ ${skipped}`);
      this.hub.toast('info', skipped);
      return;
    }

    const busy = [...this.store.agents.values()].filter((a) => a.status === 'queued' || ACTIVE_STATUSES.includes(a.status));
    if (busy.length > 0) {
      if (this.waitingToldAt !== target) {
        this.waitingToldAt = target;
        this.hub.toast('info', `A Focus update is ready. The ship restarts once ${busy.length === 1 ? 'the busy agent finishes' : `all ${busy.length} busy agents finish`}.`);
      }
      return;
    }

    // The package manager the update's lockfile asks for, found before merging, so an office without it stays as it is.
    const lockfiles = (await git(['ls-tree', '--name-only', target])).split('\n');
    const pm = packageManagerFor(lockfiles);
    const install = dependenciesChanged((await git(['diff', '--name-only', 'HEAD', target])).split('\n'));
    // In dev mode Vite serves the client from source, so only a production office needs a fresh build.
    const build = !config.dev;
    if ((install || build) && !(await run(pm, ['--version'], { cwd: config.root }).then(() => true, () => false))) {
      if (this.missingToldAt === target) return;
      this.missingToldAt = target;
      throw new Error(`Focus now installs its dependencies with ${pm}, but ${missingPackageManager(pm)}`);
    }

    const subject = await git(['log', '-1', '--format=%s', target]);
    console.log(`\n  ⬇ Updating Focus to ${target.slice(0, 7)}: ${subject}`);
    this.hub.toast('info', `Updating Focus: ${subject}. Back in a moment…`);

    await git(['merge', '--ff-only', '--quiet', target]);
    if (install) {
      const [cmd, ...args] = pm === 'npm' ? ['npm', 'install'] : installCommand(pm, lockfiles);
      await run(cmd, args, { cwd: config.root, timeoutMs: 10 * 60_000 });
    }
    if (build) await run(pm, ['run', 'build'], { cwd: config.root, timeoutMs: 10 * 60_000 });

    await this.restart();
  }
}
