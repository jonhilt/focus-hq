import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/shared';
import { capped, UNATTENDED_ROUNDS, unattendedRounds } from './roundRules';
import type { Verdict } from './shared';

const lead = { name: 'Lt. Reyes', projectId: 'p1', sessionId: 's1' };
let seq = 0;
const line = (e: Record<string, unknown>): LedgerEvent => ({ at: ++seq, projectId: 'p1', seq, ...e }) as LedgerEvent;
const verdict = (o: Record<string, unknown> = {}) => line({ kind: 'cos-verdict', sessionId: 's1', agent: lead.name, turnUuid: `u${seq}`, route: 1, why: '', model: 'haiku', version: 'v9', ...o });
const decided = (o: Record<string, unknown> = {}) => line({ kind: 'captain-decision', agent: lead.name, item: { id: 'turn:a:1', kind: 'turn', what: '' }, answer: 'Go on', via: 'office', ...o });

describe('unattendedRounds', () => {
  it('counts the lead’s judged turns since the captain last decided, but the one the captain started', () => {
    expect(unattendedRounds([], lead)).toBe(0);
    expect(unattendedRounds([verdict()], lead)).toBe(0);
    expect(unattendedRounds([verdict(), decided(), verdict(), verdict(), verdict()], lead)).toBe(2);
  });

  it('doesn’t count the chief of staff’s own sends as the captain deciding', () => {
    expect(unattendedRounds([decided(), verdict(), decided({ via: 'chief-of-staff' }), verdict(), verdict()], lead)).toBe(2);
  });

  it('counts only this lead’s session, in their project, and stops at the captain’s decision for them alone', () => {
    const others = [verdict({ sessionId: 's2' }), { ...verdict(), projectId: 'p2' }, decided({ agent: 'Lt. Okafor' }), { ...decided(), projectId: 'p2' }];
    expect(unattendedRounds([decided(), verdict(), ...others, verdict()], lead)).toBe(1);
  });
});

describe('capped', () => {
  const carryOn: Verdict = { route: 1, ask: 'Start slice 2', why: 'It said what’s next.', message: 'Carry on with slice 2.', replies: [{ label: 'Close it', text: 'Close the goal.' }] };

  it('leaves a turn alone until the rounds reach the cap', () => {
    expect(capped(carryOn, UNATTENDED_ROUNDS - 1)).toBe(carryOn);
  });

  it('makes a turn it would carry on or send back a card at the cap, its words offered as a reply', () => {
    for (const route of [1, 4] as const) {
      expect(capped({ ...carryOn, route }, UNATTENDED_ROUNDS)).toEqual({
        route: 2,
        ask: `${UNATTENDED_ROUNDS} rounds without you: Start slice 2`,
        why: `${UNATTENDED_ROUNDS} rounds in a row went back and forth without you, so this one waits for you. It said what’s next.`,
        message: 'It would tell the lead: “Carry on with slice 2.”',
        replies: [{ label: 'Send its words', text: 'Carry on with slice 2.' }, { label: 'Close it', text: 'Close the goal.' }],
      });
    }
  });

  it('leaves a card or an interrupt as it is, and offers no reply for words too long to be one', () => {
    expect(capped({ ...carryOn, route: 3 }, 9)).toEqual({ ...carryOn, route: 3 });
    expect(capped({ route: 1, ask: 'a', why: 'b', message: 'x'.repeat(501) }, 9)).not.toHaveProperty('replies');
  });
});
