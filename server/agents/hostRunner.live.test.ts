import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Settings, TermLine } from '../../shared/types';
import type { BackgroundEvent } from './backgroundTasks';
import { BrowserPool } from './browserTool';
import { HostRunner } from './hostRunner';
import type { RunHooks, RunRequest } from './types';

// A developer's session through agent-host on real Claude Code, on your plan (signed in under ~/.agent-host/claude).
// It costs plan usage, so it runs only with FOCUS_HOST_LIVE=1, on Haiku.

const live = process.env.FOCUS_HOST_LIVE === '1';
const settings: Settings = { maxConcurrent: 4, autonomy: 'ask', model: 'haiku', conflictsModel: '', qaModel: '', mergeMethod: 'squash', attribution: true, userClaudeMd: false, leadEffort: 'high', leadCompactAt: 200_000 };

describe.skipIf(!live)('HostRunner on real Claude Code', () => {
  it('runs a developer turn end to end: lines, a background command carried on, a raised hand, a subagent, the session and its cost', async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'focus-host-live-'));
    const runner = new HostRunner(new BrowserPool(), undefined, path.join(cwd, 'journal.sqlite'));
    const lines: Omit<TermLine, 't'>[] = [];
    const background: BackgroundEvent[] = [];
    const asked: string[] = [];
    let session: string | undefined;
    let cost = 0;
    const hooks: RunHooks = {
      lines: (ls) => void lines.push(...ls),
      activity: () => undefined,
      browser: () => undefined,
      screenshot: () => undefined,
      session: (id) => void (session = id),
      cost: (usd) => void (cost = usd),
      background: (e) => void background.push(e),
      permission: (tool, summary) => (asked.push(`${tool}: ${summary}`), Promise.resolve(true)),
      question: () => Promise.resolve(undefined),
    };
    const req: RunRequest = {
      agentId: 'dev_live',
      agentName: 'Ensign Live',
      task: 'issue',
      cwd,
      prompt:
        'Do these in order. 1) Run `sleep 5 && echo BG-OK` with Bash using run_in_background, and do not wait for it. ' +
        '2) Run `curl -sI https://example.com` with Bash. 3) Use the Agent tool (subagent_type Explore) to list the files in this folder. ' +
        '4) When the background command finishes, reply with the word it printed.',
      systemAppend: '',
      settings,
      autonomy: 'ask',
      model: 'haiku',
    };
    const outcome = await runner.start(req, hooks).done;
    const text = lines.map((l) => l.text).join('\n');
    expect(outcome).toMatchObject({ ok: true, started: true });
    // the background command's result was taken in a turn of Claude Code's own, inside this one Focus turn
    expect(session).toBeTruthy();
    expect(cost).toBeGreaterThan(0);
    expect(asked.some((a) => a.includes('curl'))).toBe(true);
    expect(background.length).toBeGreaterThan(0);
    // a subagent's lines go, indented, in the session's own
    expect(lines.some((l) => l.text.startsWith('    '))).toBe(true);
    expect(text).toContain('BG-OK');
    await runner.shutDown();
  }, 300_000);
});
