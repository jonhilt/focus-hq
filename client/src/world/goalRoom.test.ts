import { describe, expect, it } from 'vitest';
import type { Agent, AgentStatus, GoalNote } from '../../../shared/types';
import { checklistGlance, goalMove, goalRoomState, HELD_ELSEWHERE, lampGlow, leadNow, type MovePr, movePills, noteSections, prGlance, roster, rowAt, sliceProgress, sliceSteps } from './goalRoom';

describe('goalRoomState', () => {
  const lead = (status: AgentStatus) => ({ status });

  it('is free with no lead', () => {
    expect(goalRoomState(undefined)).toEqual({ tone: 'free', label: 'Free' });
  });

  it('is in session while the lead works', () => {
    for (const s of ['setting-up', 'working', 'testing', 'pushing'] as const) expect(goalRoomState(lead(s)).tone).toBe('in-session');
  });

  it('needs you when the lead has their hand up, and is your turn when they’ve finished theirs', () => {
    expect(goalRoomState(lead('waiting'))).toEqual({ tone: 'needs-you', label: 'Needs you' });
    expect(goalRoomState(lead('done'))).toEqual({ tone: 'your-turn', label: 'Your turn' });
  });

  it('needs your answer while the lead has a question open, unless something more pressing is up', () => {
    const asking = (status: AgentStatus, answered: false | 'picked' | 'chat' = false) => ({
      status,
      lead: { questions: [{ id: 'q1', question: 'Which?', options: [], at: 1, ...(answered ? { answer: answered === 'picked' ? { option: 'a', at: 2 } : { note: 'B, please', at: 2 } } : {}) }] } as never,
    });
    expect(goalRoomState(asking('done'))).toEqual({ tone: 'needs-you', label: 'Your answer' });
    expect(goalRoomState(asking('working'))).toEqual({ tone: 'needs-you', label: 'Your answer' });
    expect(goalRoomState(asking('done', 'picked'))).toEqual({ tone: 'your-turn', label: 'Your turn' });
    // answered in chat: the lead's working on the reply
    expect(goalRoomState(asking('working', 'chat'))).toEqual(goalRoomState(asking('working', 'picked')));
    expect(goalRoomState(asking('working', 'chat')).label).not.toBe('Your answer');
    expect(goalRoomState(asking('waiting'))).toEqual({ tone: 'needs-you', label: 'Needs you' });
    expect(goalRoomState(asking('error')).tone).toBe('stopped');
  });

  it('is queued while the lead waits for a slot, and stopped once they’ve stopped or failed', () => {
    expect(goalRoomState(lead('queued'))).toEqual({ tone: 'queued', label: 'Queued' });
    expect(goalRoomState(lead('stopped'))).toEqual({ tone: 'stopped', label: 'Stopped' });
    expect(goalRoomState(lead('error'))).toEqual({ tone: 'stopped', label: 'Stopped' });
  });
});

describe('sliceSteps and sliceProgress', () => {
  const steps = (done: boolean[]) => done.map((d, i) => ({ text: `${i}`, done: d }));

  it('is how many of the steps are done, to the nearest percent', () => {
    expect(sliceProgress(steps([true, false, false]))).toBe(33);
    expect(sliceProgress(steps([true, true]))).toBe(100);
    expect(sliceProgress(steps([false]))).toBe(0);
  });

  it('is nothing without any steps', () => {
    expect(sliceProgress([])).toBeNull();
    expect(sliceSteps(undefined)).toEqual([]);
  });

  it('takes the slice under way’s tasks, and none from another slice', () => {
    const waypoints = [
      { slice: 1, startedAt: 0, tasks: [{ id: '1', subject: 'Old', status: 'completed' as const }] },
      { slice: 2, startedAt: 5, tasks: [{ id: '2', subject: 'Probe', status: 'completed' as const }, { id: '3', subject: 'Chart', status: 'in_progress' as const }] },
    ];
    expect(sliceSteps({ slice: 2, waypoints })).toEqual([{ text: 'Probe', done: true }, { text: 'Chart', done: false }]);
    // a slice with no tasks yet has no steps
    expect(sliceSteps({ slice: 3, waypoints })).toEqual([]);
    expect(sliceSteps({ slice: 2, waypoints: [{ slice: 2, startedAt: 5 }] })).toEqual([]);
  });
});

describe('noteSections', () => {
  const note: GoalNote = {
    done: 'Each station is a door to its briefing room.',
    learned: ['one', 'two', 'three'],
    next: ['A pod'],
  };

  const steps = [
    { text: 'Goal board', done: true },
    { text: 'Bigger sign', done: false },
  ];

  it('puts the slice’s steps first, finished ones dimmed, then done, next and the latest two lessons', () => {
    const sections = noteSections(note, 2, steps);
    expect(sections.map((s) => s.heading)).toEqual(['Slice 2 · 1 of 2', 'Done looks like', 'Next', 'Learned']);
    expect(sections[0].items).toEqual([
      { mark: '☑', text: 'Goal board', dim: true },
      { mark: '☐', text: 'Bigger sign', dim: false },
    ]);
    expect(sections[3].items.map((i) => i.text)).toEqual(['two', 'three']);
  });

  it('puts the slice and what done looks like under the goal, and next and the lessons under the crew', () => {
    expect(noteSections(note, 2, steps).map((s) => s.side)).toEqual(['goal', 'goal', 'crew', 'crew']);
  });

  it('leaves out sections with nothing in them', () => {
    expect(noteSections({ done: '', learned: [], next: [] }, 1)).toEqual([]);
    expect(noteSections(note, 2).map((s) => s.heading)).toEqual(['Done looks like', 'Next', 'Learned']);
  });
});

describe('rowAt', () => {
  const rows = [
    { top: 100, bottom: 200 },
    { top: 200, bottom: 300 },
  ];

  it('finds the row a point is on, the boundary going to the row below', () => {
    expect(rowAt(rows, 150)).toBe(0);
    expect(rowAt(rows, 200)).toBe(1);
  });

  it('finds none above, below or with no rows', () => {
    expect(rowAt(rows, 50)).toBeUndefined();
    expect(rowAt(rows, 300)).toBeUndefined();
    expect(rowAt([], 150)).toBeUndefined();
  });
});

describe('roster', () => {
  it('lists the lead, then the reviewer, then whichever helpers are seated', () => {
    expect(roster('lead', 'qa', [undefined, 'h2', 'h3'])).toEqual([
      { who: 'lead', role: 'Lead' },
      { who: 'qa', role: 'Reviewer' },
      { who: 'h2', role: 'Helper' },
      { who: 'h3', role: 'Helper' },
    ]);
  });

  it('is empty at a free station', () => {
    expect(roster(undefined, undefined, [undefined])).toEqual([]);
  });
});

describe('leadNow', () => {
  const lead = (status: AgentStatus, more: object = {}) => ({ status, activity: 'Writing the wishlist API', ...more });

  it('is what the lead is doing while they work, or last did once it’s your turn', () => {
    expect(leadNow(lead('working'))).toBe('Writing the wishlist API');
    expect(leadNow(lead('done'))).toBe('Writing the wishlist API');
    expect(leadNow(lead('done', { activity: '' }))).toBe('Waiting for your reply');
  });

  it('says what they need from you: an approval, an answer, or closing the goal', () => {
    expect(leadNow(lead('waiting', { permission: { id: 'p', tool: 'ship', summary: 'Ship slice 2', at: 1 } }))).toBe('Asking you: Ship slice 2');
    const question = { id: 'q1', question: 'Which layout?', options: [], at: 1 };
    expect(leadNow(lead('working', { lead: { questions: [question] } }))).toBe('Asked you: Which layout?');
    expect(leadNow(lead('working', { lead: { questions: [{ ...question, answer: { note: 'B', at: 2 } }] } }))).toBe('Writing the wishlist API');
    expect(leadNow(lead('done', { lead: { closing: { reason: 'Done looks done', at: 1 } } }))).toBe('Ready to wrap up: Done looks done');
  });

  it('says when they’ve stopped, failed or are waiting for a slot', () => {
    expect(leadNow(lead('stopped'))).toBe('Stopped');
    expect(leadNow(lead('error', { error: 'No repos' }))).toBe('Hit a problem: No repos');
    expect(leadNow(lead('queued'))).toBe('Waiting for a free slot to carry on');
  });
});

describe('checklistGlance', () => {
  const items = (done: boolean[]) => done.map((d, i) => ({ text: `${i}`, done: d }));

  it('shows the whole checklist when it fits', () => {
    expect(checklistGlance(items([true, false]), 4)).toEqual({ done: 0, items: items([true, false]), more: 0 });
  });

  it('folds the ticked-off items at the top into one line', () => {
    const glance = checklistGlance(items([true, true, true, false, false]), 3);
    expect(glance).toEqual({ done: 3, items: [{ text: '3', done: false }, { text: '4', done: false }], more: 0 });
  });

  it('says how many more there are when what’s left doesn’t fit', () => {
    const glance = checklistGlance(items([true, false, false, false, false]), 3);
    expect(glance.done).toBe(1);
    expect(glance.items.map((i) => i.text)).toEqual(['1']);
    expect(glance.more).toBe(3);
    expect(checklistGlance(items([false, false, false, false]), 3)).toEqual({ done: 0, items: items([false, false]), more: 2 });
  });

  it('is just the tally once everything’s ticked off', () => {
    expect(checklistGlance(items([true, true, true, true]), 3)).toEqual({ done: 4, items: [], more: 0 });
  });
});

describe('prGlance', () => {
  it('is how it ended, once it has', () => {
    expect(prGlance({ outcome: 'merged' }, 'failed')).toBe('merged');
    expect(prGlance({ outcome: 'closed' }, undefined)).toBe('closed');
  });

  it('is how QA has it while it’s open', () => {
    expect(prGlance({}, 'queued')).toBe('testing');
    expect(prGlance({}, 'testing')).toBe('testing');
    expect(prGlance({}, 'passed')).toBe('passed');
    expect(prGlance({}, 'failed')).toBe('failed');
    expect(prGlance({}, 'error')).toBe('open');
    expect(prGlance({}, undefined)).toBe('open');
  });
});

describe('goalMove', () => {
  const lead = (status: AgentStatus, more: Partial<Agent> = {}, work: Partial<NonNullable<Agent['lead']>> = {}): Agent => ({
    id: 'a1', name: 'Lt. Vale', projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
    status, activity: 'Writing the wishlist API', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
    avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
    lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: [], ...work },
    ...more,
  });
  const pr = (number: number, state: MovePr['state']): MovePr => ({ number, state });
  const claim = { key: 'cos', label: 'Chief of staff', why: 'Carry on: tests next', counter: '1:40' };

  it('is the lead’s while they’re at work or waiting for a slot, saying what they’re doing', () => {
    for (const s of ['setting-up', 'working', 'testing', 'pushing', 'queued'] as const) expect(goalMove(lead(s), [], undefined).holder).toBe('lead');
    expect(goalMove(lead('working'), [pr(44, 'passed')], undefined)).toEqual({ holder: 'lead', why: 'Writing the wishlist API', sign: 'In session' });
  });

  it('is QA’s once the lead’s done and QA’s testing what they shipped, with nothing asked of the captain', () => {
    expect(goalMove(lead('done'), [pr(43, 'merged'), pr(44, 'testing')], undefined)).toEqual({ holder: 'qa', why: 'Shipped #44; QA is testing it. Nothing asked of you.', sign: 'QA testing' });
    // a pass waits while another is still being tested
    expect(goalMove(lead('done'), [pr(43, 'passed'), pr(44, 'testing')], undefined).holder).toBe('qa');
  });

  it('is the captain’s for whatever only they can answer, even while QA tests or a plugin claims it', () => {
    const testing = [pr(44, 'testing')];
    const asked = { id: 'q1', question: 'Which layout?', options: [], at: 1 };
    expect(goalMove(lead('waiting', { permission: { id: 'p', tool: 'ship', summary: 'Ship slice 2', at: 1 } }), testing, claim)).toEqual({ holder: 'you', why: 'Asking you: Ship slice 2', sign: 'Needs you' });
    expect(goalMove(lead('done', {}, { questions: [asked] }), testing, claim)).toMatchObject({ holder: 'you', why: 'Asked you: Which layout?' });
    expect(goalMove(lead('error', { error: 'No repos' }), testing, claim)).toMatchObject({ holder: 'you', why: 'Hit a problem: No repos' });
    expect(goalMove(lead('done', {}, { closing: { reason: 'Done looks done', at: 1 } }), testing, claim)).toMatchObject({ holder: 'you', why: 'Ready to wrap up: Done looks done' });
    expect(goalMove(lead('stopped'), testing, claim)).toMatchObject({ holder: 'you', sign: 'Stopped' });
    expect(goalMove(lead('queued', { held: { until: 5 } }), testing, claim)).toMatchObject({ holder: 'you', sign: 'On hold' });
  });

  it('is a plugin’s while it claims it, its countdown kept, ahead of QA', () => {
    expect(goalMove(lead('done'), [pr(44, 'testing')], claim)).toEqual({ holder: 'cos', why: 'Carry on: tests next', sign: 'Chief of staff', counter: '1:40' });
  });

  it('is the captain’s, quietly, when a plugin hands it to them asking nothing now, after anyone else’s move', () => {
    const read = { key: 'cos', label: 'Chief of staff', why: 'You’ve read it: it waits for your next message', captain: true, quiet: true };
    expect(goalMove(lead('done'), [], read)).toEqual({ holder: 'you', why: 'You’ve read it: it waits for your next message', sign: 'Your turn', quiet: true });
    expect(goalMove(lead('done'), [pr(44, 'testing')], read).holder).toBe('qa');
    expect(goalMove(lead('done'), [pr(44, 'passed')], read)).toEqual({ holder: 'you', why: 'QA passed #44: it waits for you to merge it.', sign: 'Merge #44' });
    expect(goalMove(lead('working'), [], read).holder).toBe('lead');
    // quiet means nothing without handing it to the captain
    expect(goalMove(lead('done'), [], { ...claim, quiet: true })).toMatchObject({ holder: 'cos' });
  });

  it('is the captain’s when a plugin hands it to them, ahead of QA testing and a pass to merge', () => {
    const card = { key: 'cos', label: 'Chief of staff', why: 'A card for you: Which colours?', captain: true };
    for (const prs of [[pr(44, 'testing')], [pr(44, 'passed')], []]) expect(goalMove(lead('done'), prs, card)).toEqual({ holder: 'you', why: 'A card for you: Which colours?', sign: 'Your turn' });
    // what only the captain can answer still says so
    expect(goalMove(lead('error', { error: 'No repos' }), [], card)).toMatchObject({ holder: 'you', why: 'Hit a problem: No repos' });
  });

  it('is the captain’s otherwise: a pass to merge, then a fail, then the turn that’s ended', () => {
    expect(goalMove(lead('done'), [pr(43, 'failed'), pr(44, 'passed')], undefined)).toEqual({ holder: 'you', why: 'QA passed #44: it waits for you to merge it.', sign: 'Merge #44' });
    expect(goalMove(lead('done'), [pr(43, 'failed')], undefined)).toMatchObject({ holder: 'you', sign: 'QA failed' });
    expect(goalMove(lead('done'), [pr(42, 'merged'), pr(43, 'open')], undefined)).toEqual({ holder: 'you', why: 'Writing the wishlist API', sign: 'Your turn' });
  });
});

describe('movePills', () => {
  const holders = [{ key: 'lead', label: 'Lead', colour: 'a' }, { key: 'qa', label: 'QA', colour: 'b' }, { key: 'cos', label: 'Chief of staff', colour: 'c' }, { key: 'you', label: 'You', colour: 'd' }];

  it('shows every holder, lighting the one holding the move with its countdown on it', () => {
    expect(movePills(holders, { holder: 'cos', counter: '1:40' }).map((p) => [p.label, p.lit])).toEqual([['Lead', false], ['QA', false], ['Chief of staff · 1:40', true], ['You', false]]);
    expect(movePills(holders, { holder: 'you' }).filter((p) => p.lit).map((p) => p.label)).toEqual(['You']);
  });

  it('colours the captain’s pill in the room’s tone while the move is theirs, and only then', () => {
    expect(movePills(holders, { holder: 'you' }, 'green').map((p) => p.colour)).toEqual(['a', 'b', 'c', 'green']);
    expect(movePills(holders, { holder: 'qa' }, 'green').map((p) => p.colour)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('lampGlow', () => {
  it('calls the captain only while the move is theirs: pulsing while something needs them, steady on their turn', () => {
    expect(lampGlow('your-turn', true, 0)).toBe(1);
    expect(lampGlow('stopped', true, 0)).toBe(1);
    expect(new Set([0, 0.1, 0.2].map((t) => lampGlow('needs-you', true, t))).size).toBe(3);
  });

  it('is dim and still while anyone else holds it, and off while the station’s free', () => {
    for (const t of [0, 0.1, 0.2]) {
      expect(lampGlow('your-turn', false, t)).toBe(HELD_ELSEWHERE);
      expect(lampGlow('in-session', false, t)).toBe(HELD_ELSEWHERE);
    }
    expect(lampGlow('free', true, 0)).toBe(0);
  });
});
