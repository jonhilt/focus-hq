import { describe, expect, it } from 'vitest';
import type { Agent, LedgerEvent } from '../../plugin-api/shared';
import { heldForRead, lanePrompt, laneSystemPrompt, lostRaise, parseLane, pickOf, unreadShip } from './laneJudge';

type Pr = { repo: string; number: number; url: string; sha?: string; lane?: 'ship' | 'show' | 'ask'; outcome?: 'merged' | 'closed' };
const pr = (number: number, more: Partial<Pr> = {}): Pr => ({ repo: 'acme/shop', number, url: '', sha: `sha${number}`, lane: 'ship', ...more });
const lead = (prs: Pr[]): Pick<Agent, 'lead'> => ({ lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs } });
const read = (prs: { pr: number; sha: string }[], to: 'ship' | 'show' | 'ask' = 'ship'): LedgerEvent => ({
  kind: 'cos-lane', seq: 1, at: 1, projectId: 'p', agent: 'Lt. Vale', prs: prs.map((p) => ({ repo: 'acme/shop', ...p })), from: 'ship', to, why: to === 'ship' ? 'Safe.' : 'It changes a card.', model: 'haiku', version: 'lane-v1',
});

describe('the chief of staff’s answer on a ship’s lane', () => {
  it('raises the lead’s pick, or keeps it', () => {
    expect(parseLane({ lane: 'ask', why: 'It changes what the captain sees.' }, 'ship')).toEqual({ lane: 'ask', why: 'It changes what the captain sees.' });
    expect(parseLane({ lane: 'show', why: 'Keep.' }, 'show')).toEqual({ lane: 'show', why: 'Keep.' });
  });

  it('never lowers it, whatever it answers', () => {
    expect(parseLane({ lane: 'ship', why: 'Looks safe.' }, 'show')).toEqual({ lane: 'show', why: 'Looks safe.' });
  });

  it('isn’t one without a lane it knows, or a reason', () => {
    expect(parseLane({ lane: 'merge', why: 'x' }, 'ship')).toBeUndefined();
    expect(parseLane({ lane: 'ask', why: ' ' }, 'ship')).toBeUndefined();
  });
});

describe('the ships it has still to read', () => {
  it('is a lead’s open pull requests in Ship or Show, until a read covers each at the commit it’s at', () => {
    const prs = [pr(7), pr(8, { lane: 'show' }), pr(9, { lane: 'ask' }), pr(10, { outcome: 'merged' })];
    expect(unreadShip(lead(prs), []).map((p) => p.number)).toEqual([7, 8]);
    expect(unreadShip(lead(prs), [read([{ pr: 7, sha: 'sha7' }, { pr: 8, sha: 'sha8' }])])).toEqual([]);
  });

  it('is read again once the lead ships a new commit', () => {
    expect(unreadShip(lead([pr(7, { sha: 'newer' })]), [read([{ pr: 7, sha: 'sha7' }])]).map((p) => p.number)).toEqual([7]);
  });

  it('holds a pull request back from merging by itself until then, and only one a read could raise', () => {
    expect(heldForRead(pr(7), [])).toBe('the chief of staff hasn’t read its lane yet');
    expect(heldForRead(pr(7), [read([{ pr: 7, sha: 'sha7' }])])).toBeUndefined();
    expect(heldForRead(pr(9, { lane: 'ask' }), [])).toBeUndefined();
  });

  it('keeps holding one a read raised, until the raise is in its lane (a restart lost it), and says which to take again', () => {
    const ledger = [read([{ pr: 7, sha: 'sha7' }, { pr: 8, sha: 'sha8' }], 'show'), read([{ pr: 8, sha: 'sha8' }], 'ask')];
    expect(heldForRead(pr(7), ledger)).toBe('the chief of staff raised it to Show');
    expect(lostRaise(lead([pr(7), pr(8)]), ledger)).toEqual({ lane: 'ask', why: 'It changes a card.' });
    expect(heldForRead(pr(7, { lane: 'show' }), ledger)).toBeUndefined();
    expect(lostRaise(lead([pr(7, { lane: 'show' }), pr(8, { lane: 'ask' })]), ledger)).toBeUndefined();
  });

  it('takes the lowest lane of its pull requests as the lead’s pick', () => {
    expect(pickOf([pr(7, { lane: 'show' }), pr(8)])).toBe('ship');
    expect(pickOf([pr(7, { lane: 'show' })])).toBe('show');
  });
});

describe('what it reads of a ship', () => {
  it('is the goal, the ship’s title and description, the lead’s pick and the recap', () => {
    const prompt = lanePrompt({
      goal: 'Wishlist', title: 'Save for later', summary: 'Adds a button.', lane: 'ship',
      recap: { primitives: [{ id: 'save-button', group: 'shop', impact: 'composes', change: 'wired in', paths: ['x'] }], invariants: ['Nothing saved twice'], flow: [{ from: 'shopper', to: 'save-button', label: 'presses' }] },
    });
    expect(prompt).toContain('The lead\'s pick: Ship (it merges itself once QA passes it)');
    expect(prompt).toContain('- save-button (shop), composes: wired in');
    expect(prompt).toContain('- Nothing saved twice');
    expect(prompt).toContain('- shopper → save-button: presses');
  });

  it('goes by the captain’s standing orders, or the rules alone', () => {
    expect(laneSystemPrompt('Always ask about UI.')).toContain("past replies:\nAlways ask about UI.");
    expect(laneSystemPrompt()).toContain('None yet');
  });
});
