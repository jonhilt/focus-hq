import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WAIT_BIN, WAIT_RULE, withWaitHelper } from './wait';

interface Result { code: number; stdout: string; stderr: string }

/** Runs `focus-wait` as a session would: found on the PATH the office gives it. */
function focusWait(args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve) => {
    const env = withWaitHelper({ PATH: process.env.PATH });
    execFile('focus-wait', args, { cwd, env }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'focus-wait-'));

describe('focus-wait', () => {
  it('returns as soon as the condition turns true, with what it said', async () => {
    const dir = tmp();
    // true on the third try: each try counts itself in a file
    const until = 'n=$(cat tries 2>/dev/null || echo 0); n=$((n+1)); echo $n > tries; echo "try $n"; [ $n -ge 3 ]';
    const res = await focusWait(['--until', until, '--timeout', '20', '--every', '0.1'], dir);
    expect(res.code).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'tries'), 'utf8').trim()).toBe('3');
    expect(res.stdout).toContain('try 3');
  });

  it('gives up after the timeout, non-zero, with the last output', async () => {
    const dir = tmp();
    const res = await focusWait(['--until', 'echo not yet; false', '--timeout', '1', '--every', '0.2'], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('still not true after');
    expect(res.stderr).toContain('not yet');
  });

  it('does what a blocked `sleep N; cmd` meant: waits, then runs the check, in one call', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'server.log'), 'starting…\n');
    setTimeout(() => fs.appendFileSync(path.join(dir, 'server.log'), 'Listening on 4477\n'), 300);
    const res = await focusWait(['--until', 'grep -q Listening server.log && tail -1 server.log', '--timeout', '20', '--every', '0.1'], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Listening on 4477');
  });

  it('says how to use it when the condition is missing', async () => {
    const res = await focusWait(['--timeout', '5'], tmp());
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('usage: focus-wait --until');
  });
});

describe('withWaitHelper', () => {
  it('puts the office’s bin first on the PATH, and keeps the rest', () => {
    expect(withWaitHelper({ PATH: '/usr/bin', HOME: '/h' })).toEqual({ PATH: `${WAIT_BIN}${path.delimiter}/usr/bin`, HOME: '/h' });
    expect(withWaitHelper({}).PATH).toBe(WAIT_BIN);
  });

  it('tells sessions to wait with it rather than sleep', () => {
    expect(WAIT_RULE).toContain('focus-wait --until');
    expect(WAIT_RULE).toContain('sleep');
  });
});
