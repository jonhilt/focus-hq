import { describe, expect, it, vi } from 'vitest';
import type { Agent, Board, IssueDraft, NumberOneChat, Project, PullRequest, QaReview, Snapshot } from '../../shared/types';
import { Hub } from '../hub';
import { numberOneAfterRestart, Store } from '../store';
import { asNumberOneReply, NumberOne, type NumberOneOfficer, numberOnePrompt, numberOneReplySchema, numberOneSystemPrompt, type ShipStatus, summariseShip } from './numberOne';

const project = { id: 'p1', name: 'Shop', repos: ['acme/shop', 'acme/shop-api'] } as Project;
const agent = (patch: Partial<Agent>): Agent =>
  ({ id: 'a1', name: 'Ensign Reyes', projectId: 'p1', repo: 'acme/shop', task: 'issue', issue: { number: 12, title: 'Add a wishlist', url: '' }, status: 'working', activity: 'Editing src/cart.ts', ...patch }) as Agent;
const pr = (patch: Partial<PullRequest>): PullRequest =>
  ({ repo: 'acme/shop', number: 40, title: 'Wishlist', url: '', branch: 'b', headSha: 'abcdef1234', baseBranch: 'main', isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '', ...patch });

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    projects: [project],
    agents: [],
    boards: [],
    lines: {},
    browser: {},
    previews: [],
    drafts: [],
    reviews: [],
    ...patch,
  } as unknown as Snapshot;
}

const worktree = (id: string) => `/ws/${id}`;

describe('summariseShip', () => {
  it('lists each agent with their issue, status and worktree, without terminal lines or browser frames', () => {
    const status = summariseShip(
      snapshot({
        agents: [agent({})],
        lines: { a1: [{ t: 0, kind: 'text', text: 'SECRET TERMINAL LINE' }] },
        browser: { a1: { url: 'http://x', image: 'data:image/jpeg;base64,FRAME', at: 0 } },
      }),
      worktree,
    );
    expect(status.projects[0].agents).toEqual([{ name: 'Ensign Reyes', task: 'issue', repo: 'acme/shop', issue: '#12 Add a wishlist', status: 'working', activity: 'Editing src/cart.ts', worktree: '/ws/a1' }]);
    const text = JSON.stringify(status);
    expect(text).not.toContain('SECRET TERMINAL LINE');
    expect(text).not.toContain('FRAME');
  });

  it('gives a cloud agent no local worktree', () => {
    const status = summariseShip(snapshot({ agents: [agent({ cloud: true })] }), worktree);
    expect(status.projects[0].agents[0].worktree).toBeUndefined();
  });

  it('shows each open PR with QA’s verdict and its checks', () => {
    const review = { projectId: 'p1', repo: 'acme/shop', number: 40, status: 'passed', sha: 'abcdef1234' } as QaReview;
    const failing = pr({ number: 41, checks: 'failing', failedChecks: [{ name: 'build' }] });
    const status = summariseShip(snapshot({ boards: [{ projectId: 'p1', issues: [], prs: [pr({}), failing], updatedAt: 0 }], reviews: [review] }), worktree);
    expect(status.projects[0].prs).toEqual([
      { repo: 'acme/shop', number: 40, title: 'Wishlist', author: undefined, draft: false, qa: '✅ QA passed', checks: 'passing', conflicts: false },
      { repo: 'acme/shop', number: 41, title: 'Wishlist', author: undefined, draft: false, qa: 'not tested', checks: 'failing', failedChecks: ['build'], conflicts: false },
    ]);
  });

  it('collects what needs the captain: raised hands, problems, conflicts, stuck PRs, merges and drafts', () => {
    const board: Board = { projectId: 'p1', issues: [], prs: [pr({}), pr({ number: 41, mergeable: 'CONFLICTING' }), pr({ number: 42 })], updatedAt: 0 };
    const reviews = [
      { repo: 'acme/shop', number: 40, status: 'passed', sha: 'abcdef1234' },
      { repo: 'acme/shop', number: 42, status: 'failed', sha: 'abcdef1234', followUp: { kind: 'needs-you', reason: 'Failed three rounds' } },
    ] as QaReview[];
    const status = summariseShip(
      snapshot({
        agents: [agent({ status: 'waiting', permission: { id: 'x', tool: 'Bash', summary: 'rm -rf dist', at: 0 } }), agent({ id: 'a2', name: 'Lt. Novak', status: 'error', error: 'Out of credit' })],
        boards: [board],
        reviews,
        drafts: [{ projectId: 'p1', status: 'ready', idea: 'wishlists', title: 'Add wishlists' } as IssueDraft],
      }),
      worktree,
    );
    expect(status.projects[0].needsCaptain).toEqual([
      'Ensign Reyes has a hand up: rm -rf dist',
      'Lt. Novak hit a problem: Out of credit',
      'acme/shop#40 passed QA: ready to merge',
      'acme/shop#41 conflicts with main',
      'acme/shop#42 failed QA and needs you: Failed three rounds',
      'An issue draft is waiting at the stand: “Add wishlists”',
    ]);
  });

  it('trims long PR lists and titles', () => {
    const prs = Array.from({ length: 20 }, (_, i) => pr({ number: i + 1, title: 'x'.repeat(200) }));
    const status = summariseShip(snapshot({ boards: [{ projectId: 'p1', issues: [], prs, updatedAt: 0 }] }), worktree);
    expect(status.projects[0].prs).toHaveLength(15);
    expect(status.projects[0].morePrs).toBe(5);
    expect(status.projects[0].prs[0].title.length).toBe(80);
  });

  it('says which slice the project’s lead is on, not an issue', () => {
    const lead = agent({ id: 'lead_p1', task: 'lead', issue: { number: 0, title: 'Shop’s lead', url: '' }, lead: { repos: [], slice: 2, prs: [] } });
    expect(summariseShip(snapshot({ agents: [lead] }), worktree).projects[0].agents[0].issue).toBe('Slice 2, with the captain');
  });
});

describe('numberOneSystemPrompt', () => {
  const prompt = numberOneSystemPrompt({ projects: [project], workspaces: '/ws' });

  it('lists each project’s id and where its repos are checked out', () => {
    expect(prompt).toContain('Shop, id `p1`: `p1/shop/` (acme/shop), `p1/shop-api/` (acme/shop-api)');
  });

  it('keeps worktrees for what an agent has done, not how the code works', () => {
    expect(prompt).toContain('/ws');
    expect(prompt).toMatch(/half-finished work/);
    expect(prompt).toMatch(/never to explain how the code works/);
  });

  it('says Number One never acts, only suggests, and relays a failed checkout', () => {
    expect(prompt).toMatch(/never file, push, edit, start agents, draft issues or talk to the lead/);
    expect(prompt).toMatch(/the checkout failed and for which project/);
  });
});

describe('numberOnePrompt', () => {
  const messages: NumberOneChat['messages'] = [
    { from: 'manager', text: 'What’s going on?', at: 0 },
    { from: 'number-one', text: 'All quiet.', at: 1 },
    { from: 'manager', text: 'How does auth work?', at: 2 },
  ];

  it('sends only the new message when resuming the session', () => {
    expect(numberOnePrompt({ messages, resumeSessionId: 's1' })).toBe('The captain says:\n"""\nHow does auth work?\n"""');
  });

  it('recaps the conversation without a session', () => {
    const prompt = numberOnePrompt({ messages });
    expect(prompt).toContain('Captain: What’s going on?\n\nYou: All quiet.');
    expect(prompt).toMatch(/How does auth work\?\n"""$/);
  });

  it('carries messages left unanswered by a failed turn', () => {
    const prompt = numberOnePrompt({ messages: [...messages, { from: 'manager', text: 'And payments?', at: 3 }], resumeSessionId: 's1' });
    expect(prompt).toContain('How does auth work?\n\nAnd payments?');
  });
});

describe('Number One’s reply', () => {
  it('offers `suggest` only for the projects aboard', () => {
    const schema = numberOneReplySchema(['p1']) as { properties: Record<string, { properties?: Record<string, { enum?: string[] }> }>; required: string[] };
    expect(schema.required).toEqual(['reply', 'spoken']);
    expect(schema.properties.suggest.properties!.projectId.enum).toEqual(['p1']);
    expect(numberOneReplySchema([])).not.toHaveProperty('properties.suggest');
  });

  it('decodes a reply with a suggestion for a real project', () => {
    expect(asNumberOneReply({ reply: ' Yes. ', spoken: 'Yes.', suggest: { projectId: 'p1', idea: ' Add wishlists ' } }, 'fallback', ['p1'])).toEqual({
      text: 'Yes.',
      spoken: 'Yes.',
      suggest: { projectId: 'p1', idea: 'Add wishlists' },
    });
  });

  it('has no suggestion on an ordinary reply, or one for an unknown project', () => {
    expect(asNumberOneReply({ reply: 'Hi', spoken: 'Hi' }, '', ['p1'])).not.toHaveProperty('suggest');
    expect(asNumberOneReply({ reply: 'Hi', spoken: 'Hi', suggest: { projectId: 'nope', idea: 'x' } }, '', ['p1'])).not.toHaveProperty('suggest');
    expect(asNumberOneReply({ reply: 'Hi', spoken: 'Hi', suggest: { projectId: 'p1', idea: ' ' } }, '', ['p1'])).not.toHaveProperty('suggest');
  });

  it('falls back to the session’s text without a structured result', () => {
    expect(asNumberOneReply(undefined, 'Plain text', [])).toEqual({ text: 'Plain text', spoken: undefined });
  });
});

describe('NumberOne', () => {
  const ship: ShipStatus = { projects: [] };

  function setup(officer: NumberOneOfficer['turn']) {
    const store = new Store(false);
    store.projects = [project];
    const turn = vi.fn(officer);
    const numberOne = new NumberOne(store, new Hub(), { turn }, async () => ship);
    const settled = () => vi.waitFor(() => expect(numberOne.current().status).not.toBe('thinking'));
    return { store, numberOne, turn, settled };
  }

  it('answers, keeping the session, and resumes it on the next message', async () => {
    const { numberOne, turn, settled } = setup(async () => ({ text: 'All quiet.', spoken: 'All quiet, Captain.', sessionId: 's1', costUsd: 0.1, suggest: { projectId: 'p1', idea: 'x' } }));
    numberOne.say('What’s going on?');
    await settled();
    expect(numberOne.current().messages.map((m) => m.from)).toEqual(['manager', 'number-one']);
    expect(numberOne.current().messages[1]).toMatchObject({ text: 'All quiet.', spoken: 'All quiet, Captain.', suggest: { projectId: 'p1', idea: 'x' } });
    expect(numberOne.current()).not.toHaveProperty('sessionId');
    numberOne.say('And now?');
    await settled();
    expect(turn.mock.calls[0][0].resumeSessionId).toBeUndefined();
    expect(turn.mock.calls[1][0].resumeSessionId).toBe('s1');
    expect(turn.mock.calls[1][0].projects).toEqual([{ id: 'p1', name: 'Shop', repos: ['acme/shop', 'acme/shop-api'] }]);
    expect(numberOne.current().costUsd).toBeCloseTo(0.2);
  });

  it('refuses a message while still thinking', () => {
    const { numberOne } = setup(() => new Promise(() => undefined));
    numberOne.say('Hello');
    expect(() => numberOne.say('Hello again')).toThrow(/still thinking/);
  });

  it('starts a new conversation with a clear log and a fresh session, dropping the reply in flight', async () => {
    let answer: (text: string) => void = () => undefined;
    const { numberOne, turn, settled } = setup(async (req) => {
      if (req.messages.at(-1)!.text === 'One') return { text: 'first', sessionId: 's1' };
      return new Promise((resolve) => (answer = (text) => resolve({ text, sessionId: 's2' })));
    });
    numberOne.say('One');
    await settled();
    numberOne.say('Two');
    numberOne.newConversation();
    answer('too late');
    await new Promise((resolve) => setTimeout(resolve));
    expect(numberOne.current().messages).toEqual([]);
    expect(numberOne.current().status).toBe('waiting');
    expect(turn.mock.calls[1][0].signal.aborted).toBe(true);
    numberOne.say('Three');
    expect(turn.mock.calls[2][0].resumeSessionId).toBeUndefined();
  });

  it('keeps the chat usable after a failed turn', async () => {
    let fail = true;
    const { numberOne, settled } = setup(async () => {
      if (fail) throw new Error('Offline');
      return { text: 'Back again', sessionId: 's1' };
    });
    numberOne.say('Hello');
    await settled();
    expect(numberOne.current()).toMatchObject({ status: 'failed', error: 'Offline' });
    fail = false;
    numberOne.say('Hello?');
    await settled();
    expect(numberOne.current()).toMatchObject({ status: 'waiting', error: undefined });
  });

  it('ends a turn interrupted by a restart, keeping the session for the next message', () => {
    const saved = { status: 'thinking' as const, activity: 'Reading', messages: [{ from: 'manager' as const, text: 'Hi', at: 0 }], updatedAt: 0, costUsd: 0, sessionId: 's1' };
    expect(numberOneAfterRestart(saved)).toMatchObject({ status: 'failed', sessionId: 's1', messages: saved.messages, error: expect.stringMatching(/Interrupted/) });
    const waiting = { ...saved, status: 'waiting' as const };
    expect(numberOneAfterRestart(waiting)).toBe(waiting);
  });
});
