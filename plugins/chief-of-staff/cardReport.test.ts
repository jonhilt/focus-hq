import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/server';
import { leadNames, mins, missedLines, summaryLines, tally } from './cardReport';
import type { Card } from './cardReplay';

const card = (c: Partial<Card> = {}): Card => ({
  agentId: 'lead_proj_a_1', projectId: 'proj_a', turn: 't1', openedAt: 0, route: 2, outcome: 'captain', captainSpoke: false, messages: [], decisions: [], ...c,
});

describe('card replay’s report', () => {
  it('names each lead from the saved state, and the closed goals’ from the ledger', () => {
    const closed = { kind: 'goal-closed', at: 1, projectId: 'p', goal: { id: 'lead_old', leadName: 'Lt. Old', title: 'Gone' } } as unknown as LedgerEvent;
    const saved = { agents: [{ id: 'lead_now', task: 'lead', name: 'Lt. Now', lead: { title: 'Here' } }, { id: 'dev', task: 'issue', name: 'Ens. Dev' }, { id: 'lead_bare', task: 'lead' }, 'junk'] };
    expect([...leadNames([closed], saved)]).toEqual([
      ['lead_old', { name: 'Lt. Old', goal: 'Gone' }],
      ['lead_now', { name: 'Lt. Now', goal: 'Here' }],
      ['lead_bare', { name: undefined, goal: undefined }],
    ]);
    expect(leadNames([], undefined).size).toBe(0);
  });

  it('says a wait in minutes, then hours, and counts things most first', () => {
    expect(mins(undefined)).toBe('—');
    expect(mins(90_000)).toBe('2m');
    expect(mins(5_400_000)).toBe('1.5h');
    expect(tally(['qa', 'restart', 'qa'], 'nothing')).toBe('qa 2, restart 1');
    expect(tally([], 'nothing')).toBe('nothing');
  });

  it('sums the cards up per route, and what wiped the ones the captain didn’t answer', () => {
    const cards = [
      card({ outcome: 'captain', waitMs: 60_000 }),
      card({ agentId: 'lead_proj_a_2', outcome: 'superseded', by: 'slice-landed', mergedBy: 'auto', route: 1 }),
      card({ outcome: 'superseded', by: 'qa', route: 'unjudged' }),
    ];
    const lines = summaryLines(cards, { project: 'proj_a' });
    expect(lines[1]).toBe('3 cards from 2 goal leads in proj_a');
    expect(lines.find((l) => l.startsWith('2 card'))).toMatch(/1m$/);
    expect(lines).toContain('superseded by: slice-landed 1, qa 1');
    expect(lines).toContain('slices landed, merged by: auto 1');
    expect(summaryLines([], {})).toContain('superseded by: nothing');
  });

  it('lists the cards the captain needed that were wiped, with what wiped them', () => {
    const wiped = card({ outcome: 'superseded', by: 'slice-landed', mergedBy: 'auto', why: 'A real decision', lead: 'Lt. Vale', goal: 'Wishlist', waitMs: 120_000, captainSpoke: true, waker: { sender: 'slice-landed', at: 1, text: '[Ops] Slice 1 has landed', how: 'queued' } });
    const lines = missedLines([wiped, card({ outcome: 'superseded', by: 'none', route: 3 }), card({ outcome: 'captain' })]);
    expect(lines[1]).toBe('2 cards the captain needed (route 2 or 3), wiped by something else before they answered:');
    expect(lines.some((l) => l.endsWith('Lt. Vale · Wishlist  [route 2]'))).toBe(true);
    expect(lines).toContain('    why: A real decision');
    expect(lines).toContain('    wiped by slice-landed (merged by auto) after 2m (the captain had said something): [Ops] Slice 1 has landed');
    expect(lines).toContain('    wiped by none after —: (no message: Ops started the turn)');
  });
});
