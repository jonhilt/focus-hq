import { describe, expect, it } from 'vitest';
import { leadFor, leadId, plannerFor, qaOfficerFor } from '../../shared/crew';
import type { Agent, LeadWork } from '../../shared/types';
import { afterVerdict, applyHelperEvent, goalEffort, goalTitle, heldBack, landedNote, leadPrBody, leadSystemAppend, newSliceNote, notShipped, openPr, pickStation, qaVerdictNote, shipPlan, sliceBranch, sliceLanded, upgradeLead, workspaceNote } from './lead';

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
