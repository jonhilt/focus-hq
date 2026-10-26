import { ACTIVE_STATUSES, type Agent } from '../shared/types';
import { dependenciesChanged, installCommand, type PackageManager, packageManagerFor } from './packageManagerRules';

// Whether an auto update may fast-forward the checkout, what the captain hears while it waits for busy agents, and what
// it runs once merged. Pure, so it's unit tested (updaterRules.test.ts); updater.ts asks git and does the update.

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
