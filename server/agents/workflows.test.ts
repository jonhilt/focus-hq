import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../shared/types';
import { applyWorkflowEvent, RECENT_AGENTS, transcriptLines, workflowAsk, WorkflowPermits, workflowProgress } from './workflows';

// as the probes saw it: a snapshot of every phase, and every agent queued so far
const progress = [
  { type: 'workflow_phase', index: 1, title: 'Review' },
  { type: 'workflow_phase', index: 2, title: 'Verify' },
  { type: 'workflow_agent', index: 1, label: 'review:bugs', phaseIndex: 1, phaseTitle: 'Review', agentId: 'a1', model: 'claude-sonnet-5-5', state: 'done', startedAt: 10, durationMs: 5, promptPreview: 'Find bugs', resultPreview: 'No bugs\nmore' },
  { type: 'workflow_agent', index: 2, label: 'review:perf', phaseIndex: 1, phaseTitle: 'Review', agentId: 'a2', state: 'start', startedAt: 11, promptPreview: 'Profile the render loop' },
  { type: 'workflow_agent', index: 3, label: 'verify:store', phaseIndex: 2, phaseTitle: 'Verify', state: 'start', queuedAt: 12 },
  { type: 'something_new', index: 9 },
];

describe('workflowProgress', () => {
  it('counts each phase’s agents, and keeps the ones at work and the ones that finished', () => {
    const read = workflowProgress(progress);
    expect(read?.phases).toEqual([
      { index: 1, title: 'Review', queued: 0, working: 1, done: 1, failed: 0 },
      { index: 2, title: 'Verify', queued: 1, working: 0, done: 0, failed: 0 },
    ]);
    expect(read?.agents).toEqual([
      { index: 1, label: 'review:bugs', phase: 1, status: 'done', model: 'claude-sonnet-5-5', activity: 'No bugs', finishedAt: 15, agentId: 'a1' },
      { index: 2, label: 'review:perf', phase: 1, status: 'working', model: undefined, activity: 'Profile the render loop', agentId: 'a2' },
    ]);
  });

  it('calls an agent that failed, errored or was stopped failed, saying why', () => {
    const agent = (state: string) => workflowProgress([{ type: 'workflow_agent', index: 1, label: 'x', phaseIndex: 1, state, startedAt: 1, error: 'Bad schema' }])?.agents[0];
    expect(['failed', 'error', 'killed', 'stopped'].map((s) => agent(s)?.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(agent('error')?.activity).toBe('Bad schema');
  });

  it('gives agents started before the script named a phase an untitled phase 0', () => {
    const read = workflowProgress([{ type: 'workflow_agent', index: 1, label: 'early', state: 'done', startedAt: 1 }]);
    expect(read?.agents[0]?.phase).toBe(0);
    expect(read?.phases).toEqual([{ index: 0, title: '', queued: 0, working: 0, done: 1, failed: 0 }]);
  });

  it('marks a child workflow’s phase, and takes a phase named mid-run', () => {
    const read = workflowProgress([
      { type: 'workflow_phase', index: 1, title: 'Fan' },
      { type: 'workflow_phase', index: 2, title: '▸ child-probe', kind: 'child' },
      { type: 'workflow_agent', index: 1, label: 'stray', phaseIndex: 3, phaseTitle: 'Unlisted', state: 'start', startedAt: 1 },
      { type: 'workflow_phase', index: 3, title: 'Unlisted' },
    ]);
    expect(read?.phases.map((p) => [p.index, p.title, !!p.child, p.working])).toEqual([[1, 'Fan', false, 0], [2, '▸ child-probe', true, 0], [3, 'Unlisted', false, 1]]);
  });

  it('keeps every agent at work but only the ones that finished last, of a thousand', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ type: 'workflow_agent', index: i + 1, label: `fan:${i}`, phaseIndex: 1, state: i < 980 ? 'done' : i < 988 ? 'start' : 'start', startedAt: i < 988 ? i : undefined, durationMs: 1 }));
    const read = workflowProgress(many)!;
    expect(read.phases[0]).toMatchObject({ done: 980, working: 8, queued: 12 });
    expect(read.agents.filter((a) => a.status === 'working')).toHaveLength(8);
    expect(read.agents.filter((a) => a.status === 'done').map((a) => a.index)).toEqual(Array.from({ length: RECENT_AGENTS }, (_, i) => 981 - RECENT_AGENTS + i));
  });

  it('is null when there is no list', () => {
    expect(workflowProgress(undefined)).toBeNull();
    expect(workflowProgress({})).toBeNull();
  });
});

describe('applyWorkflowEvent', () => {
  const started = applyWorkflowEvent([], { kind: 'started', id: 'w1', name: 'review-changes', description: 'Review the diff' }, 5);

  it('starts a workflow running with no agents yet, once', () => {
    expect(started).toEqual([{ id: 'w1', name: 'review-changes', description: 'Review the diff', status: 'running', phases: [], agents: [], startedAt: 5 }]);
    expect(applyWorkflowEvent(started, { kind: 'started', id: 'w1', name: 'again', description: '' }, 6)).toBe(started);
  });

  it('takes how its phases and agents stand from each progress', () => {
    const read = workflowProgress(progress)!;
    const [w] = applyWorkflowEvent(started, { kind: 'progress', id: 'w1', ...read }, 7);
    expect(w?.phases).toHaveLength(2);
    expect(w?.agents.map((a) => a.status)).toEqual(['done', 'working']);
  });

  it('finishes the agents still at work, and the ones queued, along with it, and ignores progress after', () => {
    const read = workflowProgress(progress)!;
    const running = applyWorkflowEvent(started, { kind: 'progress', id: 'w1', ...read }, 7);
    const ended = applyWorkflowEvent(running, { kind: 'ended', id: 'w1', ok: false }, 8);
    const [w] = ended as [Workflow];
    expect(w.status).toBe('failed');
    expect(w.agents.map((a) => a.status)).toEqual(['done', 'failed']);
    expect(w.phases.map((p) => [p.queued, p.working, p.done, p.failed])).toEqual([[0, 0, 1, 1], [0, 0, 0, 1]]);
    expect(applyWorkflowEvent(ended, { kind: 'progress', id: 'w1', phases: [], agents: [] }, 9)).toBe(ended);
  });

  it('leaves the list alone for a workflow it doesn’t know', () => {
    expect(applyWorkflowEvent(started, { kind: 'ended', id: 'nope', ok: true }, 9)).toBe(started);
  });
});

describe('WorkflowPermits', () => {
  it('approves the agents of a workflow the captain approved, while it runs', () => {
    const permits = new WorkflowPermits();
    permits.approveCall('toolu_1');
    permits.started('w1', 'toolu_1');
    permits.seen('w1', [{ agentId: 'a1' }, {}]);
    expect(permits.approves('a1')).toBe(true);
    permits.ended('w1');
    expect(permits.approves('a1')).toBe(false);
  });

  it('doesn’t approve the lead itself, an agent of a workflow nobody approved, or one it hasn’t heard of', () => {
    const permits = new WorkflowPermits();
    permits.started('w2', 'toolu_2'); // ran without being asked about (another autonomy setting)
    permits.seen('w2', [{ agentId: 'b1' }]);
    expect(permits.approves(undefined)).toBe(false);
    expect(permits.approves('b1')).toBe(false);
    expect(permits.approves('zz')).toBe(false);
  });

  it('might yet approve an agent it hasn’t heard of only while an approved workflow runs', () => {
    const permits = new WorkflowPermits();
    expect(permits.mightApprove('a1')).toBe(false);
    permits.approveCall('toolu_1');
    permits.started('w1', 'toolu_1');
    expect(permits.mightApprove('a1')).toBe(true);
    permits.seen('w1', [{ agentId: 'a1' }]);
    expect(permits.mightApprove('a1')).toBe(false);
    expect(permits.mightApprove(undefined)).toBe(false);
  });
});

describe('workflowAsk', () => {
  it('names the workflow from its script, and says what approving it means', () => {
    expect(workflowAsk({ script: "export const meta = { name: 'review-changes', description: 'x' }" })).toBe('Run workflow review-changes: its agents run their commands without asking, for this run');
    expect(workflowAsk({ name: 'saved-one' })).toMatch(/^Run workflow saved-one:/);
    expect(workflowAsk({})).toMatch(/^Run workflow a workflow:/);
  });
});

describe('transcriptLines', () => {
  const jsonl = [
    { type: 'user', message: { content: 'Run the bash command: echo hi' } },
    { type: 'attachment', attachment: {} },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'hi' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'It printed hi' }] } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n{"type":"assist';

  it('reads what it was asked, the tools it used, what came back and what it said, leaving out its thinking', () => {
    const text = transcriptLines(jsonl).map((l) => l.text).join('\n');
    expect(text).toMatch(/^▶ Run the bash command: echo hi/);
    expect(text).toMatch(/Bash\(echo hi\)/);
    expect(text).toMatch(/hi/);
    expect(text).toMatch(/It printed hi/);
    expect(text).not.toMatch(/hmm/);
  });
});
