// Which package manager a Node project uses, told by its lockfile, the commands to install and run its scripts with
// it, and whether a folder or a change needs an install. Pure, so it's unit tested (packageManagerRules.test.ts);
// packageManager.ts looks at the disk.

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

/**
 * Installs exactly what the lockfile says, without changing it: `npm ci` with a package-lock.json (plain `npm install`
 * without one), and the frozen-lockfile install of pnpm, yarn and bun.
 */
export function installCommand(pm: PackageManager, files: Iterable<string>): string[] {
  if (pm === 'npm') return ['npm', new Set(files).has('package-lock.json') ? 'ci' : 'install', '--no-audit', '--no-fund'];
  return [pm, 'install', '--frozen-lockfile'];
}

/** Whether Ops installs a folder's dependencies: it has a package.json and a lockfile to install exactly from. */
export function installable(files: Iterable<string>): boolean {
  const names = new Set(files);
  return names.has('package.json') && LOCKFILES.some(([lockfile]) => names.has(lockfile));
}

/** Whether a change to the files `changed` (paths from the project's root) needs the dependencies installed again. */
export function dependenciesChanged(changed: Iterable<string>): boolean {
  return [...changed].some((file) => file === 'package.json' || LOCKFILES.some(([lockfile]) => lockfile === file));
}

/** Runs the package.json script `name`: `npm test`, `pnpm run lint`… */
export function scriptCommand(pm: PackageManager, name: string): string[] {
  return name === 'test' ? [pm, 'test'] : [pm, 'run', name];
}
