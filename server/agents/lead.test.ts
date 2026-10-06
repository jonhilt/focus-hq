import { describe, expect, it } from 'vitest';
import { leadFor, leadId, plannerFor, qaOfficerFor } from '../../shared/crew';
import type { LeadWork } from '../../shared/types';
import { afterVerdict, applyHelperEvent, heldBack, landedNote, leadPrBody, leadSystemAppend, newSliceNote, notShipped, openPr, qaVerdictNote, shipPlan, sliceBranch, sliceLanded } from './lead';

const work: LeadWork = {
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

describe('the lead', () => {
  it('is one per project, a lieutenant in command red, never sharing a surname with the room’s other officers', () => {
    for (const id of ['p1', 'p2', 'shop', 'thomas']) {
      const lead = leadFor(id);
      expect(lead.avatar.division).toBe('command');
      const surname = lead.name.split(' ').at(-1);
      expect([plannerFor(id), qaOfficerFor(id)].map((o) => o.name.split(' ').at(-1))).not.toContain(surname);
    }
    expect(leadId('p1')).toBe('lead_p1');
  });
});

describe('slices', () => {
  it('gets a fresh branch each slice', () => {
    expect(sliceBranch('Thomas Project', 3, 'ab12')).toBe('focus/lead-thomas-project-3-ab12');
    expect(sliceBranch('!!!', 1, 'x')).toBe('focus/lead-project-1-x');
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
      'Adds saving\n\nShipped alongside the same slice in acme/api.\n\n---\n_Built by **Lt. Okafor**, the project’s lead in the Focus office, with Claude Code._',
    );
    expect(leadPrBody(' ', { name: 'x' }, [], false)).toBe('A slice of work from the project’s lead.');
  });

  it('works in slices across every repo, ships through the office, and never pushes', () => {
    const prompt = leadSystemAppend({ name: 'Lt. Okafor', branch: 'focus/lead-shop-2-ab' }, 'Shop', work);
    expect(prompt).toContain('- ./web: acme/web, on branch `focus/lead-shop-2-ab` from `main`');
    expect(prompt).toContain('- ./api: acme/api, on branch `focus/lead-shop-2-ab` from `develop`');
    expect(prompt).toMatch(/Don't write a spec or plan the whole route/);
    expect(prompt).toMatch(/thin slice end to end, through every repo it needs/);
    expect(prompt).toMatch(/A slice can also be a refactor/);
    expect(prompt).toContain('mcp__office__ship');
    expect(prompt).toMatch(/Never push and never open pull requests yourself/);
    expect(prompt).toMatch(/subagents with the Agent tool/);
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
