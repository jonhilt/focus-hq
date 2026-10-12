import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runtime } from './core';
import { keepWorkflowFiles, workflowScript } from './sessions';

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

const runtime = (scripts: Runtime['workflowScripts'], transcripts?: Map<string, string>) => ({ workflowScripts: scripts, workflowTranscripts: transcripts }) as unknown as Runtime;

describe('workflowScript', () => {
  it('reads the script from where Claude Code saved it, with nothing logged or returned while it runs', () => {
    const { dir, scriptPath } = session();
    const rt = runtime(new Map([['t1', { path: scriptPath }]]), new Map([['t1', dir]]));
    expect(workflowScript(rt, 't1')).toEqual({ source: "export const meta = { name: 'review' }", logs: [] });
  });

  it('takes what it logged and returned from the run, once Claude Code has saved it', () => {
    const { root, dir } = session();
    fs.writeFileSync(path.join(root, 'workflows', 'wf_1.json'), JSON.stringify({ logs: ['3 reviewed'], result: 'All good' }));
    const rt = runtime(new Map([['t1', { source: 'inline' }]]), new Map([['t1', dir]]));
    expect(workflowScript(rt, 't1')).toEqual({ source: 'inline', logs: ['3 reviewed'], result: 'All good' });
  });

  it('is empty for a workflow it knows nothing of', () => {
    expect(workflowScript(undefined, 't1')).toEqual({ source: '', logs: [] });
    expect(workflowScript(runtime(new Map()), 'nope')).toEqual({ source: '', logs: [] });
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
