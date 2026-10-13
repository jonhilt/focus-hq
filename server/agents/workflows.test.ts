import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../shared/types';
import { AGENT_RESULT_CHARS, applyWorkflowEvent, journalResults, RECENT_AGENTS, RESULT_CHARS, runOutcome, scriptPlan, transcriptLines, workflowAsk, WorkflowPermits, workflowProgress } from './workflows';

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

  it('rolls every agent it has queued, the queued too, in the order it queued them', () => {
    const read = workflowProgress([...progress].reverse());
    expect(read?.roll).toEqual([
      { label: 'review:bugs', phase: 1, status: 'done' },
      { label: 'review:perf', phase: 1, status: 'working' },
      { label: 'verify:store', phase: 2, status: 'queued' },
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
    expect(read.roll).toHaveLength(1000);
    expect(read.roll[999]).toEqual({ label: 'fan:999', phase: 1, status: 'queued' });
  });

  it('is null when there is no list', () => {
    expect(workflowProgress(undefined)).toBeNull();
    expect(workflowProgress({})).toBeNull();
  });
});

describe('applyWorkflowEvent', () => {
  const started = applyWorkflowEvent([], { kind: 'started', id: 'w1', name: 'review-changes', description: 'Review the diff' }, 5);

  it('starts a workflow running with no agents yet, once', () => {
    expect(started).toEqual([{ id: 'w1', name: 'review-changes', description: 'Review the diff', status: 'running', phases: [], agents: [], roll: [], startedAt: 5 }]);
    expect(applyWorkflowEvent(started, { kind: 'started', id: 'w1', name: 'again', description: '' }, 6)).toBe(started);
  });

  it('takes how its phases and agents stand from each progress', () => {
    const read = workflowProgress(progress)!;
    const [w] = applyWorkflowEvent(started, { kind: 'progress', id: 'w1', ...read }, 7);
    expect(w?.phases).toHaveLength(2);
    expect(w?.agents.map((a) => a.status)).toEqual(['done', 'working']);
    expect(w?.roll.map((a) => a.status)).toEqual(['done', 'working', 'queued']);
  });

  it('finishes the agents still at work, and the ones queued, along with it, and ignores progress after', () => {
    const read = workflowProgress(progress)!;
    const running = applyWorkflowEvent(started, { kind: 'progress', id: 'w1', ...read }, 7);
    const ended = applyWorkflowEvent(running, { kind: 'ended', id: 'w1', ok: false }, 8);
    const [w] = ended as [Workflow];
    expect(w.status).toBe('failed');
    expect(w.agents.map((a) => a.status)).toEqual(['done', 'failed']);
    expect(w.roll.map((a) => a.status)).toEqual(['done', 'failed', 'failed']);
    expect(w.phases.map((p) => [p.queued, p.working, p.done, p.failed])).toEqual([[0, 0, 1, 1], [0, 0, 0, 1]]);
    expect(applyWorkflowEvent(ended, { kind: 'progress', id: 'w1', phases: [], agents: [], roll: [] }, 9)).toBe(ended);
  });

  it('plans the phases its script’s meta declares, from the script it started with or one read later, once', () => {
    const script = "export const meta = { name: 'r', phases: [{ title: 'Review', detail: 'six angles' }, { title: 'Verify' }] }";
    const [w] = applyWorkflowEvent([], { kind: 'started', id: 'w1', name: 'r', description: '', script }, 5);
    expect(w?.plan).toEqual([{ title: 'Review', detail: 'six angles' }, { title: 'Verify' }]);
    const [later] = applyWorkflowEvent(started, { kind: 'plan', id: 'w1', plan: [{ title: 'Map' }] }, 6);
    expect(later?.plan).toEqual([{ title: 'Map' }]);
    const planned = applyWorkflowEvent(started, { kind: 'plan', id: 'w1', plan: [{ title: 'Map' }] }, 6);
    expect(applyWorkflowEvent(planned, { kind: 'plan', id: 'w1', plan: [{ title: 'Other' }] }, 7)).toBe(planned);
  });

  it('keeps what it has used from its progress, and from how it ended', () => {
    const read = workflowProgress(progress)!;
    const running = applyWorkflowEvent(started, { kind: 'progress', id: 'w1', ...read, usage: { tokens: 900, toolUses: 4 } }, 7);
    expect(running[0]?.usage).toEqual({ tokens: 900, toolUses: 4 });
    expect(applyWorkflowEvent(running, { kind: 'ended', id: 'w1', ok: true, usage: { tokens: 1200, toolUses: 9 } }, 8)[0]?.usage).toEqual({ tokens: 1200, toolUses: 9 });
    expect(applyWorkflowEvent(running, { kind: 'ended', id: 'w1', ok: true }, 8)[0]?.usage).toEqual({ tokens: 900, toolUses: 4 });
  });

  it('leaves the list alone for a workflow it doesn’t know', () => {
    expect(applyWorkflowEvent(started, { kind: 'ended', id: 'nope', ok: true }, 9)).toBe(started);
  });
});

describe('scriptPlan', () => {
  it('reads each phase’s title and detail from the meta, in order, whatever the quotes', () => {
    const script = [
      'export const meta = {',
      "  name: 'review-changes',",
      '  description: "Review [the] diff",',
      '  phases: [',
      "    { title: 'Research', detail: 'six parallel researchers, each a different angle' },",
      '    { title: "Verify", detail: `adversarially check {claims}` },',
      "    { title: 'Synthesize' },",
      '  ],',
      '}',
      "phase('Research')",
    ].join('\n');
    expect(scriptPlan(script)).toEqual([
      { title: 'Research', detail: 'six parallel researchers, each a different angle' },
      { title: 'Verify', detail: 'adversarially check {claims}' },
      { title: 'Synthesize' },
    ]);
  });

  it('reads escaped quotes, and leaves out a detail with something interpolated', () => {
    expect(scriptPlan("export const meta = { phases: [{ title: 'It\\'s', detail: `${x}` }] }")).toEqual([{ title: "It's" }]);
  });

  it('is empty without a meta, or when the meta declares no phases, even if the script names some later', () => {
    expect(scriptPlan("phase('Review')")).toEqual([]);
    expect(scriptPlan("export const meta = { name: 'x' }\nconst phases = [{ title: 'Nope' }]")).toEqual([]);
  });
});

describe('runOutcome', () => {
  it('reads what the run logged and returned, a returned value as JSON', () => {
    expect(runOutcome({ logs: ['6/6 back', 3], result: { report: 'ok' } })).toEqual({ logs: ['6/6 back'], result: '{\n  "report": "ok"\n}' });
    expect(runOutcome({ logs: [], result: 'Done' })).toEqual({ logs: [], result: 'Done' });
  });

  it('cuts a long result short, and has nothing to say of something that isn’t a run', () => {
    expect(runOutcome({ result: 'x'.repeat(RESULT_CHARS * 2) }).result?.length).toBeLessThanOrEqual(RESULT_CHARS);
    expect(runOutcome(null)).toEqual({ logs: [] });
    expect(runOutcome({ logs: 'nope' })).toEqual({ logs: [] });
  });
});

describe('journalResults', () => {
  const line = (e: object) => JSON.stringify(e);
  it('names each result by the agent that started with its key, in the order they came back, structured ones as JSON', () => {
    const journal = [
      line({ type: 'launched' }),
      line({ type: 'started', key: 'k1', agentId: 'a1', label: 'review:bugs', phase: 'Review' }),
      line({ type: 'started', key: 'k2', agentId: 'a2', label: 'review:perf', phase: 'Review' }),
      line({ type: 'result', key: 'k2', agentId: 'a2', result: { findings: 2 } }),
      line({ type: 'result', key: 'k1', agentId: 'a1', result: 'No bugs' }),
    ].join('\n');
    expect(journalResults(journal)).toEqual([
      { label: 'review:perf', phase: 'Review', result: '{\n  "findings": 2\n}' },
      { label: 'review:bugs', phase: 'Review', result: 'No bugs' },
    ]);
  });

  it('leaves out an agent with nothing returned, a line still being written, and cuts a long result short', () => {
    const journal = [
      line({ type: 'started', key: 'k1', label: 'a', phase: null }),
      line({ type: 'result', key: 'k1', result: null }),
      line({ type: 'result', key: 'k9', agentId: 'a9', result: 'x'.repeat(AGENT_RESULT_CHARS * 2) }),
      '{"type":"result","key":"k1","res',
    ].join('\n');
    const results = journalResults(journal);
    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe('a9');
    expect(results[0]?.result.length).toBeLessThanOrEqual(AGENT_RESULT_CHARS);
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
