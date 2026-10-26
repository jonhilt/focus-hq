import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installFailedNote, installStamp, mergeCheckCommands, packageJsonScripts, packageScriptsIn } from './packageManager';

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
