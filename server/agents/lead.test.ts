import { describe, expect, it } from 'vitest';
import { leadFor, leadId, plannerFor, qaFor, qaOfficerFor } from '../../shared/crew';
import type { Agent, LeadWork } from '../../shared/types';
import { afterLanding, BRIEF_LIMIT, carriedNote, freshSessionPrompt, goalBrief, afterVerdict, conflictsNote, applyHelperEvent, applyNote, COMPACT_INSTRUCTIONS, compactInstructions, goalOf, goalReviewerId, reviewsToStart, checkNote, closeCheck, emptyNote, fileGoal, GOAL_LOG, goalEffort, goalRecord, goalTitle, heldBack, landedNote, leadPrBody, leadSystemAppend, moveQueued, newSliceNote, nextGoal, noteForPrompt, notShipped, openPr, pickStation, qaVerdictNote, shippedSha, shipPlan, sliceBranch, sliceLanded, upgradeLead, workspaceNote } from './lead';

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
    expect(prompt).toMatch(/Other leads may be working on other goals in the same repos/);
    expect(prompt).toMatch(/Don't write a spec or plan the whole route/);
    expect(prompt).toMatch(/thin slice end to end, through every repo it needs/);
    expect(prompt).toMatch(/A slice can also be a refactor/);
    expect(prompt).toContain('mcp__office__ship');
    expect(prompt).toMatch(/Never push and never open pull requests yourself/);
    expect(prompt).toMatch(/subagents with the Agent tool/);
    expect(prompt).toMatch(/mcp__office__note.*it's a note, not a spec/s);
    expect(prompt).toMatch(/call mcp__office__propose_close with why, tell the captain, and stop/);
    expect(prompt).toMatch(/Hand broad exploration .* to subagents too, and keep their conclusions/);
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
  });

  it('tells the lead when the slice has landed, and where their repos are for the next one', () => {
    const landed = { ...work, prs: [work.prs[0], { ...work.prs[1], outcome: 'closed' as const }] };
    expect(landedNote(landed)).toBe('Slice 2 has landed: acme/web#12 merged, acme/api#7 was closed unmerged. Tell the captain what it taught you and what you\'d do next.');
    expect(newSliceNote({ ...work, slice: 3, prs: [] }, 'focus/lead-shop-3-cd')).toContain('Slice 3 starts on fresh code');
    expect(heldBack(work, ['api'])).toMatch(/\.\/api still has uncommitted changes, so your repos stay where they are/);
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

describe('the goal’s note', () => {
  const start = { title: 'Saved items', note: undefined };

  it('takes only what the lead sends: each field replaces, learned adds a line', () => {
    const first = applyNote(start, { done: 'Saved items survive a reload', next: ['Thin slice'] });
    expect(first).toEqual({ title: 'Saved items', note: { done: 'Saved items survive a reload', slice: [], learned: [], next: ['Thin slice'] } });
    if ('error' in first) throw new Error(first.error);
    const second = applyNote(first, { title: '  Saved   items, anywhere ', slice: [{ text: 'api: store', done: true }, { text: ' ' }, { text: 'web: button' }], learned: 'The store is fine' });
    expect(second).toEqual({
      title: 'Saved items, anywhere',
      note: { done: 'Saved items survive a reload', slice: [{ text: 'api: store', done: true }, { text: 'web: button', done: false }], learned: ['The store is fine'], next: ['Thin slice'] },
    });
    if ('error' in second) throw new Error(second.error);
    expect(applyNote(second, { learned: 'Header next' })).toMatchObject({ note: { learned: ['The store is fine', 'Header next'] } });
    expect(applyNote(second, { allLearned: ['Merged lesson'], learned: 'Newest' })).toMatchObject({ note: { learned: ['Merged lesson', 'Newest'] } });
  });

  it('refuses a note that grows into a spec, saying what to trim', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `item ${i}` }));
    expect(applyNote(start, { slice: items(7) })).not.toHaveProperty('error');
    const tooMany = applyNote(start, { slice: items(8), next: ['a', 'b', 'c', 'd'] });
    expect(tooMany).toHaveProperty('error');
    expect((tooMany as { error: string }).error).toMatch(/the slice has 8 items \(at most 7.*next has 4 ideas \(at most 3\)/);
    expect(checkNote('x'.repeat(61), emptyNote())).toMatch(/the title is 61 characters/);
    expect(checkNote('ok', { ...emptyNote(), done: 'x'.repeat(401) })).toMatch(/done is 401 characters/);
    expect(checkNote('ok', { ...emptyNote(), learned: Array(11).fill('lesson') })).toMatch(/send allLearned with the older lessons merged/);
    expect(checkNote('ok', emptyNote())).toBeUndefined();
  });

  it('reads back as the goal where it stands, leaving out what’s empty', () => {
    expect(noteForPrompt({ title: 'Saved items' })).toBe('The goal: Saved items');
    expect(noteForPrompt({ title: 'Saved items', note: { done: 'Works on any device', slice: [{ text: 'api', done: true }, { text: 'web', done: false }], learned: ['Store is fine'], next: ['Header'] } })).toBe(
      'The goal: Saved items\n\nWhat done looks like: Works on any device\n\nWhat the slices so far taught us:\n- Store is fine\n\nThis slice:\n- [x] api\n- [ ] web\n\nIdeas for next:\n- Header',
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

  it('comes back at each new slice, with its checklist cleared by the office', () => {
    const text = newSliceNote({ ...work, slice: 3, prs: [], note: { done: 'Works anywhere', slice: [], learned: ['Store is fine'], next: [] } }, 'focus/saved-items-3-cd');
    expect(text).toMatch(/^Slice 3 starts on fresh code/);
    expect(text).toContain("cleared the last slice's checklist");
    expect(text).not.toContain('summarised');
    expect(text).toContain('What done looks like: Works anywhere');
  });
});

describe('closing a goal', () => {
  it('warns about work it would throw away and pull requests it would leave behind', () => {
    expect(closeCheck({ prs: [{ ...work.prs[0] }] }, [])).toEqual({ kind: 'ok' });
    expect(closeCheck(work, ['web'])).toEqual({
      kind: 'warn',
      reasons: ['Uncommitted changes in ./web are thrown away.', 'acme/api#7 stays open on GitHub, with no lead to fix it.'],
    });
  });

  it('files the goal in the room’s log, newest first, keeping a few dozen', () => {
    const lead = { id: 'lead_p1_ab', name: 'Lt. Okafor', sessionId: 's1', startedAt: 10, lead: work } as Agent;
    const record = goalRecord(lead, 99);
    expect(record).toEqual({ id: 'lead_p1_ab', title: 'Saved items', note: undefined, slices: 2, prs: work.prs, leadName: 'Lt. Okafor', sessionId: 's1', openedAt: 10, closedAt: 99 });
    // closed before the new slice shipped anything: that one doesn't count
    expect(goalRecord({ ...lead, lead: { ...work, slice: 3, prs: [] } }, 99).slices).toBe(2);
    const full = Array.from({ length: GOAL_LOG }, (_, i) => ({ ...record, id: `g${i}` }));
    const log = fileGoal(full, record);
    expect(log).toHaveLength(GOAL_LOG);
    expect(log[0]).toBe(record);
    expect(log.at(-1)?.id).toBe(`g${GOAL_LOG - 2}`);
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

  it('keeps the goal, the decisions and the lessons, drops the details, and carries the note', () => {
    const keep = compactInstructions({ title: 'Saved items', brief: 'Let shoppers save items for later', note: { done: 'Works anywhere', slice: [], learned: ['Store is fine'], next: ['Header'] } });
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
  it('go back to the lead, to merge the base into their own checkout and ship again', () => {
    const note = conflictsNote('acme/web', 12, 'main', 'web');
    expect(note).toMatch(/^acme\/web#12 has merge conflicts with `main`\. Resolve them in \.\/web, which is on its branch:/);
    expect(note).toContain('`git -C web fetch origin`, then `git -C web merge origin/main`');
    expect(note).toContain('ship again with mcp__office__ship: that updates the pull request');
    expect(note).toMatch(/Merge rather than rebase/);
  });
});

describe('a lead’s first message in a new conversation', () => {
  const goal: LeadWork = { ...work, brief: 'Let shoppers save items for later', slice: 2, note: { done: 'Saved items survive a reload', slice: [], learned: [], next: [] } };

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
