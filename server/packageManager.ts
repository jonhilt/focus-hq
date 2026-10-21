import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mergeCheckScripts } from '../shared/mergeCheck';
import { isRecord } from '../shared/records';

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

/** Whether Ops installs a folder's dependencies: it has a package.json and a lockfile to install exactly from. */
export function installable(files: Iterable<string>): boolean {
  const names = new Set(files);
  return names.has('package.json') && LOCKFILES.some(([lockfile]) => names.has(lockfile));
}

/** Where Ops notes what it last installed in a folder: inside node_modules, so deleting them forgets it too. */
export const INSTALL_STAMP = path.join('node_modules', '.focus-install');

/**
 * What an install depends on, as one hash: the package manager and the contents of `files` (package.json and the
 * lockfiles, by name). The same stamp as the one left by the last install means there's nothing to install.
 */
export function installStamp(pm: PackageManager, files: Record<string, string>): string {
  const hash = createHash('sha256').update(pm);
  for (const name of Object.keys(files).sort()) hash.update(`\0${name}\0${files[name]}`);
  return hash.digest('hex');
}

/** What the agent hears when Ops couldn't install the dependencies in a folder of their checkout. */
export function installFailedNote(failures: { dir: string; command: string; reason: string }[]): string | undefined {
  if (!failures.length) return undefined;
  const each = failures.map((f) => `- ${f.dir}: \`${f.command}\` failed: ${f.reason}`);
  return `Ops couldn't install the dependencies in your checkout, so the checks will fail until you do:\n${each.join('\n')}`;
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

/** What a checkout's root says about its checks: whether it has a package.json, its scripts, its lockfiles and a CLAUDE.md. */
export interface PackageFacts {
  packageJson: boolean;
  scripts?: Record<string, unknown>;
  lockfiles: string[];
  claudeMd: boolean;
}

/** The scripts of a package.json's text `pkg`: none when there's no file, it doesn't parse, or it has no scripts. */
export function packageJsonScripts(pkg: string | undefined): Record<string, unknown> | undefined {
  if (pkg === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(pkg);
    return isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The commands of the merge check (`mergeCheckScripts`, from the project's `chosen` scripts) for a repo with these
 * package.json `scripts` and `lockfiles`, run with its package manager. QA is told to run the same ones.
 */
export function mergeCheckCommands(scripts: Record<string, unknown> | undefined, lockfiles: Iterable<string>, chosen?: readonly string[]): string[][] {
  const pm = packageManagerFor(lockfiles);
  return mergeCheckScripts(scripts, chosen).map((name) => scriptCommand(pm, name));
}
