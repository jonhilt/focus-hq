import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dcgConfig, openScratch, scratchDir, scratchScript } from './scratch';
import { SCRATCH_RM } from './scratchRules';

describe('scratchScript', () => {
  const dir = '/tmp/focus-scratch/lead_x';
  it('spots a script run from the scratch dir, however it is run', () => {
    expect(scratchScript('node "$FOCUS_SCRATCH/probe.mjs"', dir)).toBe('probe.mjs');
    expect(scratchScript('npx tsx $FOCUS_SCRATCH/render.ts', dir)).toBe('render.ts');
    expect(scratchScript('cd /repo && pnpm exec tsx "${FOCUS_SCRATCH}/w1.ts" 2>&1 | tail -5', dir)).toBe('w1.ts');
    expect(scratchScript(`python3 ${dir}/rates.py --all`, dir)).toBe('rates.py');
    expect(scratchScript('FOO=1 bash "$FOCUS_SCRATCH/sweep.sh"', dir)).toBe('sweep.sh');
    expect(scratchScript('cd "$FOCUS_SCRATCH" && python3 check.py', dir)).toBe('check.py');
    expect(scratchScript('"$FOCUS_SCRATCH/run.sh"', dir)).toBe('run.sh');
    expect(scratchScript('npx vitest run $FOCUS_SCRATCH/dbg.test.ts', dir)).toBe('dbg.test.ts');
  });

  it('leaves alone writing, listing and removing scratch files, and scripts from anywhere else', () => {
    expect(scratchScript(`cat > "$FOCUS_SCRATCH/render.ts" <<'EOF'\nnode "$FOCUS_SCRATCH/other.js"\nEOF`, dir)).toBeUndefined();
    expect(scratchScript('ls "$FOCUS_SCRATCH"', dir)).toBeUndefined();
    expect(scratchScript('wc -c "$FOCUS_SCRATCH/compare.html"', dir)).toBeUndefined();
    expect(scratchScript('node scripts/build.mjs', dir)).toBeUndefined();
    expect(scratchScript(`python3 - <<'EOF'\nimport os\nEOF`, dir)).toBeUndefined();
  });

  it('finds the script after a heredoc that wrote it', () => {
    expect(scratchScript(`cat > "$FOCUS_SCRATCH/a.ts" <<'EOF'\nconsole.log(1)\nEOF\nnpx tsx "$FOCUS_SCRATCH/a.ts"`, dir)).toBe('a.ts');
  });
});

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-scratch-test-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('dcgConfig', () => {
  it('allows exactly the scratch rm Ops checks', () => {
    const config = dcgConfig();
    expect(config).toContain(`allow = [ '''${SCRATCH_RM}''' ]`);
    // TOML literal strings: nothing in them may close one early
    for (const m of config.matchAll(/'''([\s\S]*?)'''/g)) expect(m[1]).not.toContain("'''");
  });

  it('names a safe way to undo a file instead of git stash', () => {
    const blocks = dcgConfig().split('\n').filter((l) => l.includes('reason ='));
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b).toContain('git apply -R "$FOCUS_SCRATCH/undo.patch"');
  });

  it('only blocks git as a command, the way dcg does', () => {
    const patterns = [...dcgConfig().matchAll(/pattern = '''(.*?)'''/g)].map((m) => new RegExp(m[1]));
    const blocked = (command: string) => patterns.some((p) => p.test(command));
    for (const command of ['git checkout -- a.ts', 'git checkout main -- a.ts', 'git status && git checkout --ours -- a.ts', 'git restore a.ts', 'git restore -W a.ts']) {
      expect(blocked(command), command).toBe(true);
    }
    for (const command of ['git checkout -b x', 'git checkout -b x -- foo', 'git restore --staged a.ts', 'echo git checkout -- a', 'git commit -m "see git checkout -- a"']) {
      expect(blocked(command), command).toBe(false);
    }
  });
});

describe('openScratch', () => {
  it('makes an empty dir, guards it, and deletes it on close', async () => {
    const dcgFile = path.join(tmp, 'data', 'dcg.toml');
    const id = `test-${process.pid}`;
    fs.mkdirSync(path.join(scratchDir(id), 'left-over'), { recursive: true });
    const s = openScratch(id, dcgFile, {});
    expect(s.dir).toBe(scratchDir(id));
    expect(fs.readdirSync(s.dir)).toEqual([]);
    expect(s.env).toEqual({ FOCUS_SCRATCH: s.dir, DCG_CONFIG: dcgFile });
    expect(fs.readFileSync(dcgFile, 'utf8')).toBe(dcgConfig());

    const pre = (command: string) =>
      s.hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: 't', session_id: 's', transcript_path: '', cwd: '' }, 't', { signal: new AbortController().signal });
    expect(await pre('rm -rf "$FOCUS_SCRATCH/x"')).toEqual({});
    expect(await pre('rm -rf "$FOCUS_SCRATCH/../x"')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });

    s.close();
    expect(fs.existsSync(s.dir)).toBe(false);
  });

  it('leaves your own DCG_CONFIG alone', () => {
    const s = openScratch(`test-own-${process.pid}`, path.join(tmp, 'data', 'dcg.toml'), { DCG_CONFIG: '/mine.toml' });
    expect(s.env).toEqual({ FOCUS_SCRATCH: s.dir });
    s.close();
  });
});
