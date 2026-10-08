import { describe, expect, it } from 'vitest';
import { prKey } from './qa';
import { inFlight, needsYou } from './tricorder';
import type { Agent, PullRequest, QaReview } from './types';
import { QA_DESK } from './types';

const agent = (a: Partial<Agent> = {}): Agent => ({
  id: 'a1',
  name: 'Ada',
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  projectId: 'p',
  repo: 'acme/shop',
  task: 'issue',
  issue: { number: 7, title: 'Wishlist', url: 'https://github.com/acme/shop/issues/7' },
  desk: 0,
  status: 'working',
  activity: 'Editing cart.ts',
  branch: 'focus/7-wishlist',
  baseBranch: 'main',
  costUsd: 0,
  startedAt: 1,
  ...a,
});

const pr = (p: Partial<PullRequest> = {}): PullRequest => ({
  repo: 'acme/shop',
  number: 12,
  title: 'Save for later',
  url: 'https://github.com/acme/shop/pull/12',
  branch: 'focus/7-wishlist',
  headSha: 'abc1234def5678',
  baseBranch: 'main',
  isDraft: false,
  mergeable: 'MERGEABLE',
  checks: 'passing',
  failedChecks: [],
  closes: [7],
  createdAt: '2026-01-01T00:00:00Z',
  ...p,
});

const failedNeedsYou: QaReview = {
  projectId: 'p',
  repo: 'acme/shop',
  number: 12,
  title: 'Save for later',
  status: 'failed',
  sha: 'abc1234def5678',
  followUp: { kind: 'needs-you', reason: 'it failed QA 3 times' },
  requestedAt: 0,
};

describe('needsYou', () => {
  it('is all clear when nobody waits and no PR is stuck', () => {
    expect(needsYou([agent(), agent({ id: 'a2', status: 'done' })], [{ projectId: 'p', pr: pr() }], new Map())).toEqual([]);
  });

  it('lists agents with a raised hand and agents in error', () => {
    const hand = agent({ status: 'waiting', permission: { id: 'r1', tool: 'Bash', summary: 'rm -rf dist', at: 0 } });
    const broken = agent({ id: 'a2', status: 'error', error: 'boom' });
    expect(needsYou([hand, broken, agent({ id: 'a3' })], [], new Map())).toEqual([
      { kind: 'hand', agent: hand },
      { kind: 'error', agent: broken },
    ]);
  });

  it('lists a lead waiting for a reply until their turn is read, and a lead ready to wrap up whether read or not', () => {
    const turn = agent({ task: 'lead', status: 'done', finishedAt: 5, lead: { title: 'Wishlist', station: 0, repos: [], slice: 1, prs: [] } });
    const closing = agent({ id: 'a2', task: 'lead', status: 'done', finishedAt: 6, lead: { title: 'Search', station: 1, repos: [], slice: 2, prs: [], closing: { reason: 'all merged', at: 6 } } });
    const working = agent({ id: 'a3', task: 'lead', lead: turn.lead });
    expect(needsYou([turn, closing, working], [], new Map())).toEqual([
      { kind: 'turn', agent: turn },
      { kind: 'wrap-up', agent: closing },
    ]);
    const read = { ...turn, lead: { ...turn.lead!, readTurn: 5 } };
    const closingRead = { ...closing, lead: { ...closing.lead!, readTurn: 6 } };
    expect(needsYou([read, closingRead], [], new Map())).toEqual([{ kind: 'wrap-up', agent: closingRead }]);
    // the next turn is news again
    const next = { ...read, finishedAt: 9 };
    expect(needsYou([next], [], new Map())).toEqual([{ kind: 'turn', agent: next }]);
  });

  it('lists a PR QA gave up on, but not one QA sent back to a developer', () => {
    const stuck = pr();
    const fixing = pr({ number: 13 });
    const reviews = new Map([
      [prKey('acme/shop', 12), failedNeedsYou],
      [prKey('acme/shop', 13), { ...failedNeedsYou, number: 13, followUp: { kind: 'fixing' as const, agentId: 'a1', agentName: 'Ada', fixes: { kind: 'qa' as const } } }],
    ]);
    expect(needsYou([], [{ projectId: 'p', pr: stuck }, { projectId: 'p', pr: fixing }], reviews)).toEqual([{ kind: 'qa', projectId: 'p', pr: stuck }]);
  });

  it('ignores a needs-you verdict on an older commit', () => {
    const pushedSince = pr({ headSha: 'fff0000aaa' });
    expect(needsYou([], [{ projectId: 'p', pr: pushedSince }], new Map([[prKey('acme/shop', 12), failedNeedsYou]]))).toEqual([]);
  });

  it('lists conflicting PRs', () => {
    const conflicting = pr({ mergeable: 'CONFLICTING' });
    expect(needsYou([], [{ projectId: 'p', pr: conflicting }, { projectId: 'p', pr: pr({ number: 14, mergeable: 'UNKNOWN' }) }], new Map())).toEqual([
      { kind: 'conflicts', projectId: 'p', pr: conflicting },
    ]);
  });

  it('leaves out a conflicting PR someone is resolving', () => {
    const resolving = { ...pr({ mergeable: 'CONFLICTING' }), resolver: agent({ task: 'conflicts' }) };
    expect(needsYou([], [{ projectId: 'p', pr: resolving }], new Map())).toEqual([]);
  });
});

describe('inFlight', () => {
  it('keeps the project’s running and queued agents, oldest first', () => {
    const queued = agent({ id: 'q', status: 'queued', startedAt: 3 });
    const working = agent({ id: 'w', status: 'working', startedAt: 2 });
    const waiting = agent({ id: 'h', status: 'waiting', startedAt: 1 });
    const done = agent({ id: 'd', status: 'done' });
    const elsewhere = agent({ id: 'x', projectId: 'other' });
    expect(inFlight('p', [queued, working, done, elsewhere, waiting, agent({ id: 'e', status: 'error' }), agent({ id: 's', status: 'stopped' })]).map((a) => a.id)).toEqual(['h', 'w', 'q']);
  });

  it('counts the QA officer only while they review', () => {
    const qa = agent({ id: 'qa', task: 'review', desk: QA_DESK, status: 'testing' });
    expect(inFlight('p', [qa]).map((a) => a.id)).toEqual(['qa']);
    expect(inFlight('p', [{ ...qa, status: 'done' }])).toEqual([]);
  });
});
