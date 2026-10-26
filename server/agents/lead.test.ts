import { describe, expect, it } from 'vitest';
import { leadFor, leadId, plannerFor, qaFor, qaOfficerFor } from '../../shared/crew';
import type { Agent, LeadAgent, LeadWork } from '../../shared/types';
import { answerInChat, pageErrorsNote, BRIEF_LIMIT, freshSessionPrompt, goalBrief, conflictsResolvedNote, fixingNote, fixPushedNote, fixHandedBackNote, applyHelperEvent, backgroundChange, backgroundStop, helperChange, taskChange, workflowChange, COMPACT_INSTRUCTIONS, compactInstructions, goalOf, goalReviewerId, sliceSiblings, everyPr, fileGoal, GOAL_LOG, goalEffort, goalRecord, goalTitle, landedNote, leadSystemAppend, moveQueued, nextGoal, reopenedNote, reopenedWork, reposBackNote, qaVerdictNote, sliceBranch, sliceLanded, workspaceNote } from './lead';
import { answerQuestion, askQuestion, QUESTION_LIMITS } from './leadRules';

const work: LeadWork = {
  station: 1,
  title: 'Saved items',
  repos: [
    { repo: 'acme/web', folder: 'web', baseBranch: 'main' },
    { repo: 'acme/api', folder: 'api', baseBranch: 'develop' },
  ],
  slice: 2,
  prs: [
    { repo: 'acme/web', number: 12, url: 'u12', outcome: 'merged' },
    { repo: 'acme/api', number: 7, url: 'u7' },
  ],
};

const surname = (name: string) => name.split(' ').at(-1);

describe('a goal’s lead', () => {
  it('is a lieutenant in command red, one per goal, never sharing a surname with the room’s officers or its other leads', () => {
    for (const id of ['p1', 'p2', 'shop', 'thomas']) {
      const first = leadFor(id, 'g1');
      expect(first.avatar.division).toBe('command');
      expect(first.name).toMatch(/^Lt\. /);
      expect([plannerFor(id), qaOfficerFor(id)].map((o) => surname(o.name))).not.toContain(surname(first.name));
      expect(leadFor(id, 'g1')).toEqual(first);
      const others = [first.name, leadFor(id, 'g2').name, leadFor(id, 'g3').name];
      expect(others.map(surname)).not.toContain(surname(leadFor(id, 'g4', others).name));
    }
    expect(leadId('p1', 'ab12')).toBe('lead_p1_ab12');
  });

  it('calls the goal by the captain’s first line, cut at a word', () => {
    expect(goalTitle('Shoppers can save items for later.\nAnd find them on any device')).toBe('Shoppers can save items for later');
    expect(goalTitle('\n\n  Stock   levels  ')).toBe('Stock levels');
    expect(goalTitle('   ')).toBe('A new goal');
    const long = goalTitle('Let shoppers save items for later from the cart and the product page, then find them again on any device');
    expect(long).toBe('Let shoppers save items for later from the cart and the…');
    expect(long.length).toBeLessThanOrEqual(61);
  });

  it('works at the effort the captain picked, else Focus’s default for leads', () => {
    expect(goalEffort(undefined, { leadEffort: 'high' })).toBe('high');
    expect(goalEffort('xhigh', { leadEffort: 'high' })).toBe('xhigh');
  });
});

describe('slices', () => {
  it('gets a fresh branch each slice, named after the goal', () => {
    expect(sliceBranch('Shoppers can save items for later', 3, 'ab12')).toBe('focus/shoppers-can-save-items-3-ab12');
    expect(sliceBranch('Show how many of each sock are left', 1, 'cd')).toBe('focus/show-how-many-of-each-1-cd');
    expect(sliceBranch('Internationalisation', 2, 'x')).toBe('focus/internationalisation-2-x');
    expect(sliceBranch('Supercalifragilisticexpialidocious', 1, 'x')).toBe('focus/supercalifragilisticexpi-1-x');
    expect(sliceBranch('!!!', 1, 'x')).toBe('focus/goal-1-x');
  });

  it('lands once it shipped and every pull request has merged or closed', () => {
    expect(sliceLanded(work.prs)).toBe(false);
    expect(sliceLanded([...work.prs.slice(0, 1), { ...work.prs[1], outcome: 'closed' }])).toBe(true);
    expect(sliceLanded([])).toBe(false);
  });
});

describe('what the lead writes and hears', () => {
  it('works across every repo, opens its own pull requests with gh, ready when they’re ready, and never pushes a base branch', () => {
    const prompt = leadSystemAppend({ name: 'Lt. Okafor' }, 'Shop', 1);
    expect(prompt).toMatch(/^# You are Lt\. Okafor, a lead on Shop/);
    expect(prompt).toContain('team station 2');
    expect(prompt).toMatch(/Other leads may be working in the same repos at the same time/);
    expect(prompt).toMatch(/Don't write a spec or plan the whole route/);
    expect(prompt).toMatch(/Keep pull requests reviewable: small enough to review and merge cleanly/);
    expect(prompt).not.toContain('mcp__office__ship');
    expect(prompt).toMatch(/push your branches and open pull requests yourself with gh/);
    expect(prompt).toMatch(/`gh pr create --draft`.*`gh pr ready`/);
    expect(prompt).toMatch(/Never push a base branch, or a branch whose pull request has merged/);
    expect(prompt).toContain('mcp__office__recap');
    expect(prompt).toMatch(/Hand independent work, and broad exploration, to subagents with the Agent tool, and keep their conclusions/);
    expect(prompt).toMatch(/Keep the goal's brief in \.\/brief\.md, at the root of your workspace beside the repos/);
    expect(prompt).not.toContain('mcp__office__note');
    expect(prompt).toMatch(/When what done looks like is met, or nothing worthwhile is left, say so with mcp__office__propose_close/);
    expect(prompt).toMatch(/You hear when a slice's pull requests have all merged or closed; your checkouts stay as they are/);
  });

  it('draws the star chart from what the lead does, not from a checklist in the note', () => {
    const prompt = leadSystemAppend({ name: 'Lt. Okafor' }, 'Shop', 1);
    expect(prompt).toContain("The goal's star chart is drawn from what you do: your task list (Claude Code's task tools), your commits and your pull requests.");
    expect(prompt).not.toMatch(/checklist|heading/);
  });

  it('keeps what changes from slice to slice out of its instructions, which a resumed session never re-reads', () => {
    const prompt = leadSystemAppend({ name: 'Lt. Okafor' }, 'Shop', 1);
    expect(prompt).not.toMatch(/focus\//);
    expect(prompt).not.toMatch(/^- \.\//m);
    expect(workspaceNote(work, 'focus/saved-items-2-ab')).toBe(
      'Your workspace, with every repo of the project checked out side by side:\n- ./web: acme/web, on branch `focus/saved-items-2-ab` from `main`\n- ./api: acme/api, on branch `focus/saved-items-2-ab` from `develop`',
    );
  });

  it('passes on QA’s verdict as a note, with what to fix on a fail, leaving when to whoever wakes them', () => {
    expect(qaVerdictNote('acme/api', 7, { verdict: 'fail', summary: 'Empty list crashes', fixInstructions: 'Guard the empty case' })).toBe(
      'QA failed acme/api#7: Empty list crashes\n\nWhat to fix: Guard the empty case',
    );
    // nothing on when to fix it, which would contradict the message it comes with (the plugin's: fix it now)
    expect(qaVerdictNote('acme/api', 7, { verdict: 'fail', summary: 'Broken' })).not.toMatch(/wait|asked/i);
    expect(qaVerdictNote('acme/web', 12, { verdict: 'pass', summary: 'Works' })).toMatch(/^QA passed acme\/web#12: Works\n\nIt waits for the captain to merge it\.$/);
    // a verdict on a commit the lead has shipped past says so, and that QA is on the latest
    expect(qaVerdictNote('acme/web', 12, { verdict: 'fail', summary: 'Broken' }, { tested: '815552ff4dd1', shipped: 'd01f0319aae5' })).toBe(
      'QA failed acme/web#12 at 815552f, before your last ship (d01f031): Broken\n\nQA is reviewing d01f031 now, and you\'ll hear that verdict too. Fix only what your last ship didn\'t already.',
    );
  });

  it('passes on a fail without proof as a pass with advice, and a proved fail with the test to keep', () => {
    const advice = qaVerdictNote('acme/web', 12, { verdict: 'pass', advisory: true, summary: 'Double clicks save twice', fixInstructions: 'Debounce it' });
    expect(advice).toBe('QA passed (with advice: it found problems, but no proof held) acme/web#12: Double clicks save twice\n\nQA\'s advice, yours to take or leave: Debounce it\n\nIt waits for the captain to merge it.');
    const proved = qaVerdictNote('acme/web', 12, { verdict: 'fail', summary: 'Broken', fixInstructions: 'Guard it', proofs: [{ kind: 'test', finding: 'Empty list crashes', file: 'a.proof.test.ts', command: 'vitest run a.proof.test.ts', outcome: 'failed', source: 'it("x")' }] });
    expect(proved).toContain('What to fix: Guard it\n\nQA proved it');
    expect(proved).toContain('it("x")');
  });

  it('tells the lead when the slice has landed, and that their checkouts stay as they are, without telling them to act on it', () => {
    const landed = { ...work, prs: [work.prs[0], { ...work.prs[1], outcome: 'closed' as const }] };
    // a note, heard with the next message they get: mid-turn or as a turn starts
    expect(landedNote(landed)).toBe(
      'Slice 2 has landed: acme/web#12 merged, acme/api#7 was closed unmerged. Your checkouts stay as they are: start what\'s next on a fresh branch from the base, since a push to a branch whose pull request merged is refused.',
    );
    expect(landedNote(landed)).not.toMatch(/Carry on/);
  });

  it('tells a lead whose repos were checked out again where they are, and that unshipped commits stayed behind', () => {
    const text = reposBackNote({ ...work, slice: 3, prs: [] }, 'focus/saved-items-3-cd');
    expect(text).toMatch(/^\[Ops\] Your repos are checked out again/);
    expect(text).toContain('fresh code for slice 3');
    expect(text).toContain('- ./api: acme/api, on branch `focus/saved-items-3-cd` from `develop`');
    expect(text).toContain("commits you hadn't shipped didn't come along");
  });
});

describe('applyHelperEvent', () => {
  const started = applyHelperEvent([], { kind: 'started', id: 't1', description: 'Map the cart store', type: 'Explore' }, 5);

  it('stamps a new helper with the lead’s effort, and its model once it reports one', () => {
    const seated = applyHelperEvent([], { kind: 'started', id: 't1', description: 'Map' }, 5, 'high');
    expect(seated[0].effort).toBe('high');
    const modelled = applyHelperEvent(seated, { kind: 'model', id: 't1', model: 'claude-sonnet-5-5' }, 6);
    expect(modelled[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' });
    expect(applyHelperEvent(modelled, { kind: 'model', id: 't1', model: 'claude-sonnet-5-5' }, 7)).toBe(modelled);
  });

  it('seats a new helper, once', () => {
    expect(started).toEqual([{ id: 't1', description: 'Map the cart store', type: 'Explore', status: 'working', activity: 'Getting started', startedAt: 5 }]);
    expect(applyHelperEvent(started, { kind: 'started', id: 't1', description: 'again' }, 6)).toBe(started);
  });

  it('keeps up with what a working helper is doing, and ignores helpers it doesn’t know', () => {
    expect(applyHelperEvent(started, { kind: 'activity', id: 't1', activity: 'Reading cart.ts' }, 6)[0].activity).toBe('Reading cart.ts');
    expect(applyHelperEvent(started, { kind: 'activity', id: 'nope', activity: 'x' }, 6)).toBe(started);
  });

  it('says how a helper finished, and stops listening to it after that', () => {
    const done = applyHelperEvent(started, { kind: 'ended', id: 't1', ok: true, summary: 'The store holds a list\nmore' }, 7);
    expect(done[0]).toMatchObject({ status: 'done', activity: 'The store holds a list' });
    expect(applyHelperEvent(done, { kind: 'activity', id: 't1', activity: 'late' }, 8)).toBe(done);
    expect(applyHelperEvent(started, { kind: 'ended', id: 't1', ok: false }, 7)[0]).toMatchObject({ status: 'failed', activity: 'Hit a problem' });
  });
});

describe('helperChange', () => {
  const charted: LeadWork = { ...work, slice: 1, waypoints: [{ slice: 1, startedAt: 1 }] };
  const send = { kind: 'started', id: 't1', description: 'Map the cart store', type: 'Explore' } as const;
  const sent = helperChange({ lead: charted, effort: 'high' }, send, 5)!;

  it('seats a helper the lead sends out, and launches its probe from the slice under way', () => {
    expect(sent.helpers).toEqual([{ id: 't1', description: 'Map the cart store', type: 'Explore', effort: 'high', status: 'working', activity: 'Getting started', startedAt: 5 }]);
    expect(sent.lead).toEqual({ ...charted, waypoints: [{ slice: 1, startedAt: 1, probes: [{ id: 't1', description: 'Map the cart store', type: 'Explore', launchedAt: 5 }] }] });
  });

  it('ends its probe with how it went when it reports back', () => {
    const back = helperChange(sent, { kind: 'ended', id: 't1', ok: true, summary: 'The store holds a list' }, 9)!;
    expect(back.helpers?.[0]).toMatchObject({ status: 'done', activity: 'The store holds a list' });
    expect(back.lead?.waypoints?.[0].probes).toEqual([{ id: 't1', description: 'Map the cart store', type: 'Explore', launchedAt: 5, endedAt: 9, ok: true, summary: 'The store holds a list' }]);
  });

  it('leaves the chart alone for what a helper is doing, or a helper with no probe on it', () => {
    expect(helperChange(sent, { kind: 'activity', id: 't1', activity: 'Reading cart.ts' }, 6)).toEqual({ helpers: [{ ...sent.helpers![0], activity: 'Reading cart.ts' }] });
    // sent out before the lead had a goal's work to chart, or launched before the chart kept probes
    expect(helperChange({}, send, 5)).toEqual({ helpers: [expect.objectContaining({ id: 't1' })] });
    expect(helperChange({ ...sent, lead: charted }, { kind: 'ended', id: 't1', ok: false }, 9)).toEqual({ helpers: [expect.objectContaining({ status: 'failed' })] });
  });

  it('changes nothing for a helper it already has seated, or doesn’t know', () => {
    expect(helperChange(sent, send, 6)).toBeUndefined();
    expect(helperChange(sent, { kind: 'activity', id: 'nope', activity: 'x' }, 6)).toBeUndefined();
  });
});

describe('taskChange', () => {
  const add = { name: 'TaskCreate', input: { subject: 'Probe the SDK' }, result: { task: { id: '1', subject: 'Probe the SDK' } } };
  const probe = { id: '1', subject: 'Probe the SDK', status: 'pending' } as const;

  it('keeps a lead’s new task on its list and on the slice’s waypoint', () => {
    const charted: LeadWork = { ...work, waypoints: [{ slice: 2, startedAt: 1 }] };
    expect(taskChange({ task: 'lead', lead: charted }, add, 5)).toEqual({ tasks: [probe], lead: { ...charted, waypoints: [{ slice: 2, startedAt: 1, tasks: [probe] }] } });
  });

  it('keeps anyone else’s on their list alone: they have no chart', () => {
    expect(taskChange({ task: 'issue', lead: work }, add, 5)).toEqual({ tasks: [probe] });
  });

  it('leaves the chart alone when the list changes but nothing the slice keeps does', () => {
    const charted: LeadWork = { ...work, waypoints: [{ slice: 2, startedAt: 1, tasks: [probe] }] };
    // a new session starts its own list: what the slice did stays on its waypoint
    expect(taskChange({ task: 'lead', lead: charted }, { name: 'TodoWrite', input: { todos: [] } }, 5)).toEqual({ tasks: [] });
  });

  it('changes nothing for a call that left the list as it was, or a tool it doesn’t follow', () => {
    expect(taskChange({ task: 'lead', lead: work, tasks: [probe] }, { name: 'Read', input: {} }, 5)).toBeUndefined();
  });
});

describe('backgroundStop', () => {
  const task = { id: 'b1', kind: 'shell', description: 'pnpm test', status: 'running', startedAt: 5 } as const;

  it('tells the lead which command or monitor the captain stopped', () => {
    expect(backgroundStop({ background: [task] }, 'b1')).toEqual({ note: 'I stopped your background command `pnpm test`. Start it again if you still need it.' });
    expect(backgroundStop({ background: [{ ...task, kind: 'monitor', description: 'the deploy log' }] }, 'b1')).toEqual({
      note: 'I stopped your monitor (the deploy log). Start it again if you still need it.',
    });
  });

  it('is for nothing once the task has ended, for another task, or for an agent who isn’t there', () => {
    for (const status of ['done', 'failed', 'stopped'] as const) expect(backgroundStop({ background: [{ ...task, status }] }, 'b1')).toBeUndefined();
    expect(backgroundStop({ background: [task] }, 'b2')).toBeUndefined();
    expect(backgroundStop({}, 'b1')).toBeUndefined();
    expect(backgroundStop(undefined, 'b1')).toBeUndefined();
  });
});

describe('backgroundChange', () => {
  const started = { kind: 'started', id: 'b1', task: 'shell', description: 'pnpm test' } as const;

  it('floats a lead’s new command by their chair, and says how it ended', () => {
    const up = backgroundChange({ task: 'lead' }, started, 5);
    expect(up).toEqual({ background: [{ id: 'b1', kind: 'shell', description: 'pnpm test', status: 'running', startedAt: 5 }] });
    expect(backgroundChange({ task: 'lead', ...up }, { kind: 'ended', id: 'b1', status: 'done', summary: 'passed' }, 9)?.background).toEqual([
      { id: 'b1', kind: 'shell', description: 'pnpm test', status: 'done', startedAt: 5, endedAt: 9, summary: 'passed' },
    ]);
  });

  it('changes nothing for anyone but a lead, where its output goes, or one it already has', () => {
    expect(backgroundChange({ task: 'issue' }, started, 5)).toBeUndefined();
    expect(backgroundChange({ task: 'lead' }, { kind: 'output', id: 'b1', file: '/tmp/b1.output' }, 5)).toBeUndefined();
    const up = backgroundChange({ task: 'lead' }, started, 5);
    expect(backgroundChange({ task: 'lead', ...up }, started, 6)).toBeUndefined();
  });
});

describe('workflowChange', () => {
  const started = { kind: 'started', id: 'w1', name: 'review', description: 'Review the slice' } as const;

  it('beams a lead’s new workflow into its briefing room, and says how it ended', () => {
    const up = workflowChange({ task: 'lead' }, started, 5);
    expect(up?.workflows).toEqual([expect.objectContaining({ id: 'w1', name: 'review', status: 'running', startedAt: 5 })]);
    expect(workflowChange({ task: 'lead', ...up }, { kind: 'ended', id: 'w1', ok: true }, 9)?.workflows).toEqual([expect.objectContaining({ id: 'w1', status: 'done' })]);
  });

  it('changes nothing for anyone but a lead, or a workflow it doesn’t know', () => {
    expect(workflowChange({ task: 'issue' }, started, 5)).toBeUndefined();
    expect(workflowChange({ task: 'lead' }, { kind: 'ended', id: 'nope', ok: true }, 5)).toBeUndefined();
  });
});

describe('the goal as the captain first put it', () => {
  it('is kept whole up to a limit, so it outlives the conversation', () => {
    expect(goalBrief('Let shoppers save items for later.\n\nThey should survive a reload.\n')).toBe('Let shoppers save items for later.\n\nThey should survive a reload.');
    expect(goalBrief('x'.repeat(BRIEF_LIMIT + 50))).toHaveLength(BRIEF_LIMIT + 1);
  });
});

describe('closing a goal', () => {
  it('files the goal in the room’s log, newest first, keeping a few dozen', () => {
    const lead = { id: 'lead_p1_ab', name: 'Lt. Okafor', sessionId: 's1', branch: 'focus/saved-items-2-ab12', startedAt: 10, lead: work } as LeadAgent;
    const record = goalRecord(lead, 99);
    expect(record).toEqual({
      id: 'lead_p1_ab', title: 'Saved items', note: undefined, slices: 2, prs: work.prs.map((p) => ({ ...p, slice: 2 })), slice: 2, leadName: 'Lt. Okafor', sessionId: 's1',
      brief: undefined, branch: 'focus/saved-items-2-ab12', repos: work.repos, openedAt: 10, closedAt: 99,
    });
    // closed before the new slice shipped anything: that one doesn't count
    expect(goalRecord({ ...lead, lead: { ...work, slice: 3, prs: [] } }, 99).slices).toBe(2);
    const full = Array.from({ length: GOAL_LOG }, (_, i) => ({ ...record, id: `g${i}` }));
    const log = fileGoal(full, record);
    expect(log).toHaveLength(GOAL_LOG);
    expect(log[0]).toBe(record);
    expect(log.at(-1)?.id).toBe(`g${GOAL_LOG - 2}`);
  });

  it('keeps the pull requests of every slice it shipped, not just the last', () => {
    const first = { repo: 'acme/web', number: 3, url: 'u3', outcome: 'merged' as const };
    const second = { repo: 'acme/api', number: 5, url: 'u5', outcome: 'merged' as const };
    // slice 1 lands, and the next slice starts with no pull requests of its own
    const slice1: LeadWork = { ...work, slice: 1, prs: [first] };
    const slice2: LeadWork = { ...slice1, slice: 2, prs: [second], landed: everyPr(slice1) };
    const lead = { id: 'lead_p1_ab', name: 'Lt. Okafor', startedAt: 10, lead: slice2 } as LeadAgent;
    const record = goalRecord(lead, 99);
    expect(record.prs).toEqual([{ ...first, slice: 1 }, { ...second, slice: 2 }]);
    expect(record.slices).toBe(2);
    // slice 2 lands too, and the goal closes on slice 3 before it ships anything
    const slice3: LeadWork = { ...slice2, slice: 3, prs: [], landed: everyPr(slice2) };
    expect(goalRecord({ ...lead, lead: slice3 }, 99)).toMatchObject({ slices: 2, slice: 3, prs: [{ ...first, slice: 1 }, { ...second, slice: 2 }] });
  });
});

describe('reopening a closed goal', () => {
  const lead = { id: 'lead_p1_ab', name: 'Lt. Okafor', sessionId: 's1', branch: 'focus/saved-items-2-ab12', startedAt: 10, lead: { ...work, brief: 'Saved items\nAcross devices' } } as LeadAgent;
  const closedAt = Date.UTC(2026, 9, 7, 12);

  it('picks up the slice it was on, with its pull requests, at its new station', () => {
    const record = goalRecord(lead, closedAt);
    expect(reopenedWork(record, 3)).toEqual({
      station: 3, title: 'Saved items', brief: 'Saved items\nAcross devices', note: undefined, repos: work.repos, slice: 2, prs: work.prs.map((p) => ({ ...p, slice: 2 })), reopening: { closedAt },
    });
    // closed before the new slice shipped anything: it's that slice again, with the earlier slices' pull requests kept
    const unshipped = goalRecord({ ...lead, lead: { ...work, slice: 3, prs: [], landed: everyPr(work) } }, closedAt);
    expect(reopenedWork(unshipped, 0)).toMatchObject({ slice: 3, prs: [], landed: everyPr(work) });
    expect(goalRecord({ ...lead, lead: reopenedWork(unshipped, 0) }, closedAt).prs).toEqual(unshipped.prs);
    // closed before goals kept their slice: what it kept is the last slice's
    const old = { ...record, slice: undefined, prs: work.prs };
    expect(reopenedWork(old, 0)).toMatchObject({ slice: 2, prs: work.prs });
    expect(reopenedWork(old, 0).landed).toBeUndefined();
  });

  it('keeps what the lead showed and asked with the closed goal, and brings it back when it reopens', () => {
    const artifacts = [{ id: 'data-flow', title: 'Data flow', at: 1, image: true }];
    const questions = [{ id: 'q1', question: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], at: 2, answer: { option: 'b', at: 3 } }];
    const record = goalRecord({ ...lead, lead: { ...work, artifacts, questions } }, closedAt);
    expect(record).toMatchObject({ artifacts, questions });
    expect(reopenedWork(record, 1)).toMatchObject({ artifacts, questions });
    // nothing shown: nothing kept
    expect(goalRecord(lead, closedAt)).not.toHaveProperty('artifacts');
    expect(reopenedWork(goalRecord(lead, closedAt), 1)).not.toHaveProperty('questions');
  });

  it('keeps the lead’s brief with the closed goal, and has a reopened goal’s lead write it back', () => {
    const briefMd = '# Saved items\n\n## Next\n\n- Header';
    const record = goalRecord({ ...lead, lead: { ...work, briefMd } }, closedAt);
    expect(record.briefMd).toBe(briefMd);
    const again = reopenedWork(record, 0);
    expect(again.briefMd).toBe(briefMd);
    expect(reopenedNote(again, 'focus/saved-items-2-ab12', closedAt)).toMatch(/acme\/api#7\.\n\nIf \.\/brief\.md isn't there any more, write it back as it was:\n\n```markdown\n# Saved items\n\n## Next\n\n- Header\n```\n\nTell the captain/);
    expect(goalRecord(lead, closedAt)).not.toHaveProperty('briefMd');
  });

  it('tells the lead where their repos are, and where uncommitted work went', () => {
    const record = goalRecord(lead, closedAt);
    const again = reopenedWork(record, 0);
    expect(reopenedNote(again, 'focus/saved-items-2-ab12', record.closedAt)).toBe(
      '[Ops] The captain reopened this goal, closed on 2026-10-07. Your repos are checked out again on `focus/saved-items-2-ab12`, as you left them: ./web, ./api. ' +
      'If you had uncommitted work when it closed, it\'s the commit “WIP: uncommitted work when the goal “Saved items” closed” at the tip: build on it, or `git reset HEAD~1` to have it uncommitted again. ' +
      'Still open on GitHub: acme/api#7. Tell the captain where the goal stands and what you\'d do next.',
    );
    // the slice landed while it was closed: the next one starts on fresh code
    const landed = { ...again, prs: work.prs.map((p) => ({ ...p, outcome: 'merged' as const })) };
    expect(reopenedNote(landed, 'focus/saved-items-2-ab12', record.closedAt)).toMatch(/Its last slice had landed, so the next one starts on fresh code, as above\. .* came along with any others you hadn't shipped\. Tell the captain/);
  });
});

describe('the goal queue', () => {
  const q = (id: string) => ({ id, text: id, at: 0 });
  const line = [q('a'), q('b'), q('c')];

  it('offers the first goal in line', () => {
    expect(nextGoal(line)?.id).toBe('a');
    expect(nextGoal([])).toBeUndefined();
    expect(nextGoal(undefined)).toBeUndefined();
  });

  it('moves a goal sooner or later, staying in the line', () => {
    expect(moveQueued(line, 'c', -1).map((g) => g.id)).toEqual(['a', 'c', 'b']);
    expect(moveQueued(line, 'a', -1).map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect(moveQueued(line, 'b', 1).map((g) => g.id)).toEqual(['a', 'c', 'b']);
    expect(moveQueued(line, 'zz', 1)).toBe(line);
  });
});

describe('a goal’s own QA reviewer', () => {
  it('is in sciences, the same for the same goal, never sharing a surname with anyone else in the room', () => {
    for (const id of ['p1', 'shop']) {
      const others = [leadFor(id, 'g1').name, leadFor(id, 'g2').name];
      const reviewer = qaFor(id, 'g1', others);
      expect(reviewer.avatar.division).toBe('sciences');
      expect(qaFor(id, 'g1', others)).toEqual(reviewer);
      expect([plannerFor(id), qaOfficerFor(id), ...others.map((name) => ({ name }))].map((o) => surname(o.name))).not.toContain(surname(reviewer.name));
    }
    expect(goalReviewerId('lead_p1_ab')).toBe('qa_lead_p1_ab');
  });

  it('reviews the pull requests its goal’s lead shipped, and nobody else’s', () => {
    const lead = { id: 'lead_p1_ab', task: 'lead', lead: work } as Agent;
    const developer = { id: 'agent_x', task: 'issue', pr: { number: 3 } } as Agent;
    expect(goalOf({ repo: 'acme/api', number: 7 }, [developer, lead])).toBe(lead);
    expect(goalOf({ repo: 'acme/api', number: 3 }, [developer, lead])).toBeUndefined();
  });

  it('tests a PR beside the other repos’ PRs of the same slice, and nothing else', () => {
    const prs = [
      { repo: 'acme/api', number: 7, url: '', sha: 'a1', branch: 'focus/s' },
      { repo: 'acme/web', number: 40, url: '', sha: 'b2', branch: 'focus/s' },
      { repo: 'acme/docs', number: 3, url: '', sha: 'c3', branch: 'focus/s' },
    ];
    const lead = { id: 'lead_p1_ab', task: 'lead', lead: { ...work, prs } } as Agent;
    expect(sliceSiblings({ repo: 'acme/api', number: 7 }, lead).map((p) => `${p.repo}#${p.number}`)).toEqual(['acme/web#40', 'acme/docs#3']);
    // a PR the goal didn't ship, or no goal at all: tested on its own
    expect(sliceSiblings({ repo: 'acme/api', number: 8 }, lead)).toEqual([]);
    expect(sliceSiblings({ repo: 'acme/api', number: 7 }, undefined)).toEqual([]);
    const alone = { ...lead, lead: { ...work, prs: [prs[0]] } } as Agent;
    expect(sliceSiblings({ repo: 'acme/api', number: 7 }, alone)).toEqual([]);
  });
});

describe('the lead’s context', () => {
  it('keeps the goal, the decisions and the lessons, drops the details, and carries the brief', () => {
    const keep = compactInstructions({ title: 'Saved items', brief: 'Let shoppers save items for later', briefMd: '# Saved items\n\n## Done looks like\n\nWorks anywhere\n\n## Learned\n\n- Store is fine' });
    expect(keep).toMatch(/^Summarise this conversation for the lead of the goal "Saved items"/);
    expect(keep).toMatch(/Keep: the goal, what the captain asked for and what done looks like; the decisions made and why/);
    expect(keep).toMatch(/Drop: file contents, diffs, command and tool output/);
    expect(keep).toMatch(/the code and \.\/brief\.md hold it now/);
    expect(keep).toContain('Your brief, ./brief.md, as it stands:\n\n# Saved items\n\n## Done looks like\n\nWorks anywhere');
    expect(keep).toContain('As the captain first put it:\n> Let shoppers save items for later');
    expect(COMPACT_INSTRUCTIONS).toMatch(/keep the task, what you have done and decided and why, and what is left/);
  });
});

describe('a slice’s merge conflicts', () => {
  const pr = { repo: 'acme/web', number: 12, baseBranch: 'main', branch: 'focus/goal-1' };

  it('are resolved without the lead, who hears to pull before touching the repo again', () => {
    const note = conflictsResolvedNote(pr, 'web', 'Ensign Kim');
    expect(note).toMatch(/^acme\/web#12 had merge conflicts with `main`: Ensign Kim merged `main` into `focus\/goal-1` and pushed it, so \.\/web is behind GitHub\./);
    expect(note).toContain('`git -C web pull --no-rebase origin focus/goal-1`');
    expect(note).toContain("Ops won't ship that repo");
  });

  it('tells the lead a developer is fixing QA’s fail without them, and to leave the branch be', () => {
    const note = fixingNote('Ensign Kim', 'acme/web', 12);
    expect(note).toMatch(/^Ensign Kim is fixing it on a branch of their own/);
    expect(note).toContain('Leave that branch be');
  });

  it('tells the lead the fix is pushed and to pull before touching the repo', () => {
    const note = fixPushedNote({ repo: 'acme/web', number: 12, branch: 'focus/goal-1' }, 'web', 'Ensign Kim', 'abcdef1234');
    expect(note).toMatch(/^Ensign Kim fixed what QA found on acme\/web#12 and pushed it \(abcdef1\) to `focus\/goal-1`, so \.\/web is behind GitHub\./);
    expect(note).toContain('`git -C web pull --no-rebase origin focus/goal-1`');
  });

  it('hands QA’s findings back to the lead with why the fix didn’t land', () => {
    expect(fixHandedBackNote('acme/web', 12, { summary: 'The cart forgets items', fixInstructions: 'Persist them' }, 'Ensign Kim pushed no fix'))
      .toBe("QA's fail on acme/web#12 is yours again: Ensign Kim pushed no fix. QA said: The cart forgets items\n\nWhat to fix: Persist them");
  });

});

describe('a lead’s first message in a new conversation', () => {
  const goal: LeadWork = { ...work, brief: 'Let shoppers save items for later', slice: 2, briefMd: '# Saved items\n\n## Done looks like\n\nSaved items survive a reload' };

  it('is the captain’s words and where the repos are, for a new goal', () => {
    expect(freshSessionPrompt(goal, 'focus/saved-1-ab', ['Let shoppers save items for later', 'Web first'], false)).toBe(
      `${workspaceNote(goal, 'focus/saved-1-ab')}\n\nLet shoppers save items for later\n\nWeb first`,
    );
  });

  it('says where the goal stands when the conversation before couldn’t be picked back up', () => {
    const text = freshSessionPrompt(goal, 'focus/saved-2-ab', ['[Ops] Slice 1 has landed'], false);
    expect(text).toMatch(/^Your workspace, with every repo/);
    expect(text).toContain("You're carrying on with this goal in a new conversation");
    expect(text).toContain('The goal: Saved items\n\nAs the captain first put it:\n> Let shoppers save items for later\n\nYour brief, ./brief.md, as it stands:\n\n# Saved items\n\n## Done looks like\n\nSaved items survive a reload');
    expect(text).toMatch(/\[Ops\] Slice 1 has landed$/);
    // a slice that has landed: the new slice's note says where the repos are and where the goal stands
    expect(freshSessionPrompt(goal, 'focus/saved-1-ab', [], true)).toBe(
      "You're carrying on with this goal in a new conversation: the one before couldn't be picked back up.\n\nLook over the repos, then tell the captain where you think the goal stands and what you'd do next.",
    );
  });
});

describe('pageErrorsNote', () => {
  it('says nothing when the page loaded cleanly', () => {
    expect(pageErrorsNote([])).toBe('');
    expect(pageErrorsNote(['  '])).toBe('');
  });

  it('quotes the first few distinct errors, cut short, and asks for it again under the same id', () => {
    expect(pageErrorsNote(['ReferenceError: nope', 'ReferenceError:  nope'])).toBe(' But the page reported an error as it loaded: “ReferenceError: nope”. Fix it and show it again under the same id.');
    const note = pageErrorsNote(['a', 'b', 'c', 'd', 'x'.repeat(300)]);
    expect(note).toContain('errors as it loaded (and 2 more): “a”; “b”; “c”');
    expect(pageErrorsNote(['x'.repeat(300)])).toContain(`“${'x'.repeat(199)}…”`);
  });
});

describe('questions', () => {
  const options = [{ label: 'Cards', html: '<p>A</p>' }, { label: ' Plain   list ', html: '<p>B</p>' }];
  const ask = (questions: Parameters<typeof askQuestion>[0], question = 'Which layout?') => {
    const asked = askQuestion(questions, { question, options }, 5);
    if ('error' in asked) throw new Error(asked.error);
    return asked;
  };

  it('settles the open question when the captain replies in chat, keeping what they said and picking nothing', () => {
    const { questions } = ask([]);
    const settled = answerInChat(questions, '  Go with B, but keep the header  ', 7);
    expect(settled).toEqual([{ ...questions[0], answer: { note: 'Go with B, but keep the header', at: 7 } }]);
    expect(answerInChat(questions, 'x'.repeat(QUESTION_LIMITS.note + 50), 7)[0].answer?.note).toHaveLength(QUESTION_LIMITS.note);
    expect(answerQuestion(settled, 'q1', 'b', undefined, 8)).toEqual({ error: 'You already answered it in chat' });
  });

  it('leaves the questions as they are when none is open', () => {
    const picked = answerQuestion(ask([]).questions, 'q1', 'a', undefined, 2);
    const answered = 'error' in picked ? [] : picked.questions;
    expect(answerInChat(answered, 'Thanks', 9)).toEqual(answered);
    expect(answerInChat([], 'Hello', 9)).toEqual([]);
  });
});
