import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runtime } from './core';
import { workflowScript } from './sessions';

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
