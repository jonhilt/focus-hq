import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { echoTurn, type FakeSession, makeFakeAdapter } from 'agent-host';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { Settings, TermLine } from '../../shared/types';
import { paths } from '../config';
import { BrowserPool } from './browserTool';
import { DECLINED } from './claudeRunner';
import { copyTranscript, HostRunner } from './hostRunner';
import { refusedFile } from './pushGuard';
import { askedQuestions } from './questions';
import type { RunHooks, RunRequest } from './types';
import { workflowAsk } from './workflows';

// Developer sessions on agent-host (`HostRunner`), driven by agent-host's stand-in agent: what a Focus turn sees of a
// conversation the host runs. The host's own promises (its journal, resuming a cut-off turn, holds) are agent-host's
// tests; these are the runner's: a turn ends when the host's turn does, with what Claude Code said; a raised hand goes
// to the manager and their answer back; a message sent mid-turn reaches the agent; the next turn carries on the same
// conversation; Focus shutting down leaves a turn to the host, which resumes it, and Focus's own resume then watches
// that turn rather than telling the agent twice.

vi.setConfig({ testTimeout: 20_000 });

const settings: Settings = { maxConcurrent: 4, autonomy: 'ask', model: '', conflictsModel: '', qaModel: '', mergeMethod: 'squash', attribution: true, userClaudeMd: false, leadEffort: 'high', leadCompactAt: 200_000 };
const request = (prompt: string, resumeSessionId?: string): RunRequest => ({ agentId: 'dev_1', agentName: 'Ensign Dev', task: 'issue', cwd: process.cwd(), prompt, systemAppend: 'Work the issue.', settings, autonomy: 'ask', resumeSessionId });

const journal = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'focus-host-')), 'journal.sqlite');

function hooks(approve = true) {
  const lines: Omit<TermLine, 't'>[] = [];
  const asked: string[] = [];
  const h: RunHooks = {
    lines: (ls) => void lines.push(...ls),
    activity: () => undefined,
    browser: () => undefined,
    screenshot: () => undefined,
    session: () => undefined,
    cost: () => undefined,
    permission: (tool, summary) => (asked.push(`${tool}: ${summary}`), Promise.resolve(approve)),
    question: () => Promise.resolve(undefined),
  };
  return { h, lines, asked };
}

/** Claude Code's own messages, as the stand-in's events carry them. */
const assistant = (text: string) => ({ type: 'assistant', parent_tool_use_id: null, uuid: crypto.randomUUID(), session_id: 's', message: { content: [{ type: 'text', text }] } });
const result = (text: string) => ({ type: 'result', subtype: 'success', result: text, is_error: false, duration_ms: 1000, num_turns: 1, total_cost_usd: 0.01, session_id: 's', uuid: crypto.randomUUID() });

/** A turn as Claude Code takes it: it says something, gives a result, and goes quiet. */
const says = (s: FakeSession, text: string) =>
  Effect.gen(function* () {
    yield* s.beginTurn();
    yield* s.emit({ _tag: 'AssistantMessage', text, source: { _tag: 'Main' }, raw: assistant(text) });
    yield* s.emit({ _tag: 'Usage', costUsd: 0.01, source: { _tag: 'Main' }, raw: result(text) });
    yield* s.endTurn();
  });

const until = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error(`timed out waiting for ${what}`);
};

describe('HostRunner', () => {
  it("ends a developer's turn when the host's turn ends, with what Claude Code said, rendered as the old runner renders it", async () => {
    const fake = makeFakeAdapter({ script: (s, text) => says(s, `done: ${text}`) });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const { h, lines } = hooks();
    const outcome = await runner.start(request('fix the bug'), h).done;
    expect(outcome).toMatchObject({ ok: true, summary: 'done: fix the bug', started: true });
    expect(lines.map((l) => l.text).join('\n')).toContain('done: fix the bug');
    const s = await Effect.runPromise(fake.session(1));
    expect(s.options).toMatchObject({ autonomy: 'raise-hand', disallowedTools: ['AskUserQuestion', 'EnterPlanMode'], systemAppend: 'Work the issue.' });
    // the scratch dir's environment and the browser, lent
    expect(s.options.env.FOCUS_SCRATCH).toBeTruthy();
    expect(s.options.tools.map((t) => `${t.server}/${t.name}`)).toContain('browser/open');
    await runner.shutDown();
  });

  it("guards a session's Bash from its first opening, before the host has given Focus the conversation's id", async () => {
    const fake = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const session = runner.start(request('fix it'), hooks().h);
    const s = await Effect.runPromise(fake.session(1));
    await until(() => s.inTurn, 'the turn');
    // as the Claude adapter asks while the host opens the session: by an id Focus hasn't heard yet, and its labels
    expect(runner.extend('not-yet-known', s.options.labels)).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [expect.any(Function)] }] } });
    expect(runner.extend('not-yet-known', {})).toEqual({});
    session.stop();
    await session.done;
    await runner.shutDown();
  });

  it("puts a raised hand to the manager and gives the agent their answer", async () => {
    const fake = makeFakeAdapter({
      script: (s) =>
        Effect.gen(function* () {
          yield* s.beginTurn();
          for (const id of ['p1', 'p2']) {
            yield* s.emit({ _tag: 'PermissionRequested', requestId: id, tool: 'Bash', input: { command: 'curl x' }, summary: 'Bash(curl x)', source: { _tag: 'Main' } });
            yield* s.answerOf(id);
          }
          yield* s.endTurn();
        }),
    });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const { h, asked } = hooks(false);
    await runner.start(request('fetch it'), h).done;
    const s = await Effect.runPromise(fake.session(1));
    expect(asked).toEqual(['Bash: Bash(curl x)', 'Bash: Bash(curl x)']);
    expect(s.answers.get('p1')).toEqual({ _tag: 'Deny', message: DECLINED });
    await runner.shutDown();
  });

  it("lets the helpers of a workflow the manager approved run without asking, and asks about anyone else's", async () => {
    const main = { _tag: 'Main' as const };
    const system = (fields: Record<string, unknown>) => ({ _tag: 'RawEvent' as const, source: main, raw: { type: 'system', session_id: 's', uuid: crypto.randomUUID(), ...fields } });
    const fake = makeFakeAdapter({
      script: (s) =>
        Effect.gen(function* () {
          yield* s.beginTurn();
          yield* s.emit({ _tag: 'PermissionRequested', requestId: 'w', tool: 'Workflow', input: { name: 'review' }, summary: 'Workflow', source: main, raw: { toolUseID: 'toolu_9' } });
          yield* s.answerOf('w');
          yield* s.emit(system({ subtype: 'task_started', task_type: 'local_workflow', task_id: 'w1', tool_use_id: 'toolu_9', description: 'Review', workflow_name: 'review' }));
          yield* s.emit(system({ subtype: 'task_progress', task_id: 'w1', description: 'Review', usage: {}, workflow_progress: [{ type: 'workflow_agent', index: 1, label: 'review:bugs', state: 'start', startedAt: 3, agentId: 'a1' }] }));
          for (const [id, agentID] of [['h1', 'a1'], ['h2', 'stranger']]) {
            yield* s.emit({ _tag: 'PermissionRequested', requestId: id, tool: 'Bash', input: { command: 'curl x' }, summary: 'Bash(curl x)', source: main, raw: { agentID } });
            yield* s.answerOf(id);
          }
          yield* s.endTurn();
        }),
    });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const { h, asked } = hooks(true);
    await runner.start(request('review it'), h).done;
    const s = await Effect.runPromise(fake.session(1));
    expect(asked).toEqual([`Workflow: ${workflowAsk({ name: 'review' })}`, 'Bash: Bash(curl x)']);
    expect(s.answers.get('h1')).toEqual({ _tag: 'AllowOnce' });
    await runner.shutDown();
  });

  it("runs the agent's git through the push guard's hooks", async () => {
    const fake = makeFakeAdapter({ script: (s, text) => says(s, text) });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    await runner.start(request('push it'), hooks().h).done;
    const { env } = (await Effect.runPromise(fake.session(1))).options;
    const n = Number(env.GIT_CONFIG_COUNT) - 1;
    expect([env[`GIT_CONFIG_KEY_${n}`], env[`GIT_CONFIG_VALUE_${n}`]]).toEqual(['core.hooksPath', paths.gitHooks]);
    expect(env.FOCUS_PUSH_REFUSED).toBe(refusedFile('dev_1'));
    expect(existsSync(path.join(paths.gitHooks, 'pre-push'))).toBe(true);
    await runner.shutDown();
  });

  it('delivers a message sent mid-turn into that turn, and carries the next turn on in the same conversation', async () => {
    const fake = makeFakeAdapter({
      script: (s, text) =>
        Effect.gen(function* () {
          if (text !== 'first') return;
          yield* s.beginTurn();
          // the turn runs until a second message comes
          while (s.received.length < 2) yield* Effect.sleep(5);
          yield* says(s, `heard ${s.received.join(' + ')}`);
        }),
    });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const session = runner.start(request('first'), hooks().h);
    expect(session.send('second')).toBe(true);
    expect(await session.done).toMatchObject({ ok: true, summary: 'heard first + second' });
    expect(session.send('too late')).toBe(false);

    const s = await Effect.runPromise(fake.session(1));
    const next = runner.start(request('third', s.agentSessionId), hooks().h);
    await until(() => s.received.includes('third'), 'the next turn');
    await Effect.runPromise(says(s, 'third done'));
    expect(await next.done).toMatchObject({ ok: true, summary: 'third done' });
    expect(fake.sessions).toHaveLength(1);
    await runner.shutDown();
  });

  it('stops one background command by its task id, and the turn carries on to its end', async () => {
    const fake = makeFakeAdapter({
      script: (s) =>
        Effect.gen(function* () {
          yield* s.beginTurn();
          yield* s.emit({ _tag: 'BackgroundChanged', tasks: [{ id: 't1', description: 'sleep 120' }], waiting: true, source: { _tag: 'Main' } });
        }),
    });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const session = runner.start(request('wait on it'), hooks().h);
    const s = await Effect.runPromise(fake.session(1));
    await until(() => s.inTurn, 'the turn');
    expect(await session.stopTask?.('nope')).toBe(false);
    // once the turn's conversation is known to it
    let stopped = false;
    for (let i = 0; i < 100 && !stopped; i++) stopped = (await session.stopTask?.('t1')) === true || (await new Promise((r) => setTimeout(r, 10)), false);
    expect(stopped).toBe(true);
    expect(s.stopped).toEqual(['t1']);
    expect(await session.done).toMatchObject({ ok: true });
    expect(await session.stopTask?.('t1')).toBe(false);
    await runner.shutDown();
  });

  it('a stop ends the turn as stopped', async () => {
    const fake = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const session = runner.start(request('long job'), hooks().h);
    const s = await Effect.runPromise(fake.session(1));
    await until(() => s.inTurn, 'the turn');
    session.stop();
    expect(await session.done).toMatchObject({ ok: false, aborted: true });
    await runner.shutDown();
  });

  it("leaves a turn to the host when Focus shuts down: the host resumes it, and Focus's own resume watches that turn rather than telling the agent twice", async () => {
    const file = journal();
    const before = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const first = new HostRunner(new BrowserPool(), before, file);
    const session = first.start(request('build it'), hooks().h);
    const s1 = await Effect.runPromise(before.session(1));
    await until(() => s1.inTurn, 'the turn');
    first.closingNow();
    session.stop();
    await first.shutDown();

    const after = makeFakeAdapter({ script: echoTurn });
    const second = new HostRunner(new BrowserPool(), after, file);
    second.warmUp();
    const s2 = await Effect.runPromise(after.session(1));
    // the host resumed the same agent session itself, told it so, and sent the turn's message again
    expect(s2.options.resume).toBe(s1.agentSessionId);
    await until(() => s2.received.length === 2, 'the resume');
    expect(s2.received[1]).toBe('build it');
    // Focus's recovery starts the turn again on the same session: it watches, and sends nothing more
    const resumed = second.start(request('You were cut off: carry on.', s1.agentSessionId), hooks().h);
    await new Promise((r) => setTimeout(r, 100));
    expect(s2.received).toHaveLength(2);
    expect(after.sessions).toHaveLength(1);
    await Effect.runPromise(s2.endTurn());
    expect(await resumed.done).toMatchObject({ ok: true });
    await second.shutDown();
  });
});

describe("HostRunner, a goal's lead", () => {
  const signal = new AbortController().signal;
  const tools = { recap: async () => '', show: async () => '', ask: async () => '', proposeClose: async () => '', extra: [] };
  const lead = (prompt: string, edited = () => undefined, resumeSessionId?: string): RunRequest => ({
    ...request(prompt, resumeSessionId),
    agentId: 'lead_1',
    task: 'lead',
    tools,
    brief: { edited, afterCompact: () => 'The goal: Saved items' },
  });
  const edit = (file: string) => ({ hook_event_name: 'PostToolUse' as const, tool_name: 'Edit', tool_input: { file_path: file }, tool_response: {}, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: process.cwd() });
  const compacted = { hook_event_name: 'SessionStart' as const, source: 'compact' as const, session_id: 's', transcript_path: '', cwd: process.cwd() };

  it('may ask the user, reads their brief again as they edit it, has it back after a compaction, and has helpers summed up', async () => {
    const fake = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const edited = vi.fn();
    const session = runner.start(lead('run the goal', edited), hooks().h);
    const s = await Effect.runPromise(fake.session(1));
    await until(() => s.inTurn, 'the turn');
    expect(s.options.disallowedTools).toEqual(['EnterPlanMode']);
    const extension = runner.extend(s.options.conversationId, s.options.labels);
    expect(extension).toMatchObject({ agentProgressSummaries: true, toolConfig: { askUserQuestion: { previewFormat: 'html' } } });
    const [onEdit] = extension.hooks?.PostToolUse ?? [];
    await onEdit.hooks[0](edit(path.join(process.cwd(), 'brief.md')), 't1', { signal });
    expect(edited).toHaveBeenCalledOnce();
    const [onStart] = extension.hooks?.SessionStart ?? [];
    expect(await onStart.hooks[0](compacted, undefined, { signal })).toMatchObject({ hookSpecificOutput: { additionalContext: 'The goal: Saved items' } });
    await Effect.runPromise(s.endTurn());
    await session.done;
    await runner.shutDown();
  });

  it("gives a developer's sessions none of a lead's extras", async () => {
    const fake = makeFakeAdapter({ script: (s, text) => says(s, text) });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    await runner.start(request('fix it'), hooks().h).done;
    const s = await Effect.runPromise(fake.session(1));
    expect(runner.extend(s.options.conversationId, s.options.labels)).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [expect.any(Function)] }] } });
    await runner.shutDown();
  });

  it("puts a lead's question to the user and gives them the answers, and says so when it can't read one", async () => {
    const questions = [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }];
    const fake = makeFakeAdapter({
      script: (s) =>
        Effect.gen(function* () {
          yield* s.beginTurn();
          yield* s.emit({ _tag: 'QuestionAsked', requestId: 'q1', questions, source: { _tag: 'Main' } });
          yield* s.answerOf('q1');
          yield* s.emit({ _tag: 'QuestionAsked', requestId: 'q2', questions: 'nonsense', source: { _tag: 'Main' } });
          yield* s.answerOf('q2');
          yield* s.endTurn();
        }),
    });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const asked: unknown[] = [];
    const h: RunHooks = { ...hooks().h, question: (input) => (asked.push(input.questions), Promise.resolve({ 'Which?': 'B' })) };
    await runner.start(lead('decide'), h).done;
    const s = await Effect.runPromise(fake.session(1));
    expect(asked).toEqual([askedQuestions({ questions })]);
    expect(s.answers.get('q1')).toEqual({ _tag: 'Answers', answers: { 'Which?': 'B' } });
    expect(s.answers.get('q2')).toMatchObject({ _tag: 'Declined', reason: expect.stringMatching(/couldn’t read the questions/) });
    await runner.shutDown();
  });

  it('has the manager give a lead their extras for a conversation the host resumes after a restart', async () => {
    const file = journal();
    const before = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const first = new HostRunner(new BrowserPool(), before, file);
    const session = first.start(lead('run the goal'), hooks().h);
    const s1 = await Effect.runPromise(before.session(1));
    await until(() => s1.inTurn, 'the turn');
    first.closingNow();
    session.stop();
    await first.shutDown();

    const after = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const second = new HostRunner(new BrowserPool(), after, file);
    const asked: string[] = [];
    second.extrasFor = (id) => (asked.push(id), { cwd: process.cwd(), tools, brief: { edited: () => undefined, afterCompact: () => 'The goal: resumed' } });
    second.warmUp();
    const s2 = await Effect.runPromise(after.session(1));
    expect(asked).toEqual(['lead_1']);
    const [onStart] = second.extend(s2.options.conversationId, s2.options.labels).hooks?.SessionStart ?? [];
    expect(await onStart.hooks[0](compacted, undefined, { signal })).toMatchObject({ hookSpecificOutput: { additionalContext: 'The goal: resumed' } });
    await second.shutDown();
  });
});

describe('HostRunner, a Codex developer', () => {
  it("runs on Codex with the Codex model, and draws its turn from the host's common events", async () => {
    const claude = makeFakeAdapter({ script: (s, text) => says(s, text) });
    const codex = makeFakeAdapter({
      script: (s, text) =>
        Effect.gen(function* () {
          yield* s.beginTurn();
          yield* s.emit({ _tag: 'ToolStepStarted', toolUseId: 't1', name: 'shell', input: { command: 'pnpm test' }, source: { _tag: 'Main' } });
          yield* s.emit({ _tag: 'ToolStepEnded', toolUseId: 't1', ok: true, output: { head: 'all passed', tail: '', totalBytes: 10 }, source: { _tag: 'Main' } });
          yield* s.emit({ _tag: 'AssistantMessage', text: `done: ${text}`, source: { _tag: 'Main' } });
          yield* s.endTurn();
        }),
    });
    const runner = new HostRunner(new BrowserPool(), claude, journal(), codex);
    const { h, lines } = hooks();
    let session: string | undefined;
    h.session = (id) => void (session = id);
    const req = { ...request('fix the bug'), agent: 'codex' as const, model: 'opus', settings: { ...settings, codexModel: 'gpt-5.5-codex' } };
    const outcome = await runner.start(req, h).done;
    expect(outcome).toMatchObject({ ok: true, summary: 'done: fix the bug', started: true });
    expect(claude.sessions).toHaveLength(0);
    const s = await Effect.runPromise(codex.session(1));
    // the Codex model, not the Claude one; none of Claude Code's own tools to switch off
    expect(s.options).toMatchObject({ model: 'gpt-5.5-codex', disallowedTools: [] });
    expect(session).toBe(s.agentSessionId);
    expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(['⏺ Bash(pnpm test)', '  ⎿  all passed', '✔ Done']));
    await runner.shutDown();
  });
});

describe('HostRunner, a QA officer', () => {
  it('asks the host for the report, and ends the turn once it is in, though a background command still runs (the preview server)', async () => {
    const schema = { type: 'object', properties: { verdict: { type: 'string' } } };
    let interrupted = false;
    const fake = makeFakeAdapter({
      script: (s) =>
        Effect.gen(function* () {
          yield* s.beginTurn();
          yield* s.emit({ _tag: 'BackgroundChanged', tasks: [{ id: 'b1', description: 'pnpm dev' }], waiting: false, source: { _tag: 'Main' } });
          const report = { type: 'result', subtype: 'success', result: 'QA passed', structured_output: { verdict: 'pass' }, is_error: false, duration_ms: 1000, num_turns: 1, total_cost_usd: 0.01, session_id: 's', uuid: crypto.randomUUID() };
          yield* s.emit({ _tag: 'StructuredAnswer', value: { verdict: 'pass' }, source: { _tag: 'Main' }, raw: report });
          // the turn stays open on its background command until it's interrupted
          yield* Effect.callback<void>(() => Effect.sync(() => void (interrupted = true)));
        }),
    });
    const runner = new HostRunner(new BrowserPool(), fake, journal());
    const req: RunRequest = { ...request('review PR #7'), task: 'review', outputSchema: schema };
    const outcome = await runner.start(req, hooks().h).done;
    expect(outcome).toMatchObject({ ok: true, summary: 'QA passed', structured: { verdict: 'pass' }, started: true });
    const s = await Effect.runPromise(fake.session(1));
    expect(s.options.outputSchema).toEqual(schema);
    await until(() => interrupted || !s.inTurn, 'the background let go');
    await runner.shutDown();
  });
});

describe('copyTranscript', () => {
  const folders = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'focus-transcripts-'));
    const from = path.join(root, 'from');
    const to = path.join(root, 'to');
    mkdirSync(path.join(from, '-Users-me-repo'), { recursive: true });
    writeFileSync(path.join(from, '-Users-me-repo', 's1.jsonl'), '{"line":1}\n');
    return { from, to };
  };

  it("copies a session's transcript to where the host's Claude Code looks, in the same project folder", () => {
    const { from, to } = folders();
    expect(copyTranscript('s1', from, to)).toBe(true);
    expect(readFileSync(path.join(to, '-Users-me-repo', 's1.jsonl'), 'utf8')).toBe('{"line":1}\n');
  });

  it('copies once: a transcript the host already has is left as it is', () => {
    const { from, to } = folders();
    mkdirSync(path.join(to, '-Users-me-repo'), { recursive: true });
    writeFileSync(path.join(to, '-Users-me-repo', 's1.jsonl'), 'the host’s own\n');
    expect(copyTranscript('s1', from, to)).toBe(false);
    expect(readFileSync(path.join(to, '-Users-me-repo', 's1.jsonl'), 'utf8')).toBe('the host’s own\n');
  });

  it('copies nothing when the session has no transcript, or there are no transcripts at all', () => {
    const { from, to } = folders();
    expect(copyTranscript('missing', from, to)).toBe(false);
    expect(copyTranscript('s1', path.join(from, 'nowhere'), to)).toBe(false);
    expect(existsSync(to)).toBe(false);
  });
});
