import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runtime } from './core';
import { OUTPUT_TAIL } from '../backgroundTasks';
import { backgroundOutputLines, keepWorkflowFiles, workflowAgentLines, workflowScript } from './sessions';

// a session's folder, as Claude Code lays it out: the run's agents under subagents/workflows/<runId>/, its script under
// workflows/scripts/, and the run itself in workflows/<runId>.json once it's over
function session() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-workflow-script-'));
  const dir = path.join(root, 'subagents', 'workflows', 'wf_1');
  const scriptPath = path.join(root, 'workflows', 'scripts', 'review.js');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, "export const meta = { name: 'review' }");
  return { root, dir, scriptPath };
}

const runtime = (scripts: Runtime['workflowScripts'], transcripts?: Map<string, string>, outputs?: Map<string, string>) =>
  ({ workflowScripts: scripts, workflowTranscripts: transcripts, backgroundOutputs: outputs }) as unknown as Runtime;

describe('workflowScript', () => {
  it('reads the script from where Claude Code saved it, with nothing logged or returned while it runs', () => {
    const { dir, scriptPath } = session();
    const rt = runtime(new Map([['t1', { path: scriptPath }]]), new Map([['t1', dir]]));
    expect(workflowScript(rt, 't1')).toEqual({ source: "export const meta = { name: 'review' }", logs: [], results: [] });
  });

  it('takes what it logged and returned from the run, once Claude Code has saved it', () => {
    const { root, dir } = session();
    fs.writeFileSync(path.join(root, 'workflows', 'wf_1.json'), JSON.stringify({ logs: ['3 reviewed'], result: 'All good' }));
    const rt = runtime(new Map([['t1', { source: 'inline' }]]), new Map([['t1', dir]]));
    expect(workflowScript(rt, 't1')).toEqual({ source: 'inline', logs: ['3 reviewed'], result: 'All good', results: [] });
  });

  it('reads what each agent has returned so far from the journal, while it runs', () => {
    const { dir } = session();
    fs.writeFileSync(path.join(dir, 'journal.jsonl'), [
      { type: 'launched' },
      { type: 'started', key: 'k1', agentId: 'a1', label: 'review:bugs', phase: 'Review' },
      { type: 'result', key: 'k1', agentId: 'a1', result: 'No bugs' },
    ].map((e) => JSON.stringify(e)).join('\n'));
    const rt = runtime(new Map([['t1', { source: 'src' }]]), new Map([['t1', dir]]));
    expect(workflowScript(rt, 't1').results).toEqual([{ label: 'review:bugs', phase: 'Review', result: 'No bugs' }]);
  });

  it('is empty for a workflow it knows nothing of', () => {
    expect(workflowScript(undefined, 't1')).toEqual({ source: '', logs: [], results: [] });
    expect(workflowScript(runtime(new Map()), 'nope')).toEqual({ source: '', logs: [], results: [] });
  });
});

describe('keepWorkflowFiles', () => {
  it('keeps the script a workflow started with, and passes the event on', () => {
    const rt = runtime(undefined);
    const started = { kind: 'started' as const, id: 't1', name: 'r', description: '', script: 'src' };
    expect(keepWorkflowFiles(rt, started)).toBe(started);
    expect(rt.workflowScripts?.get('t1')).toEqual({ source: 'src' });
  });

  it('keeps where its files are, and plans its phases from a saved script it had no source for', () => {
    const { dir, scriptPath } = session();
    fs.writeFileSync(scriptPath, "export const meta = { phases: [{ title: 'Map', detail: 'each repo' }] }");
    const rt = runtime(undefined);
    expect(keepWorkflowFiles(rt, { kind: 'transcripts', id: 't1', dir, scriptPath })).toEqual({ kind: 'plan', id: 't1', plan: [{ title: 'Map', detail: 'each repo' }] });
    expect(rt.workflowTranscripts?.get('t1')).toBe(dir);
    expect(rt.workflowScripts?.get('t1')?.source).toContain('Map');
  });

  it('has nothing more to say of where its files are when it has the source already, or no script path', () => {
    const { dir, scriptPath } = session();
    const rt = runtime(new Map([['t1', { source: 'src' }]]));
    expect(keepWorkflowFiles(rt, { kind: 'transcripts', id: 't1', dir, scriptPath })).toBeUndefined();
    expect(rt.workflowScripts?.get('t1')).toEqual({ source: 'src', path: scriptPath });
    expect(keepWorkflowFiles(rt, { kind: 'transcripts', id: 't2', dir })).toBeUndefined();
  });
});

describe('workflowAgentLines', () => {
  it('reads a workflow agent’s transcript as terminal lines, from its run’s folder', () => {
    const { dir } = session();
    fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'), [
      { type: 'user', message: { content: 'Review the diff' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'No bugs' }] } },
    ].map((e) => JSON.stringify(e)).join('\n'));
    const lines = workflowAgentLines(runtime(undefined, new Map([['t1', dir]])), 't1', 'a1');
    expect(lines[0]).toEqual({ kind: 'manager', text: '▶ Review the diff' });
    expect(lines.map((l) => l.text).join('\n')).toContain('No bugs');
  });

  it('reads nothing outside the run’s folder, whatever the agent id says', () => {
    const { root, dir } = session();
    fs.writeFileSync(path.join(root, 'subagents', 'agent-x.jsonl'), JSON.stringify({ type: 'user', message: { content: 'secret' } }));
    const rt = runtime(undefined, new Map([['t1', dir]]));
    for (const id of ['x/../../../agent-x', '../x', 'a/b', '', 'x'.repeat(65)]) expect(workflowAgentLines(rt, 't1', id)).toEqual([]);
  });

  it('is empty until there’s a transcript to read, or for a workflow it knows nothing of', () => {
    const { dir } = session();
    expect(workflowAgentLines(runtime(undefined, new Map([['t1', dir]])), 't1', 'a1')).toEqual([]);
    expect(workflowAgentLines(runtime(undefined, new Map()), 't1', 'a1')).toEqual([]);
    expect(workflowAgentLines(undefined, 't1', 'a1')).toEqual([]);
  });
});

describe('backgroundOutputLines', () => {
  const output = (text: string) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-background-')), 'b1.output');
    fs.writeFileSync(file, text);
    return runtime(undefined, undefined, new Map([['b1', file]]));
  };

  it('reads a background command’s output as terminal lines', () => {
    expect(backgroundOutputLines(output('building\r\ndone\n'), 'b1')).toEqual([{ kind: 'output', text: 'building' }, { kind: 'output', text: 'done' }]);
  });

  it('reads only the end of a long one, from the start of a line', () => {
    const lines = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
    const read = backgroundOutputLines(output(lines.join('\n')), 'b1');
    expect(read.at(-1)).toEqual({ kind: 'output', text: 'line 3999' });
    expect(read.length).toBeLessThan(lines.length);
    expect(read.map((l) => l.text).join('\n').length).toBeLessThanOrEqual(OUTPUT_TAIL);
    expect(lines).toContain(read[0].text);
  });

  it('is empty until there’s output to read, or for a command it knows nothing of', () => {
    const missing = runtime(undefined, undefined, new Map([['b1', path.join(os.tmpdir(), 'focus-no-such-dir', 'b1.output')]]));
    expect(backgroundOutputLines(missing, 'b1')).toEqual([]);
    expect(backgroundOutputLines(output('hi'), 'b2')).toEqual([]);
    expect(backgroundOutputLines(undefined, 'b1')).toEqual([]);
  });
});

