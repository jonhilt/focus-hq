import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mergeCheckScripts } from '../shared/mergeCheckRules';
import { isRecord } from '../shared/records';
import { LOCKFILES, type PackageManager, packageManagerFor, scriptCommand } from './packageManagerRules';

// A Node project's package manager and scripts as its folder shows them (`lockfilesIn`, `packageManagerIn`,
// `packageScriptsIn` look at the disk), and what Ops runs from them. Which manager and command, and whether to
// install, are decided in packageManagerRules.ts.

export { dependenciesChanged, installable, installCommand, LOCKFILES, type PackageManager, packageManagerFor, scriptCommand } from './packageManagerRules';

/** The lockfiles in `dir`. */
export function lockfilesIn(dir: string): string[] {
  return LOCKFILES.map(([file]) => file).filter((file) => fs.existsSync(path.join(dir, file)));
}

/** The package manager the project in `dir` uses. */
export function packageManagerIn(dir: string): PackageManager {
  return packageManagerFor(lockfilesIn(dir));
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

/** What to tell someone whose PATH has no `pm`: corepack (which comes with Node) provides pnpm and yarn. */
export function missingPackageManager(pm: PackageManager): string {
  const how = pm === 'bun' ? 'install bun (https://bun.sh)' : 'run `corepack enable` (or `npm install -g ' + pm + '`)';
  return `${pm} isn't on the PATH: ${how}, and Focus picks it up on its next check`;
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

/** The scripts of the package.json in `dir`, read as `packageJsonScripts` reads them: none when it can't be read. */
export function packageScriptsIn(dir: string): Record<string, unknown> | undefined {
  try {
    return packageJsonScripts(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
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
