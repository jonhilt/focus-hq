import { describe, expect, it } from 'vitest';
import { leadFor, leadId, plannerFor, qaFor, qaOfficerFor } from '../../shared/crew';
import type { Agent, LeadAgent, LeadWork } from '../../shared/types';
import { afterLanding, afterPush, landedMidShipNote, answerInChat, answerQuestion, pageErrorsNote, ARTIFACT_LIMITS, askQuestion, QUESTION_LIMITS, showArtifact, BRIEF_LIMIT, carriedNote, freshSessionPrompt, goalBrief, afterVerdict, conflictsResolvedNote, behindNote, applyHelperEvent, applyNote, backgroundChange, backgroundStop, helperChange, taskChange, workflowChange, notedGoal, COMPACT_INSTRUCTIONS, compactInstructions, compactsFirst, goalOf, goalReviewerId, reviewsToStart, sliceSiblings, closeCheck, emptyNote, everyPr, fileGoal, GOAL_LOG, goalEffort, goalRecord, goalTitle, hasLeadWork, heldBack, landedMidTurnNote, landedNote, leadPrBody, leadSystemAppend, moveQueued, newSliceNote, nextGoal, noteForPrompt, notShipped, reopenable, reopenedNote, reopenedWork, reposBackNote, openPr, pickStation, qaVerdictNote, queuedStart, shippedSha, shipPlan, shipBranch, sliceBranch, sliceLanded, upgradeLead, workspaceNote, freshBranchNote, needsFreshBranch, repoBranch, workspaceList } from './lead';

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

  it('takes the station asked for if it’s free, else the first free one', () => {
    expect(pickStation([])).toBe(0);
    expect(pickStation([0, 2])).toBe(1);
    expect(pickStation([0, 1, 2, 3])).toBeUndefined();
    expect(pickStation([0], 3)).toBe(3);
    expect(pickStation([3], 3)).toBeUndefined();
    expect(pickStation([], 4)).toBeUndefined();
    expect(pickStation([], -1)).toBeUndefined();
    expect(pickStation([], 1.5)).toBeUndefined();
  });

  it('calls the goal by the captain’s first line, cut at a word', () => {
    expect(goalTitle('Shoppers can save items for later.\nAnd find them on any device')).toBe('Shoppers can save items for later');
    expect(goalTitle('\n\n  Stock   levels  ')).toBe('Stock levels');
    expect(goalTitle('   ')).toBe('A new goal');
    const long = goalTitle('Let shoppers save items for later from the cart and the product page, then find them again on any device');
    expect(long).toBe('Let shoppers save items for later from the cart and the…');
    expect(long.length).toBeLessThanOrEqual(61);
  });

  it('works at the effort the captain picked, else the office’s default for leads', () => {
    expect(goalEffort(undefined, { leadEffort: 'high' })).toBe('high');
    expect(goalEffort('xhigh', { leadEffort: 'high' })).toBe('xhigh');
  });

  it('turns the project’s one lead, saved before goals, into the goal at the first station', () => {
    const old = { id: 'lead_p1', task: 'lead', issue: { number: 0, title: 'Shop’s lead', url: '' }, lead: { repos: [], slice: 3, prs: [] } } as unknown as Agent;
    const upgraded = upgradeLead(old, 'Shop');
    expect(upgraded.lead).toEqual({ station: 0, title: 'Shop’s first goal', repos: [], slice: 3, prs: [] });
    expect(upgraded.issue.title).toBe('Shop’s first goal');
    const current = { ...old, lead: work } as Agent;
    expect(upgradeLead(current, 'Shop')).toBe(current);
    const developer = { id: 'agent_x', task: 'issue' } as Agent;
    expect(upgradeLead(developer, 'Shop')).toBe(developer);
  });

  it('carries the goal’s work only when it has some, which is what lets the lead’s parts read it without asserting', () => {
    expect(hasLeadWork({ id: 'lead_p1_ab12', task: 'lead', lead: work } as Agent)).toBe(true);
    expect(hasLeadWork({ id: 'lead_p1_ab12', task: 'lead' } as Agent)).toBe(false);
    expect(hasLeadWork({ id: 'agent_x', task: 'issue' } as Agent)).toBe(false);
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

  it('names the branch a pull request ships from after the slice’s work, keeping its working branch’s id', () => {
    expect(shipBranch('Name branches after the slice’s work', 'focus/we-need-better-branch-1-96a3')).toBe('focus/name-branches-after-the-slice-s-work-96a3');
    expect(shipBranch('Proposal editor: let the captain reorder sections and keep versions', 'focus/proposal-editor-3-eae1')).toBe('focus/proposal-editor-let-the-captain-reorder-eae1');
    expect(shipBranch('Fix it', 'focus/fresh')).toBe('focus/fix-it-fresh');
    expect(shipBranch('!!!', 'focus/goal-1-x')).toBeUndefined();
  });

  it('lands once it shipped and every pull request has merged or closed', () => {
    expect(sliceLanded(work.prs)).toBe(false);
    expect(sliceLanded([...work.prs.slice(0, 1), { ...work.prs[1], outcome: 'closed' }])).toBe(true);
    expect(sliceLanded([])).toBe(false);
  });

  it('finds the slice’s open pull request in a repo', () => {
    expect(openPr(work, 'acme/api')?.number).toBe(7);
    expect(openPr(work, 'acme/web')).toBeUndefined();
  });

  it('remembers the commit each repo last shipped', () => {
    const prs = [{ repo: 'acme/web', number: 12, url: 'u12', sha: 'aaa', outcome: 'closed' as const }, { repo: 'acme/web', number: 13, url: 'u13', sha: 'bbb' }];
    expect(shippedSha({ ...work, prs }, 'acme/web')).toBe('bbb');
    expect(shippedSha(work, 'acme/api')).toBeUndefined();
  });
});

describe('afterPush', () => {
  const pr = (number: number, more: Partial<LeadWork['prs'][number]> = {}) => ({ repo: 'acme/web', number, url: `u${number}`, sha: 'aaa', ...more });

  it('updates the pull request still open', () => {
    expect(afterPush(pr(12), { prs: [pr(12)] }, 'acme/web')).toEqual({ kind: 'update', pr: pr(12) });
  });

  it('never puts back as open one that merged or closed while the push was under way', () => {
    expect(afterPush(pr(12), { prs: [pr(12, { outcome: 'merged' })] }, 'acme/web')).toEqual({ kind: 'landed', pr: pr(12, { outcome: 'merged' }) });
    expect(afterPush(pr(12), { prs: [pr(12, { outcome: 'closed' })] }, 'acme/web')).toEqual({ kind: 'landed', pr: pr(12, { outcome: 'closed' }) });
  });

  it('finds or opens one when none was open as the ship started', () => {
    expect(afterPush(undefined, { prs: [] }, 'acme/web')).toEqual({ kind: 'open' });
    // a merged one from before the ship started: the repo moved to a fresh branch, which gets its own
    expect(afterPush(undefined, { prs: [pr(12, { outcome: 'merged' })] }, 'acme/web')).toEqual({ kind: 'open' });
    // another repo's open one leaves this one to open its own
    expect(afterPush(undefined, { prs: [pr(7, { repo: 'acme/api' })] }, 'acme/web')).toEqual({ kind: 'open' });
  });

  it('tells the lead where what the push added goes', () => {
    expect(landedMidShipNote({ repo: 'acme/web', number: 12, outcome: 'merged' })).toMatch(/acme\/web#12 was merged while the ship was pushing.*carries them over/);
    expect(landedMidShipNote({ repo: 'acme/web', number: 12, outcome: 'closed' })).toMatch(/was closed.*opens a new pull request/);
  });
});

describe('needsFreshBranch', () => {
  const pr = (number: number, more: Partial<LeadWork['prs'][number]> = {}) => ({ repo: 'acme/web', number, url: `u${number}`, sha: 'aaa', ...more });

  it('starts a fresh branch once a pull request from the branch the repo is on has merged', () => {
    expect(needsFreshBranch({ prs: [pr(12, { branch: 'focus/a', outcome: 'merged' })] }, 'acme/web', 'focus/a')).toBe(true);
    // shipped before the branch was kept: it came from the branch the repo is on
    expect(needsFreshBranch({ prs: [pr(12, { outcome: 'merged' })] }, 'acme/web', 'focus/a')).toBe(true);
  });

  it('keeps the branch while it has an open pull request, or never had one merged', () => {
    expect(needsFreshBranch({ prs: [] }, 'acme/web', 'focus/a')).toBe(false);
    expect(needsFreshBranch({ prs: [pr(12, { branch: 'focus/a' })] }, 'acme/web', 'focus/a')).toBe(false);
    // closed unmerged: none of its commits are on the base, so the branch can ship again
    expect(needsFreshBranch({ prs: [pr(12, { branch: 'focus/a', outcome: 'closed' })] }, 'acme/web', 'focus/a')).toBe(false);
    // another repo's merged pull request leaves this one alone
    expect(needsFreshBranch({ prs: [pr(12, { repo: 'acme/api', branch: 'focus/a', outcome: 'merged' })] }, 'acme/web', 'focus/a')).toBe(false);
  });

  it('leaves a repo already on a fresh branch there, until a pull request from that one merges too', () => {
    const merged = pr(12, { branch: 'focus/a', outcome: 'merged' });
    expect(needsFreshBranch({ prs: [merged] }, 'acme/web', 'focus/b')).toBe(false);
    expect(needsFreshBranch({ prs: [merged, pr(13, { branch: 'focus/b' })] }, 'acme/web', 'focus/b')).toBe(false);
    expect(needsFreshBranch({ prs: [merged, pr(13, { branch: 'focus/b', outcome: 'merged' })] }, 'acme/web', 'focus/b')).toBe(true);
  });

  it('says where each repo is, and what came of the commits it hadn’t shipped', () => {
    const moved = { ...work, repos: [{ ...work.repos[0], branch: 'focus/b' }, work.repos[1]] };
    expect(repoBranch(moved.repos[0], 'focus/a')).toBe('focus/b');
    expect(workspaceList(moved, 'focus/a')).toBe('- ./web: acme/web, on branch `focus/b` from `main`\n- ./api: acme/api, on branch `focus/a` from `develop`');
    const fresh = { folder: 'web', from: 'focus/a', to: 'focus/b', baseBranch: 'main' };
    expect(freshBranchNote({ ...fresh, commits: [], applied: true })).toBe("./web's pull request from `focus/a` has merged, so the office moved it to a new branch, `focus/b`, from fresh `main`.");
    expect(freshBranchNote({ ...fresh, commits: ['c1', 'c2'], applied: true })).toMatch(/and brought along the 2 commits you hadn't shipped\.$/);
    expect(freshBranchNote({ ...fresh, commits: ['0123456789abcdef'], applied: false })).toMatch(/only on `focus\/a`\. Bring it over with `git -C web cherry-pick 0123456789`, resolve the conflicts, then ship again\.$/);
  });
});

describe('shipPlan', () => {
  const state = (folder: string, dirty: boolean, ahead: number, changed = true) => ({ repo: `acme/${folder}`, folder, dirty, ahead, changed });

  it('ships every repo with commits, and only those', () => {
    expect(shipPlan([state('web', false, 2), state('api', false, 0), state('admin', false, 1)])).toEqual({ kind: 'ship', repos: ['acme/web', 'acme/admin'] });
  });

  it('ships nothing while any repo has uncommitted changes', () => {
    const plan = shipPlan([state('web', true, 2), state('api', false, 1)]);
    expect(plan).toEqual({ kind: 'commit-first', folders: ['web'] });
    expect(notShipped(plan as Exclude<typeof plan, { kind: 'ship' }>)).toMatch(/^Nothing shipped: \.\/web has uncommitted changes/);
  });

  it('leaves a repo alone that hasn’t moved on since it last shipped', () => {
    expect(shipPlan([state('web', false, 3, false), state('api', false, 1)])).toEqual({ kind: 'ship', repos: ['acme/api'] });
  });

  it('says so when there is nothing new', () => {
    expect(shipPlan([state('web', false, 0)])).toEqual({ kind: 'nothing' });
    expect(shipPlan([state('web', false, 2, false)])).toEqual({ kind: 'nothing' });
    expect(notShipped({ kind: 'nothing' })).toMatch(/no repo has new commits since it last shipped/);
  });
});

describe('what the lead writes and hears', () => {
  it('describes each pull request with the repos shipping alongside it, signed when attribution is on', () => {
    expect(leadPrBody('Adds saving', { name: 'Lt. Okafor' }, ['acme/api'], true)).toBe(
      'Adds saving\n\nShipped alongside the same slice in acme/api.\n\n---\n_Built by **Lt. Okafor**, a lead in the Focus office, with Claude Code._',
    );
    expect(leadPrBody(' ', { name: 'x' }, [], false)).toBe('A slice of work from one of the project’s leads.');
  });

  it('works in slices across every repo, ships through the office, and never pushes', () => {
    const prompt = leadSystemAppend({ name: 'Lt. Okafor' }, 'Shop', 1);
    expect(prompt).toMatch(/^# You are Lt\. Okafor, a lead on Shop/);
    expect(prompt).toContain('team station 2');
    expect(prompt).toMatch(/Other leads may be working in the same repos at the same time/);
    expect(prompt).toMatch(/Don't write a spec or plan the whole route/);
    expect(prompt).toMatch(/ship in slices small enough to review and merge cleanly/);
    expect(prompt).toContain('mcp__office__ship');
    expect(prompt).toMatch(/never push or open pull requests yourself/);
    expect(prompt).toMatch(/Hand independent work, and broad exploration, to subagents with the Agent tool, and keep their conclusions/);
    expect(prompt).toMatch(/mcp__office__note keeps the goal's note/);
    expect(prompt).toMatch(/When what done looks like is met, or nothing worthwhile is left, say so with mcp__office__propose_close/);
    expect(prompt).toMatch(/your repos move to fresh code on a new branch at the start of your next turn, bringing along commits you hadn't shipped/);
  });

  it('draws the star chart from what the lead does, not from a checklist in the note', () => {
    const prompt = leadSystemAppend({ name: 'Lt. Okafor' }, 'Shop', 1);
    expect(prompt).toContain("The goal's star chart is drawn from what you do: your task list (Claude Code's task tools), your commits and your ships.");
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

  it('passes on QA’s verdict, with what to fix on a fail', () => {
    expect(qaVerdictNote('acme/api', 7, { verdict: 'fail', summary: 'Empty list crashes', fixInstructions: 'Guard the empty case' })).toBe(
      'QA failed acme/api#7: Empty list crashes\n\nWhat to fix: Guard the empty case\n\nFix it and ship again, or tell the captain why not.',
    );
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

  it('tells the lead when the slice has landed, and where their repos are for the next one', () => {
    const landed = { ...work, prs: [work.prs[0], { ...work.prs[1], outcome: 'closed' as const }] };
    const idle = landedNote(landed);
    // idle, they carry on with what's next, asking first only when it's the captain's call
    expect(idle).toBe("Slice 2 has landed: acme/web#12 merged, acme/api#7 was closed unmerged. Carry on with what's next, unless it's the captain's call.");
    // mid-turn, they carry on: the move waits for their next turn
    expect(landedMidTurnNote(landed)).toBe(
      'Slice 2 has landed: acme/web#12 merged, acme/api#7 was closed unmerged. Carry on where you are: your repos move to fresh code at the start of your next turn, bringing your commits along.',
    );
    expect(newSliceNote({ ...work, slice: 3, prs: [] }, 'focus/lead-shop-3-cd')).toContain('Slice 3 starts on fresh code');
    expect(heldBack(work, ['api'])).toMatch(/\.\/api still has uncommitted changes, so your repos stay where they are/);
  });

  it('tells a lead whose repos were checked out again where they are, and that unshipped commits stayed behind', () => {
    const text = reposBackNote({ ...work, slice: 3, prs: [] }, 'focus/saved-items-3-cd');
    expect(text).toMatch(/^\[Office\] Your repos are checked out again/);
    expect(text).toContain('fresh code for slice 3');
    expect(text).toContain('- ./api: acme/api, on branch `focus/saved-items-3-cd` from `develop`');
    expect(text).toContain("commits you hadn't shipped didn't come along");
  });
});

describe('afterVerdict', () => {
  it('wakes the lead to fix a fail a couple of times, then hands it to the captain; a pass waits for the next message', () => {
    expect(afterVerdict('fail', 1)).toBe('wake');
    expect(afterVerdict('fail', 2)).toBe('wake');
    expect(afterVerdict('fail', 3)).toBe('needs-you');
    expect(afterVerdict('pass', 0)).toBe('pass-on');
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

describe('the goal’s note', () => {
  const start = { title: 'Saved items', note: undefined };

  it('takes only what the lead sends: each field replaces, learned adds a line', () => {
    expect(applyNote(start, {})).toEqual({ title: 'Saved items', note: emptyNote() });
    const first = applyNote(start, { done: 'Saved items survive a reload', next: ['Thin slice'] });
    expect(first).toEqual({ title: 'Saved items', note: { done: 'Saved items survive a reload', learned: [], next: ['Thin slice'] } });
    const second = applyNote(first, { title: '  Saved   items, anywhere ', learned: 'The store is fine', next: ['Header', ' '] });
    expect(second).toEqual({
      title: 'Saved items, anywhere',
      note: { done: 'Saved items survive a reload', learned: ['The store is fine'], next: ['Header'] },
    });
    expect(applyNote(second, { learned: 'Header next' })).toMatchObject({ note: { learned: ['The store is fine', 'Header next'] } });
    expect(applyNote(second, { allLearned: ['Merged lesson'], learned: 'Newest' })).toMatchObject({ note: { learned: ['Merged lesson', 'Newest'] } });
  });

  it('keeps whatever the lead sends, however long: the note has no limits', () => {
    const long = 'x'.repeat(500);
    const items = Array.from({ length: 12 }, (_, i) => `idea ${i}`);
    expect(applyNote(start, { title: long, done: long, learned: long, next: items })).toEqual({ title: long, note: { done: long, learned: [long], next: items } });
  });

  it('reads back as the goal where it stands, leaving out what’s empty', () => {
    expect(noteForPrompt({ title: 'Saved items' })).toBe('The goal: Saved items');
    expect(noteForPrompt({ title: 'Saved items', note: { done: 'Works on any device', learned: ['Store is fine'], next: ['Header'] } })).toBe(
      'The goal: Saved items\n\nWhat done looks like: Works on any device\n\nWhat the slices so far taught us:\n- Store is fine\n\nIdeas for next:\n- Header',
    );
  });

  it('carries the goal as the captain first put it, so it outlives the conversation', () => {
    const brief = goalBrief('Let shoppers save items for later.\n\nThey should survive a reload.\n');
    expect(brief).toBe('Let shoppers save items for later.\n\nThey should survive a reload.');
    expect(noteForPrompt({ title: 'Let shoppers save items for later', brief })).toBe(
      'The goal: Let shoppers save items for later\n\nAs the captain first put it:\n> Let shoppers save items for later.\n>\n> They should survive a reload.',
    );
    // a one-liner is its own title: no need to say it twice
    expect(noteForPrompt({ title: 'Saved items', brief: 'Saved items' })).toBe('The goal: Saved items');
    expect(goalBrief('x'.repeat(BRIEF_LIMIT + 50))).toHaveLength(BRIEF_LIMIT + 1);
  });

  it('comes back at each new slice, after where the repos are', () => {
    const text = newSliceNote({ ...work, slice: 3, prs: [], note: { done: 'Works anywhere', learned: ['Store is fine'], next: [] } }, 'focus/saved-items-3-cd');
    expect(text).toMatch(/^Slice 3 starts on fresh code/);
    expect(text).toContain('`develop`\n\nWhere the goal stands:\n\nThe goal: Saved items');
    expect(text).not.toMatch(/checklist|heading/);
    expect(text).not.toContain('summarised');
    expect(text).toContain('What done looks like: Works anywhere');
  });
});

describe('notedGoal', () => {
  // slice 1 landed, slice 2 is under way with three commits so far
  const course: LeadWork = { ...work, waypoints: [{ slice: 1, startedAt: 1, title: 'Store' }, { slice: 2, startedAt: 2, commits: 3 }] };
  const noted = (input: Parameters<typeof notedGoal>[1], on: LeadWork = course) => {
    const result = notedGoal(on, input, 50);
    if ('error' in result) throw new Error(result.error);
    return result;
  };

  it('keeps the note and title, leaving the chart alone when nothing on it changed', () => {
    const { lead, reply } = noted({ title: 'Saved items, anywhere', next: ['Header'] }, work);
    expect(lead).toEqual({ ...work, title: 'Saved items, anywhere', note: { ...emptyNote(), next: ['Header'] } });
    expect(reply).toBe('Noted.');
    expect(noted({ next: ['Header'] }).lead.waypoints).toEqual(course.waypoints);
  });

  it('puts a lesson, and what done used to look like, on the slice that landed', () => {
    const first = noted({ done: 'Saved items survive a reload', learned: 'The store is fine' }).lead;
    expect(first.waypoints).toEqual([{ slice: 1, startedAt: 1, title: 'Store', learned: ['The store is fine'] }, { slice: 2, startedAt: 2, commits: 3 }]);
    expect(noted({ done: 'Saved items work anywhere' }, first).lead.waypoints?.[0]).toEqual({ slice: 1, startedAt: 1, title: 'Store', learned: ['The store is fine'], turnedFrom: 'Saved items survive a reload' });
  });

  it('names the contact it logged, and not one it only closed', () => {
    const logged = noted({ contact: 'Is the API rate limited?' });
    expect(logged.lead.contacts).toEqual([{ id: 'c1', text: 'Is the API rate limited?', slice: 1, at: 50 }]);
    expect(logged.reply).toBe('Noted. Logged contact c1.');
    const both = noted({ contact: 'Dark mode', closeContact: { id: 'c1', as: 'dropped' } }, logged.lead);
    expect(both.reply).toBe('Noted. Logged contact c2.');
    const closed = noted({ closeContact: { id: 'c2', as: 'pursued' } }, both.lead);
    expect(closed.reply).toBe('Noted.');
    expect(closed.lead.contacts?.map((c) => c.closed?.as)).toEqual(['dropped', 'pursued']);
    expect(noted({ contact: '   ' }).lead).not.toHaveProperty('contacts');
  });

  it('refuses what the contacts refuse, changing nothing', () => {
    expect(notedGoal(course, { done: 'Fine', closeContact: { id: 'c9', as: 'dropped' } }, 50)).toEqual({ error: 'There\'s no contact c9. Open contacts: none.' });
  });
});

describe('closing a goal', () => {
  const pushed = { onOrigin: true, unpushed: 0 };
  const clean = [{ folder: 'web', dirty: false, branch: pushed }, { folder: 'api', dirty: false, branch: pushed }];

  it('closes without asking when everything reached GitHub and its pull requests are settled', () => {
    expect(closeCheck({ slice: 2, prs: [{ ...work.prs[0] }] }, 'focus/b', clean)).toEqual({ kind: 'ok' });
    // a later slice that hasn't shipped yet: earlier ones did
    expect(closeCheck({ slice: 2, prs: [] }, 'focus/b', clean)).toEqual({ kind: 'ok' });
  });

  it('warns about work only the office’s clone has, pull requests it leaves behind, and a goal that shipped nothing', () => {
    expect(closeCheck(work, 'focus/b', [{ folder: 'web', dirty: true, branch: pushed }, clean[1]])).toEqual({
      kind: 'warn',
      reasons: ['Uncommitted changes in ./web are committed as a WIP snapshot on `focus/b`, kept only in the office’s clone.', 'acme/api#7 stays open on GitHub, with no lead to fix it.'],
    });
    expect(closeCheck({ slice: 1, prs: [] }, 'focus/b', [{ folder: 'web', dirty: false, branch: { onOrigin: false, unpushed: 3 } }, { folder: 'api', dirty: false, branch: { onOrigin: true, unpushed: 1 } }])).toEqual({
      kind: 'warn',
      reasons: [
        './web’s branch `focus/b` never reached GitHub: its 3 commits stay only in the office’s clone.',
        './api has 1 commit that never reached GitHub, kept only in the office’s clone.',
        'The goal never shipped anything: no pull request was opened for it.',
      ],
    });
    // a branch GitHub never got, with nothing on it, loses nothing
    expect(closeCheck({ slice: 2, prs: [] }, 'focus/b', [{ folder: 'web', dirty: false, branch: { onOrigin: false, unpushed: 0 } }])).toEqual({ kind: 'ok' });
  });

  it('says so when git couldn’t tell how a checkout stands', () => {
    expect(closeCheck({ slice: 2, prs: [] }, 'focus/b', [{ folder: 'web', dirty: true }])).toEqual({
      kind: 'warn',
      reasons: ['Uncommitted changes in ./web are committed as a WIP snapshot on `focus/b`, kept only in the office’s clone.', 'Couldn’t tell whether ./web’s commits reached GitHub.'],
    });
  });

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
    expect(reopenable(record)).toBe(true);
    expect(reopenable({ ...record, branch: undefined, repos: undefined })).toBe(false);
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


  it('tells the lead where their repos are, and where uncommitted work went', () => {
    const record = goalRecord(lead, closedAt);
    const again = reopenedWork(record, 0);
    expect(reopenedNote(again, 'focus/saved-items-2-ab12', record.closedAt)).toBe(
      '[Office] The captain reopened this goal, closed on 2026-10-07. Your repos are checked out again on `focus/saved-items-2-ab12`, as you left them: ./web, ./api. ' +
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

  it('starts a queued goal at the station the captain picked while it’s free, else at the first free one', () => {
    expect(queuedStart(line, 'b', [0], { station: 2 }, 'Shop')).toMatchObject({ kind: 'start', station: 2 });
    // taken since they picked it, or never a station: the first free one
    expect(queuedStart(line, 'b', [0, 2], { station: 2 }, 'Shop')).toMatchObject({ kind: 'start', station: 1 });
    expect(queuedStart(line, 'b', [], { station: 9 }, 'Shop')).toMatchObject({ kind: 'start', station: 0 });
    expect(queuedStart(line, 'b', [1], {}, 'Shop')).toMatchObject({ kind: 'start', station: 0 });
    expect(queuedStart(line, 'b', [0, 1, 2, 3], { station: 1 }, 'Shop')).toEqual({ kind: 'refused', message: 'Every team station in Shop still has a goal' });
  });

  it('starts a queued goal with the captain’s last words and effort on it, else the ones it was queued with', () => {
    const queued = [{ id: 'a', text: 'Saved items', effort: 'low' as const, from: 'the bridge', at: 0 }];
    expect(queuedStart(queued, 'a', [], {}, 'Shop')).toEqual({ kind: 'start', station: 0, text: 'Saved items', effort: 'low', from: 'the bridge' });
    expect(queuedStart(queued, 'a', [], { text: '  Wishlists ', effort: 'high' }, 'Shop')).toEqual({ kind: 'start', station: 0, text: 'Wishlists', effort: 'high', from: 'the bridge' });
    // words cleared in the editor aren't a goal: it keeps the ones it was queued with
    expect(queuedStart(queued, 'a', [], { text: '   ' }, 'Shop')).toMatchObject({ text: 'Saved items' });
  });

  it('refuses a goal that has left the line', () => {
    expect(queuedStart(line, 'zz', [], {}, 'Shop')).toEqual({ kind: 'refused', message: 'That goal is no longer in line' });
    expect(queuedStart(undefined, 'a', [], {}, 'Shop')).toEqual({ kind: 'refused', message: 'That goal is no longer in line' });
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

describe('reviewsToStart', () => {
  const review = (id: string, reviewer: string, at: number) => ({ id, reviewer, requestedAt: at });
  const of = (r: { reviewer: string }) => r.reviewer;

  it('starts the oldest review for each free reviewer, side by side', () => {
    const queued = [review('a2', 'qa_goal_a', 3), review('room', 'qa_p1', 2), review('a1', 'qa_goal_a', 1), review('b1', 'qa_goal_b', 4)];
    expect(reviewsToStart(queued, of, () => false).map((s) => `${s.review.id}→${s.reviewer}`)).toEqual(['a1→qa_goal_a', 'room→qa_p1', 'b1→qa_goal_b']);
  });

  it('leaves a busy reviewer’s reviews waiting', () => {
    const queued = [review('a1', 'qa_goal_a', 1), review('b1', 'qa_goal_b', 2)];
    expect(reviewsToStart(queued, of, (r) => r === 'qa_goal_a').map((s) => s.review.id)).toEqual(['b1']);
    expect(reviewsToStart([], of, () => false)).toEqual([]);
  });
});

describe('the lead’s context', () => {
  it('moves to the next slice without compacting, unless a repo holds it back', () => {
    expect(afterLanding([])).toBe('next');
    expect(afterLanding(['web'])).toBe('held-back');
  });

  it('tells them which unshipped commits came along to the new slice, and how to bring over the ones that didn’t', () => {
    expect(carriedNote([], 'focus/saved-items-1-ab')).toBe('');
    const text = carriedNote(
      [
        { folder: 'web', commits: ['1111111111aaaa'], applied: true },
        { folder: 'api', commits: ['2222222222bbbb', '3333333333cccc'], applied: false },
      ],
      'focus/saved-items-1-ab',
    );
    expect(text).toMatch(/^Work you'd committed but not shipped:\n- \.\/web: the commit you hadn't shipped came along onto the new branch\./);
    expect(text).toContain("- ./api: the 2 commits you hadn't shipped didn't apply cleanly to fresh code, so they're only on `focus/saved-items-1-ab`. Bring them over with `git cherry-pick 2222222222 3333333333`");
  });

  it('compacts a lead before a turn that picks a big conversation here back up, unless switched off or it already failed there', () => {
    const big = { sessionId: 's1', context: { percent: 25, tokens: 250_000, max: 1_000_000 } };
    expect(compactsFirst(big, true, 200_000)).toBe(true);
    expect(compactsFirst({ ...big, context: { percent: 20, tokens: 200_000, max: 1_000_000 } }, true, 200_000)).toBe(true);
    expect(compactsFirst({ ...big, context: { percent: 15, tokens: 150_000, max: 1_000_000 } }, true, 200_000)).toBe(false);
    expect(compactsFirst({ sessionId: 's1' }, true, 200_000)).toBe(false);
    expect(compactsFirst(big, false, 200_000)).toBe(false);
    expect(compactsFirst(big, true, 0)).toBe(false);
    expect(compactsFirst({ ...big, sessionId: undefined }, true, 200_000)).toBe(false);
    expect(compactsFirst({ ...big, cloud: true }, true, 200_000)).toBe(false);
    expect(compactsFirst(big, true, 200_000, 's1')).toBe(false);
    expect(compactsFirst(big, true, 200_000, 's0')).toBe(true);
  });

  it('keeps the goal, the decisions and the lessons, drops the details, and carries the note', () => {
    const keep = compactInstructions({ title: 'Saved items', brief: 'Let shoppers save items for later', note: { done: 'Works anywhere', learned: ['Store is fine'], next: ['Header'] } });
    expect(keep).toMatch(/^Summarise this conversation for the lead of the goal "Saved items"/);
    expect(keep).toMatch(/Keep: the goal, what the captain asked for and what done looks like; the decisions made and why/);
    expect(keep).toMatch(/Drop: file contents, diffs, command and tool output/);
    expect(keep).toContain('What done looks like: Works anywhere');
    expect(keep).toContain('- Store is fine');
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
    expect(note).toContain("the office won't ship that repo");
  });

  it('keep the lead from shipping a checkout that’s behind', () => {
    expect(behindNote('web', 'focus/goal-1')).toMatch(/^Nothing shipped: GitHub's `focus\/goal-1` has commits \.\/web doesn't.*`git -C web pull --no-rebase origin focus\/goal-1`/);
  });
});

describe('a lead’s first message in a new conversation', () => {
  const goal: LeadWork = { ...work, brief: 'Let shoppers save items for later', slice: 2, note: { done: 'Saved items survive a reload', learned: [], next: [] } };

  it('is the captain’s words and where the repos are, for a new goal', () => {
    expect(freshSessionPrompt(goal, 'focus/saved-1-ab', ['Let shoppers save items for later', 'Web first'], false)).toBe(
      `${workspaceNote(goal, 'focus/saved-1-ab')}\n\nLet shoppers save items for later\n\nWeb first`,
    );
  });

  it('says where the goal stands when the conversation before couldn’t be picked back up', () => {
    const text = freshSessionPrompt(goal, 'focus/saved-2-ab', ['[Office] Slice 1 has landed'], false);
    expect(text).toMatch(/^Your workspace, with every repo/);
    expect(text).toContain("You're carrying on with this goal in a new conversation");
    expect(text).toContain('The goal: Saved items\n\nAs the captain first put it:\n> Let shoppers save items for later\n\nWhat done looks like: Saved items survive a reload');
    expect(text).toMatch(/\[Office\] Slice 1 has landed$/);
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

describe('showArtifact', () => {
  const page = '<h1>Data flow</h1>';

  it('adds a new id at the end and replaces a known one where it stands', () => {
    const one = showArtifact([], { id: 'data-flow', title: ' Data  flow ', html: page }, 1);
    expect(one).toEqual([{ id: 'data-flow', title: 'Data flow', at: 1 }]);
    const two = showArtifact(one as never, { id: 'mockup', title: 'Mockup', html: page }, 2);
    const again = showArtifact(two as never, { id: 'data-flow', title: 'Data flow v2', html: page }, 3);
    expect(again).toEqual([{ id: 'data-flow', title: 'Data flow v2', at: 3 }, { id: 'mockup', title: 'Mockup', at: 2 }]);
  });

  it('refuses ids that would not make a safe file name, empty pages and untitled ones', () => {
    for (const id of ['', 'Data', '../x', '-x', 'a'.repeat(ARTIFACT_LIMITS.id + 1)]) expect(showArtifact([], { id, title: 'T', html: page }, 1)).toHaveProperty('error');
    expect(showArtifact([], { id: 'x', title: ' ', html: page }, 1)).toHaveProperty('error');
    expect(showArtifact([], { id: 'x', title: 'T', html: '  ' }, 1)).toHaveProperty('error');
  });

  it('keeps the screen to a handful, though a known id can always be replaced', () => {
    const full = Array.from({ length: ARTIFACT_LIMITS.count }, (_, i) => ({ id: `a${i}`, title: 'T', at: i }));
    expect(showArtifact(full, { id: 'one-more', title: 'T', html: page }, 99)).toHaveProperty('error');
    expect(showArtifact(full, { id: 'a3', title: 'T', html: page }, 99)).toHaveLength(ARTIFACT_LIMITS.count);
  });
});

describe('questions', () => {
  const options = [{ label: 'Cards', html: '<p>A</p>' }, { label: ' Plain   list ', html: '<p>B</p>' }];
  const ask = (questions: Parameters<typeof askQuestion>[0], question = 'Which layout?') => {
    const asked = askQuestion(questions, { question, options }, 5);
    if ('error' in asked) throw new Error(asked.error);
    return asked;
  };

  it('numbers each question and letters its options', () => {
    const { questions, asked, dropped } = ask([]);
    expect(asked).toEqual({ id: 'q1', question: 'Which layout?', options: [{ id: 'a', label: 'Cards' }, { id: 'b', label: 'Plain list' }], at: 5 });
    expect(questions).toEqual([asked]);
    expect(dropped).toEqual([]);
  });

  it('replaces a question still open, and keeps the answered ones', () => {
    const first = ask([]).questions;
    const answered = answerQuestion(first, 'q1', 'b', '  but keep the header  ', 6);
    expect(answered).toEqual({ questions: [{ ...first[0], answer: { option: 'b', note: 'but keep the header', at: 6 } }], question: first[0] });
    const second = ask('error' in answered ? [] : answered.questions, 'Which colour?');
    const third = ask(second.questions, 'Which colour, really?');
    expect(third.questions.map((q) => q.id)).toEqual(['q1', 'q3']);
    expect(third.dropped.map((q) => q.id)).toEqual(['q2']);
  });

  it('keeps only the last few answered questions', () => {
    const many = Array.from({ length: QUESTION_LIMITS.kept }, (_, i) => ({ id: `q${i + 1}`, question: 'Q', options: [], at: i, answer: { option: 'a', at: i } }));
    const { questions, dropped } = ask(many);
    expect(questions).toHaveLength(QUESTION_LIMITS.kept);
    expect(questions.at(-1)!.id).toBe(`q${QUESTION_LIMITS.kept + 1}`);
    expect(dropped.map((q) => q.id)).toEqual(['q1']);
  });

  it('keeps why the lead asked, and each option’s detail, when they give them', () => {
    const asked = askQuestion([], { question: 'Which?', context: '  It decides the header.  ', options: [{ ...options[0], detail: ' Roomier. ' }, options[1]] }, 1);
    expect(asked).toMatchObject({ asked: { context: 'It decides the header.', options: [{ id: 'a', detail: 'Roomier.' }, { id: 'b' }] } });
    expect('error' in asked ? undefined : asked.asked.options[1]).not.toHaveProperty('detail');
    expect(askQuestion([], { question: 'Which?', context: 'x'.repeat(QUESTION_LIMITS.context + 1), options }, 1)).toHaveProperty('error');
    expect(askQuestion([], { question: 'Which?', options: [{ ...options[0], detail: 'x'.repeat(QUESTION_LIMITS.detail + 1) }, options[1]] }, 1)).toHaveProperty('error');
  });

  it('refuses questions without enough options, or options without a label or a page', () => {
    expect(askQuestion([], { question: 'Which?', options: options.slice(0, 1) }, 1)).toHaveProperty('error');
    expect(askQuestion([], { question: 'Which?', options: [...options, ...options, options[0]] }, 1)).toHaveProperty('error');
    expect(askQuestion([], { question: ' ', options }, 1)).toHaveProperty('error');
    expect(askQuestion([], { question: 'Which?', options: [options[0], { label: ' ', html: '<p>B</p>' }] }, 1)).toHaveProperty('error');
    expect(askQuestion([], { question: 'Which?', options: [options[0], { label: 'B', html: ' ' }] }, 1)).toHaveProperty('error');
  });

  it('takes one answer per question, of an option it has', () => {
    const { questions } = ask([]);
    expect(answerQuestion(questions, 'q9', 'a', undefined, 2)).toHaveProperty('error');
    expect(answerQuestion(questions, 'q1', 'c', undefined, 2)).toHaveProperty('error');
    const answered = answerQuestion(questions, 'q1', 'a', ' ', 2);
    expect(answered).toEqual({ questions: [{ ...questions[0], answer: { option: 'a', at: 2 } }], question: questions[0] });
    expect(answerQuestion('error' in answered ? [] : answered.questions, 'q1', 'b', undefined, 3)).toHaveProperty('error');
  });

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
