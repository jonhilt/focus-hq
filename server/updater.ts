import { ACTIVE_STATUSES, type Agent } from '../shared/types';
import { config } from './config';
import type { Hub } from './hub';
import { dependenciesChanged, installCommand, missingPackageManager, type PackageManager, packageManagerFor } from './packageManager';
import { settingsInForce } from './settings';
import type { Store } from './store';
import { errorMessage, run } from './util';

/**
 * What Focus sends server/supervise.ts, before it starts closing, to be started again. A message rather than an
 * exit code because how the process ends isn't entirely ours to decide: a native module can abort it on exit (onnxruntime
 * did on macOS, "mutex lock failed", before the crew's voices moved to a process of their own), and the restart must
 * survive that.
 */
export const RESTART_MESSAGE = 'restart';

const git = (args: string[]) => run('git', args, { cwd: config.root }).then((out) => out.trim());

/** The commit this Focus is running, shown to browsers so they reload when it changes. */
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

/** Why a check leaves the checkout as it is: nothing new, or a reason to tell the captain. */
export type UpdateHold = { kind: 'current' } | { kind: 'skipped' | 'waiting' | 'missing'; text: string };

/** What the captain hears while an update waits for busy agents, or undefined when none is busy. */
export function busyNote(agents: Iterable<Pick<Agent, 'status'>>): string | undefined {
  const busy = [...agents].filter((a) => a.status === 'queued' || ACTIVE_STATUSES.includes(a.status)).length;
  if (busy === 0) return undefined;
  return `A Focus update is ready. The ship restarts once ${busy === 1 ? 'the busy agent finishes' : `all ${busy} busy agents finish`}.`;
}

export interface UpdatePlan {
  /** The package manager the update's lockfile asks for. */
  pm: PackageManager;
  /** The install to run after merging, when the update changed the dependencies. */
  install?: string[];
  build: boolean;
}

/** What an update runs once merged, from the files at its commit (`lockfiles`) and the paths it changed. */
export function updatePlan(s: { lockfiles: string[]; changed: string[]; dev: boolean }): UpdatePlan {
  const pm = packageManagerFor(s.lockfiles);
  const install = dependenciesChanged(s.changed) ? (pm === 'npm' ? ['npm', 'install'] : installCommand(pm, s.lockfiles)) : undefined;
  // In dev mode Vite serves the client from source, so only a production Focus needs a fresh build.
  return { pm, ...(install && { install }), build: !s.dev };
}

/**
 * Keeps a running Focus on the latest code: when the Focus checkout's upstream branch (usually origin/main) moves,
 * fast-forward to it, reinstall and rebuild as needed, and restart. Waits until no agent is busy, because a restart
 * interrupts every running Claude session.
 */
export class Updater {
  private checking = false;
  /** The upstream commit each kind of hold was last told about. */
  private readonly toldAt = new Map<UpdateHold['kind'], string>();

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
    console.log(`  Auto update: following ${upstream}${settingsInForce(this.store.settings).autoUpdate === false ? ' (off in Settings for now)' : ''}`);
    setInterval(() => void this.check(), config.updateCheckMs).unref();
  }

  /** Only while the captain has it on (Settings, or FOCUS_AUTO_UPDATE=0 off), looked at afresh each time. */
  private async check(): Promise<void> {
    if (this.checking || settingsInForce(this.store.settings).autoUpdate === false) return;
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
    const held = await this.hold(target);
    if (held) return this.tellOnce(target, held);
    const plan = updatePlan({
      lockfiles: (await git(['ls-tree', '--name-only', target])).split('\n'),
      changed: (await git(['diff', '--name-only', 'HEAD', target])).split('\n'),
      dev: config.dev,
    });
    // found before merging, so a Focus without the package manager the update asks for stays as it is
    if (!(await canRun(plan))) return this.tellOnce(target, { kind: 'missing', text: `Focus now installs its dependencies with ${plan.pm}, but ${missingPackageManager(plan.pm)}` });
    await this.apply(target, plan);
  }

  /** Why this check leaves the checkout as it is, or undefined to update it to `target`. */
  private async hold(target: string): Promise<UpdateHold | undefined> {
    const behind = Number(await git(['rev-list', '--count', `HEAD..${target}`]));
    if (behind === 0) return { kind: 'current' };
    const ahead = Number(await git(['rev-list', '--count', `${target}..HEAD`]));
    const dirty = ahead === 0 && (await git(['status', '--porcelain', '--untracked-files=no'])) !== '';
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => 'its upstream');
    const skipped = updateBlocked({ ahead, behind, dirty, upstream });
    if (skipped) return { kind: 'skipped', text: skipped };
    const waiting = busyNote(this.store.agents.values());
    return waiting === undefined ? undefined : { kind: 'waiting', text: waiting };
  }

  /**
   * Tells the captain why the checkout stays as it is, once per upstream commit rather than every check: it stays that
   * way until they sort it out (or the agents finish). A missing package manager is thrown, so it shows as a failure.
   */
  private tellOnce(target: string, held: UpdateHold): void {
    if (held.kind === 'current' || this.toldAt.get(held.kind) === target) return;
    this.toldAt.set(held.kind, target);
    if (held.kind === 'missing') throw new Error(held.text);
    if (held.kind === 'skipped') console.warn(`  ⚠ ${held.text}`);
    this.hub.toast('info', held.text);
  }

  private async apply(target: string, plan: UpdatePlan): Promise<void> {
    const subject = await git(['log', '-1', '--format=%s', target]);
    console.log(`\n  ⬇ Updating Focus to ${target.slice(0, 7)}: ${subject}`);
    this.hub.toast('info', `Updating Focus: ${subject}. Back in a moment…`);

    await git(['merge', '--ff-only', '--quiet', target]);
    if (plan.install) {
      const [cmd, ...args] = plan.install;
      await run(cmd, args, { cwd: config.root, timeoutMs: 10 * 60_000 });
    }
    if (plan.build) await run(plan.pm, ['run', 'build'], { cwd: config.root, timeoutMs: 10 * 60_000 });

    await this.restart();
  }
}

/** Whether the package manager an update needs is on the PATH; one that neither installs nor builds needs none. */
async function canRun(plan: UpdatePlan): Promise<boolean> {
  if (!plan.install && !plan.build) return true;
  return run(plan.pm, ['--version'], { cwd: config.root }).then(() => true, () => false);
}
