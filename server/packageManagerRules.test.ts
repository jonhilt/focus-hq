import { describe, expect, it } from 'vitest';
import { dependenciesChanged, installable, installCommand, packageManagerFor, scriptCommand } from './packageManagerRules';

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
