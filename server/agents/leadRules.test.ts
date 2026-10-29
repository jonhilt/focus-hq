import { describe, expect, it } from 'vitest';
import type { Agent, LeadAgent, LeadWork } from '../../shared/types';
import { goalRecord } from './lead';
import { answerQuestion, ARTIFACT_LIMITS, askQuestion, closeCheck, compactsFirst, hasLeadWork, QUESTION_LIMITS, queuedStart, reopenable, reviewsToStart, showArtifact, verdictStands, verdictToast } from './leadRules';

const work: LeadWork = {
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

describe('a goal’s lead', () => {
  it('carries the goal’s work only when it has some, which is what lets the lead’s parts read it without asserting', () => {
    expect(hasLeadWork({ id: 'lead_p1_ab12', task: 'lead', lead: work } as Agent)).toBe(true);
    expect(hasLeadWork({ id: 'lead_p1_ab12', task: 'lead' } as Agent)).toBe(false);
    expect(hasLeadWork({ id: 'agent_x', task: 'issue' } as Agent)).toBe(false);
  });
});

describe('closeCheck', () => {
  const pushed = { onOrigin: true, unpushed: 0 };
  const clean = [{ folder: 'web', dirty: false, branch: pushed }, { folder: 'api', dirty: false, branch: pushed }];

  it('closes without asking when everything reached GitHub and its pull requests are settled', () => {
    expect(closeCheck({ slice: 2, prs: [{ ...work.prs[0] }] }, 'focus/b', clean)).toEqual({ kind: 'ok' });
    // a later slice that hasn't shipped yet: earlier ones did
    expect(closeCheck({ slice: 2, prs: [] }, 'focus/b', clean)).toEqual({ kind: 'ok' });
  });

  it('warns about work only Ops’ clone has, pull requests it leaves behind, and a goal that shipped nothing', () => {
    expect(closeCheck(work, 'focus/b', [{ folder: 'web', dirty: true, branch: pushed }, clean[1]])).toEqual({
      kind: 'warn',
      reasons: ['Uncommitted changes in ./web are committed as a WIP snapshot on `focus/b`, kept only in the clone Ops keeps.', 'acme/api#7 stays open on GitHub, with no lead to fix it.'],
    });
    expect(closeCheck({ slice: 1, prs: [] }, 'focus/b', [{ folder: 'web', dirty: false, branch: { onOrigin: false, unpushed: 3 } }, { folder: 'api', dirty: false, branch: { onOrigin: true, unpushed: 1 } }])).toEqual({
      kind: 'warn',
      reasons: [
        './web’s branch `focus/b` never reached GitHub: its 3 commits stay only in the clone Ops keeps.',
        './api has 1 commit that never reached GitHub, kept only in the clone Ops keeps.',
        'The goal never shipped anything: no pull request was opened for it.',
      ],
    });
    // a branch GitHub never got, with nothing on it, loses nothing
    expect(closeCheck({ slice: 2, prs: [] }, 'focus/b', [{ folder: 'web', dirty: false, branch: { onOrigin: false, unpushed: 0 } }])).toEqual({ kind: 'ok' });
  });

  it('says so when git couldn’t tell how a checkout stands', () => {
    expect(closeCheck({ slice: 2, prs: [] }, 'focus/b', [{ folder: 'web', dirty: true }])).toEqual({
      kind: 'warn',
      reasons: ['Uncommitted changes in ./web are committed as a WIP snapshot on `focus/b`, kept only in the clone Ops keeps.', 'Couldn’t tell whether ./web’s commits reached GitHub.'],
    });
  });
});

describe('queuedStart', () => {
  const q = (id: string) => ({ id, text: id, at: 0 });
  const line = [q('a'), q('b'), q('c')];

  it('always starts a goal still in line, however many goals are under way', () => {
    expect(queuedStart(line, 'b', {})).toEqual({ kind: 'start', text: 'b' });
  });

  it('starts a queued goal with the user’s last words and effort on it, else the ones it was queued with', () => {
    const queued = [{ id: 'a', text: 'Saved items', effort: 'low' as const, from: 'the bridge', at: 0 }];
    expect(queuedStart(queued, 'a', {})).toEqual({ kind: 'start', text: 'Saved items', effort: 'low', from: 'the bridge' });
    expect(queuedStart(queued, 'a', { text: '  Wishlists ', effort: 'high' })).toEqual({ kind: 'start', text: 'Wishlists', effort: 'high', from: 'the bridge' });
    // words cleared in the editor aren't a goal: it keeps the ones it was queued with
    expect(queuedStart(queued, 'a', { text: '   ' })).toMatchObject({ text: 'Saved items' });
  });

  it('starts a queued goal shaped first if it was queued that way, unless the user unticks it as they start it', () => {
    const queued = [{ id: 'a', text: 'Saved items', shaping: true as const, at: 0 }];
    expect(queuedStart(queued, 'a', {})).toMatchObject({ shaping: true });
    expect(queuedStart(queued, 'a', { shaping: false })).not.toHaveProperty('shaping');
    expect(queuedStart([{ id: 'b', text: 'Wishlists', at: 0 }], 'b', { shaping: true })).toMatchObject({ shaping: true });
  });

  it('refuses a goal that has left the line', () => {
    expect(queuedStart(line, 'zz', {})).toEqual({ kind: 'refused', message: 'That goal is no longer in line' });
    expect(queuedStart(undefined, 'a', {})).toEqual({ kind: 'refused', message: 'That goal is no longer in line' });
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

describe('compactsFirst', () => {
  it('compacts a lead before a turn that picks a big conversation here back up, unless switched off or it already failed there', () => {
    const big = { sessionId: 's1', context: { percent: 25, tokens: 250_000, max: 1_000_000 } };
    expect(compactsFirst(big, true, 200_000)).toBe(true);
    expect(compactsFirst({ ...big, context: { percent: 20, tokens: 200_000, max: 1_000_000 } }, true, 200_000)).toBe(true);
    expect(compactsFirst({ ...big, context: { percent: 15, tokens: 150_000, max: 1_000_000 } }, true, 200_000)).toBe(false);
    expect(compactsFirst({ sessionId: 's1' }, true, 200_000)).toBe(false);
    expect(compactsFirst(big, false, 200_000)).toBe(false);
    expect(compactsFirst(big, true, 0)).toBe(false);
    expect(compactsFirst({ ...big, sessionId: undefined }, true, 200_000)).toBe(false);
    expect(compactsFirst(big, true, 200_000, 's1')).toBe(false);
    expect(compactsFirst(big, true, 200_000, 's0')).toBe(true);
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
});

describe('reopenable', () => {
  const lead = { id: 'lead_p1_ab', name: 'Lt. Okafor', sessionId: 's1', branch: 'focus/saved-items-2-ab12', startedAt: 10, lead: work } as LeadAgent;

  it('is a closed goal that kept its branch and the repos it was checked out from', () => {
    const record = goalRecord(lead, Date.UTC(2026, 9, 7, 12));
    expect(reopenable(record)).toBe(true);
    expect(reopenable({ ...record, branch: undefined, repos: undefined })).toBe(false);
  });
});

describe('verdictStands', () => {
  const idle = { wasIdle: true, finished: true, heard: false, queued: false, held: false };

  it('leaves an idle lead nobody woke waiting on the captain, and one in a turn working', () => {
    expect(verdictStands(idle)).toBe('idle');
    expect(verdictStands({ ...idle, wasIdle: false, finished: false })).toBe('working');
  });

  it('counts a lead as woken when a message picked them up, is held for the plan limit, waits for a turn, or brought the note into their session', () => {
    expect(verdictStands({ ...idle, finished: false })).toBe('woken');
    // held for your plan's usage limit: the status stays finished, but they carry on as it resets
    expect(verdictStands({ ...idle, held: true })).toBe('woken');
    expect(verdictStands({ ...idle, queued: true })).toBe('woken');
    // a message into a session still listening (idle, or mid-turn) took the note with it
    expect(verdictStands({ ...idle, heard: true })).toBe('woken');
    expect(verdictStands({ ...idle, wasIdle: false, finished: false, heard: true })).toBe('woken');
  });
});

describe('verdictToast', () => {
  const fail = { repo: 'acme/web', number: 12, verdict: 'fail' as const, failedRounds: 1, behind: false };

  it('tells the captain a lead left waiting on a QA fail waits on them, and how many times it has failed', () => {
    expect(verdictToast(fail, 'Lt. Okafor', 'idle')).toEqual({ level: 'error', text: '🙋 QA failed web#12: Lt. Okafor waits on you' });
    expect(verdictToast({ ...fail, failedRounds: 3 }, 'Lt. Okafor', 'idle')?.text).toBe('🙋 QA failed web#12 3 times: Lt. Okafor waits on you');
  });

  it('says a lead in a turn hears it with their next message, and nothing of one a plugin woke for it', () => {
    expect(verdictToast(fail, 'Lt. Okafor', 'working')).toEqual({ level: 'info', text: '🔧 QA failed web#12: Lt. Okafor hears it with their next message' });
    expect(verdictToast(fail, 'Lt. Okafor', 'woken')).toBeUndefined();
  });

  it('says nothing of a fail Ops sent to a developer instead: their own toast does', () => {
    expect(verdictToast(fail, 'Lt. Okafor', 'fixing')).toBeUndefined();
  });

  it('says nothing of a pass, or a verdict on a commit the lead has shipped past', () => {
    expect(verdictToast({ ...fail, verdict: 'pass' }, 'Lt. Okafor', 'idle')).toBeUndefined();
    expect(verdictToast({ ...fail, behind: true }, 'Lt. Okafor', 'idle')).toBeUndefined();
  });
});
