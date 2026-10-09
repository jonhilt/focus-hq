import fs from 'node:fs';
import path from 'node:path';

// Which package manager a Node project uses, told by its lockfile, and the commands to install and run its scripts with
// it. Pure, so it's unit tested (packageManager.test.ts); `lockfilesIn` and `packageManagerIn` look at the disk.

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** Each package manager's lockfile, in the order they're looked for. */
export const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** The package manager whose lockfile is among `files` (names in the project's folder); npm when there's none. */
export function packageManagerFor(files: Iterable<string>): PackageManager {
  const names = new Set(files);
  return LOCKFILES.find(([file]) => names.has(file))?.[1] ?? 'npm';
}

/** The lockfiles in `dir`. */
export function lockfilesIn(dir: string): string[] {
  return LOCKFILES.map(([file]) => file).filter((file) => fs.existsSync(path.join(dir, file)));
}

/** The package manager the project in `dir` uses. */
export function packageManagerIn(dir: string): PackageManager {
  return packageManagerFor(lockfilesIn(dir));
}

/**
 * Installs exactly what the lockfile says, without changing it: `npm ci` with a package-lock.json (plain `npm install`
 * without one), and the frozen-lockfile install of pnpm, yarn and bun.
 */
export function installCommand(pm: PackageManager, files: Iterable<string>): string[] {
  if (pm === 'npm') return ['npm', new Set(files).has('package-lock.json') ? 'ci' : 'install', '--no-audit', '--no-fund'];
  return [pm, 'install', '--frozen-lockfile'];
}

/** Whether a change to the files `changed` (paths from the project's root) needs the dependencies installed again. */
export function dependenciesChanged(changed: Iterable<string>): boolean {
  return [...changed].some((file) => file === 'package.json' || LOCKFILES.some(([lockfile]) => lockfile === file));
}

/** What to tell someone whose PATH has no `pm`: corepack (which comes with Node) provides pnpm and yarn. */
export function missingPackageManager(pm: PackageManager): string {
  const how = pm === 'bun' ? 'install bun (https://bun.sh)' : 'run `corepack enable` (or `npm install -g ' + pm + '`)';
  return `${pm} isn't on the PATH: ${how}, and Focus picks it up on its next check`;
}

/** Runs the package.json script `name`: `npm test`, `pnpm run lint`… */
export function scriptCommand(pm: PackageManager, name: string): string[] {
  return name === 'test' ? [pm, 'test'] : [pm, 'run', name];
}
