import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASH, withBash } from './agentShell';

const has = (...paths: string[]) => (p: string) => paths.includes(p);

describe('withBash', () => {
  it('runs a session’s Bash tool in bash, whatever the office’s own shell is', () => {
    expect(withBash({ SHELL: '/bin/zsh', PATH: '/usr/bin' }, 'darwin', has(BASH))).toEqual({ SHELL: '/bin/zsh', PATH: '/usr/bin', CLAUDE_CODE_SHELL: BASH });
    expect(withBash({ SHELL: '/bin/bash' }, 'linux', has(BASH)).CLAUDE_CODE_SHELL).toBe(BASH);
  });

  it('keeps a shell the captain chose', () => {
    expect(withBash({ CLAUDE_CODE_SHELL: '/opt/homebrew/bin/zsh' }, 'darwin', has(BASH)).CLAUDE_CODE_SHELL).toBe('/opt/homebrew/bin/zsh');
  });

  it('leaves Claude Code to pick when there’s no bash to give it, or on Windows (Git Bash already)', () => {
    expect(withBash({ SHELL: '/bin/zsh' }, 'darwin', has()).CLAUDE_CODE_SHELL).toBeUndefined();
    expect(withBash({}, 'win32', has(BASH)).CLAUDE_CODE_SHELL).toBeUndefined();
  });

  it('is a shell where an unmatched glob is passed on as it is, not an error that skips the command', () => {
    // zsh says "no matches found: --include=*.zzqq" and never runs grep: the commonest failed Bash call in the ledger
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-bash-'));
    fs.writeFileSync(path.join(dir, 'found.zzqq'), 'zzqq\n');
    const out = execFileSync(BASH, ['-c', 'grep -rl zzqq --include=*.zzqq .'], { cwd: dir, encoding: 'utf8' });
    expect(out).toContain('found.zzqq');
  });
});
