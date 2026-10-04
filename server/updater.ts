import { ACTIVE_STATUSES } from '../shared/types';
import { config } from './config';
import type { Hub } from './hub';
import type { Store } from './store';
import { errorMessage, run } from './util';

/** Exit code that tells server/supervise.ts to start the office again (EX_TEMPFAIL). */
export const RESTART_EXIT_CODE = 75;

const git = (args: string[]) => run('git', args, { cwd: config.root }).then((out) => out.trim());

/** The commit this office is running, shown to browsers so they reload when it changes. */
export async function currentVersion(): Promise<string> {
  return git(['rev-parse', '--short', 'HEAD']).catch(() => 'unknown');
}

/**
 * Keeps a running office on the latest code: when the Focus checkout's upstream branch (usually origin/main) moves,
 * fast-forward to it, reinstall and rebuild as needed, and restart. Waits until no agent is busy, because a restart
 * interrupts every running Claude session.
 */
export class Updater {
  private checking = false;
  private waitingToldAt: string | null = null;

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
    if (ahead > 0) return console.warn('  ⚠ Auto update skipped: this checkout has local commits, so it cannot fast-forward');
    if (await git(['status', '--porcelain', '--untracked-files=no'])) {
      return console.warn('  ⚠ Auto update skipped: this checkout has uncommitted changes');
    }

    const busy = [...this.store.agents.values()].filter((a) => a.status === 'queued' || ACTIVE_STATUSES.includes(a.status));
    if (busy.length > 0) {
      if (this.waitingToldAt !== target) {
        this.waitingToldAt = target;
        this.hub.toast('info', `A Focus update is ready. The office restarts once ${busy.length === 1 ? 'the busy agent finishes' : `all ${busy.length} busy agents finish`}.`);
      }
      return;
    }

    const from = await git(['rev-parse', 'HEAD']);
    const subject = await git(['log', '-1', '--format=%s', target]);
    console.log(`\n  ⬇ Updating Focus to ${target.slice(0, 7)}: ${subject}`);
    this.hub.toast('info', `Updating Focus: ${subject}. Back in a moment…`);

    await git(['merge', '--ff-only', '--quiet', target]);
    const changed = (await git(['diff', '--name-only', from, target])).split('\n');
    if (changed.some((f) => f === 'package.json' || f === 'package-lock.json')) await run('npm', ['install'], { cwd: config.root, timeoutMs: 10 * 60_000 });
    // In dev mode Vite serves the client from source, so only a production office needs a fresh build.
    if (!config.dev) await run('npm', ['run', 'build'], { cwd: config.root, timeoutMs: 10 * 60_000 });

    await this.restart();
  }
}
