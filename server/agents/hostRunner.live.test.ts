import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryLines, isTextLine } from '../../shared/stepText';
import type { Settings, TermEntry } from '../../shared/types';
import type { BackgroundEvent } from './backgroundTasks';
import { BrowserPool } from './browserTool';
import { HostRunner } from './hostRunner';
import { parseQaReport, QA_SCHEMA } from './qa';
import type { RunHooks, RunRequest } from './types';

// A developer's session through agent-host on real Claude Code, on your plan (signed in under ~/.agent-host/claude).
// It costs plan usage, so it runs only with FOCUS_HOST_LIVE=1, on Haiku.

const live = process.env.FOCUS_HOST_LIVE === '1';
const settings: Settings = { maxConcurrent: 4, autonomy: 'ask', model: 'haiku', conflictsModel: '', qaModel: '', mergeMethod: 'squash', attribution: true, userClaudeMd: false, leadEffort: 'high', leadCompactAt: 200_000 };

describe.skipIf(!live)('HostRunner on real Claude Code', () => {
  it('runs a developer turn end to end: lines, a background command carried on, a raised hand, a subagent, the session and its cost', async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'focus-host-live-'));
    const runner = new HostRunner(new BrowserPool(), undefined, path.join(cwd, 'journal.sqlite'));
    const lines: TermEntry[] = [];
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
    const text = lines.flatMap(entryLines).map((l) => l.text).join('\n');
    expect(outcome).toMatchObject({ ok: true, started: true });
    // the background command's result was taken in a turn of Claude Code's own, inside this one Focus turn
    expect(session).toBeTruthy();
    expect(cost).toBeGreaterThan(0);
    expect(asked.some((a) => a.includes('curl'))).toBe(true);
    expect(background.length).toBeGreaterThan(0);
    // a subagent's steps go, marked as its, in the session's own
    expect(lines.some((l) => !isTextLine(l) && l.helper !== undefined)).toBe(true);
    expect(text).toContain('BG-OK');
    await runner.shutDown();
  }, 300_000);

  it("runs a goal lead's turns: an office tool, a question to the user, and Ops' /compact giving the brief back", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'focus-host-lead-'));
    const runner = new HostRunner(new BrowserPool(), undefined, path.join(cwd, 'journal.sqlite'));
    const shown: string[] = [];
    const questions: string[] = [];
    let compacted = 0;
    let session: string | undefined;
    const hooks: RunHooks = {
      lines: () => undefined,
      activity: () => undefined,
      browser: () => undefined,
      screenshot: () => undefined,
      session: (id) => void (session = id),
      cost: () => undefined,
      permission: () => Promise.resolve(true),
      question: (input) => (questions.push(...input.questions.map((q) => q.question)), Promise.resolve(Object.fromEntries(input.questions.map((q) => [q.question, 'Teal'])))),
    };
    const lead = (prompt: string, resumeSessionId?: string): RunRequest => ({
      agentId: 'lead_live',
      agentName: 'Lt. Live',
      task: 'lead',
      cwd,
      prompt,
      systemAppend: 'You lead a goal for the user.',
      settings,
      autonomy: 'ask',
      model: 'haiku',
      resumeSessionId,
      tools: {
        recap: async () => 'recapped',
        show: async (input) => (shown.push(input.title), 'Shown on your screen.'),
        ask: async () => 'asked',
        proposeClose: async () => 'proposed',
      },
      brief: { edited: () => undefined, afterCompact: () => (compacted++, 'The goal: paint the shed. Done looks like: it is teal.') },
    });
    const first = await runner.start(
      lead(
        'Do these in order. 1) Call the mcp__office__show tool with id "colours", title "Shed colours" and html "<p>teal or red</p>". ' +
          '2) Ask the user with AskUserQuestion which colour to paint the shed, options Teal and Red. 3) Reply with the colour they picked.',
      ),
      hooks,
    ).done;
    expect(first).toMatchObject({ ok: true });
    expect(shown).toEqual(['Shed colours']);
    expect(questions).toHaveLength(1);
    expect(first.summary).toMatch(/teal/i);
    // Ops compacting the conversation: the lead hears their brief again from the SessionStart hook
    const said: string[] = [];
    const compact = await runner.start(lead('/compact keep the goal', session), { ...hooks, lines: (ls) => void said.push(...ls.flatMap(entryLines).map((l) => `${l.kind}: ${l.text}`)) }).done;
    expect(compact).toMatchObject({ ok: true });
    expect(compacted).toBeGreaterThan(0);
    await runner.shutDown();
  }, 300_000);

  it('runs a QA review end to end and returns its verdict as a structured answer (criterion 14)', async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'focus-host-qa-live-'));
    writeFileSync(path.join(cwd, 'add.js'), 'export const add = (a, b) => a + b;\n');
    const runner = new HostRunner(new BrowserPool(), undefined, path.join(cwd, 'journal.sqlite'));
    const lines: TermEntry[] = [];
    const hooks: RunHooks = {
      lines: (ls) => void lines.push(...ls),
      activity: () => undefined,
      browser: () => undefined,
      screenshot: () => undefined,
      session: () => undefined,
      cost: () => undefined,
      permission: () => Promise.resolve(true),
      question: () => Promise.resolve(undefined),
    };
    const req: RunRequest = {
      agentId: 'qa_live',
      agentName: 'Lt. Live',
      task: 'review',
      cwd,
      prompt: 'Review the change in add.js. Acceptance criterion: `add(2, 3)` returns 5. Read the file, check it with `node -e`, then give your report.',
      systemAppend: '',
      settings,
      autonomy: 'full',
      model: 'haiku',
      outputSchema: QA_SCHEMA,
    };
    const outcome = await runner.start(req, hooks).done;
    expect(outcome).toMatchObject({ ok: true, started: true });
    const report = parseQaReport(outcome.structured, outcome.summary);
    expect(report?.verdict).toBe('pass');
    expect(report?.checks.length).toBeGreaterThan(0);
    await runner.shutDown();
  }, 300_000);
});
