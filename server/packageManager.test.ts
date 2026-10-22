import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependenciesChanged, installable, installCommand, installFailedNote, installStamp, mergeCheckCommands, packageJsonScripts, packageManagerFor, packageScriptsIn, scriptCommand } from './packageManager';

describe('packageManagerFor', () => {
  it('follows the lockfile', () => {
    expect(packageManagerFor(['package.json', 'pnpm-lock.yaml'])).toBe('pnpm');
    expect(packageManagerFor(['package.json', 'yarn.lock'])).toBe('yarn');
    expect(packageManagerFor(['package.json', 'bun.lockb'])).toBe('bun');
    expect(packageManagerFor(['package.json', 'bun.lock'])).toBe('bun');
    expect(packageManagerFor(['package.json', 'package-lock.json'])).toBe('npm');
  });

  it('is npm without a lockfile', () => {
    expect(packageManagerFor(['package.json'])).toBe('npm');
    expect(packageManagerFor([])).toBe('npm');
  });

  it('prefers pnpm’s lockfile when a stale package-lock.json is left beside it', () => {
    expect(packageManagerFor(['package-lock.json', 'pnpm-lock.yaml'])).toBe('pnpm');
  });
});

describe('installCommand', () => {
  it('runs npm ci with a package-lock.json, as before, and npm install without one', () => {
    expect(installCommand('npm', ['package.json', 'package-lock.json'])).toEqual(['npm', 'ci', '--no-audit', '--no-fund']);
    expect(installCommand('npm', ['package.json'])).toEqual(['npm', 'install', '--no-audit', '--no-fund']);
  });

  it('installs from the lockfile without changing it for the others', () => {
    expect(installCommand('pnpm', ['pnpm-lock.yaml'])).toEqual(['pnpm', 'install', '--frozen-lockfile']);
    expect(installCommand('yarn', ['yarn.lock'])).toEqual(['yarn', 'install', '--frozen-lockfile']);
    expect(installCommand('bun', ['bun.lock'])).toEqual(['bun', 'install', '--frozen-lockfile']);
  });
});

describe('scriptCommand', () => {
  it('runs tests with the test shorthand and anything else with run', () => {
    expect(scriptCommand('npm', 'test')).toEqual(['npm', 'test']);
    expect(scriptCommand('pnpm', 'typecheck')).toEqual(['pnpm', 'run', 'typecheck']);
  });
});

describe('packageJsonScripts', () => {
  it('reads the scripts, and none from a missing, broken or scriptless package.json', () => {
    expect(packageJsonScripts('{"scripts":{"test":"vitest run"}}')).toEqual({ test: 'vitest run' });
    expect(packageJsonScripts(undefined)).toBeUndefined();
    expect(packageJsonScripts('{ not json')).toBeUndefined();
    expect(packageJsonScripts('{"name":"x"}')).toBeUndefined();
    expect(packageJsonScripts('null')).toBeUndefined();
    expect(packageJsonScripts('{"scripts":"vitest run"}')).toBeUndefined();
  });
});

describe('packageScriptsIn', () => {
  it('reads the scripts of the package.json in a folder, and none when there is none or it is no package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-package-'));
    expect(packageScriptsIn(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'package.json'), 'null');
    expect(packageScriptsIn(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'package.json'), '{"scripts":{"dev":"vite"}}');
    expect(packageScriptsIn(dir)).toEqual({ dev: 'vite' });
  });
});

describe('mergeCheckCommands', () => {
  const scripts = { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run', build: 'vite build' };

  it('runs the chosen scripts the repo has, with the package manager of its lockfile', () => {
    expect(mergeCheckCommands(scripts, ['pnpm-lock.yaml'])).toEqual([['pnpm', 'run', 'typecheck'], ['pnpm', 'run', 'lint'], ['pnpm', 'test']]);
    expect(mergeCheckCommands(scripts, [], ['build', 'e2e'])).toEqual([['npm', 'run', 'build']]);
  });

  it('runs none without a package.json', () => {
    expect(mergeCheckCommands(undefined, ['yarn.lock'])).toEqual([]);
  });
});

describe('dependenciesChanged', () => {
  it('is true when package.json or a lockfile changed', () => {
    expect(dependenciesChanged(['server/index.ts', 'package.json'])).toBe(true);
    expect(dependenciesChanged(['pnpm-lock.yaml'])).toBe(true);
    expect(dependenciesChanged(['package-lock.json'])).toBe(true);
  });

  it('is false for anything else, a package.json further down included', () => {
    expect(dependenciesChanged(['server/index.ts', 'docs/package.json'])).toBe(false);
    expect(dependenciesChanged([])).toBe(false);
  });
});

describe('installable', () => {
  it('needs a package.json and a lockfile to install exactly from', () => {
    expect(installable(['package.json', 'pnpm-lock.yaml'])).toBe(true);
    expect(installable(['package.json', 'package-lock.json', 'src'])).toBe(true);
    expect(installable(['package.json'])).toBe(false);
    expect(installable(['pnpm-lock.yaml'])).toBe(false);
  });
});

describe('installStamp', () => {
  const files = { 'package.json': '{"name":"app"}', 'pnpm-lock.yaml': 'lockfileVersion: 9' };

  it('is the same for the same files, whatever order they come in', () => {
    expect(installStamp('pnpm', files)).toBe(installStamp('pnpm', { 'pnpm-lock.yaml': files['pnpm-lock.yaml'], 'package.json': files['package.json'] }));
  });

  it('changes with any file, its name, or the package manager', () => {
    const stamp = installStamp('pnpm', files);
    expect(installStamp('pnpm', { ...files, 'pnpm-lock.yaml': 'lockfileVersion: 9\n' })).not.toBe(stamp);
    expect(installStamp('pnpm', { 'package.json': files['package.json'], 'yarn.lock': files['pnpm-lock.yaml'] })).not.toBe(stamp);
    expect(installStamp('npm', files)).not.toBe(stamp);
    // a name's end can't pass for the start of its contents
    expect(installStamp('npm', { a: 'bc' })).not.toBe(installStamp('npm', { ab: 'c' }));
  });
});

describe('installFailedNote', () => {
  it('says nothing when every install worked', () => {
    expect(installFailedNote([])).toBeUndefined();
  });

  it('names each folder, the command and why', () => {
    expect(installFailedNote([{ dir: '/w/a/e2e', command: 'npm ci', reason: 'ERESOLVE' }])).toBe(
      "Ops couldn't install the dependencies in your checkout, so the checks will fail until you do:\n- /w/a/e2e: `npm ci` failed: ERESOLVE",
    );
  });
});
