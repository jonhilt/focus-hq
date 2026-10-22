import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/server';
import { answersById, cardText, liveRoutes, type FreshTurn, freshTurns, labelCards, pickSample } from './jevFresh';

const replies = (key: string, goal: string, ...ats: string[]): LedgerEvent => ({
  kind: 'captain-replies', key, sessionId: key.split(':')[0], agent: 'Lt. Reyes', goal,
  replies: ats.map((at, i) => ({ at, lead: `lead ${i}`, captain: `reply ${i}` })), at: 0, projectId: 'p', seq: 1,
});
const verdict = (sessionId: string, turnUuid: string, route: 1 | 2 | 3 | 4, version: string): LedgerEvent => ({
  kind: 'cos-verdict', sessionId, agent: 'Lt. Reyes', turnUuid, route, why: 'w', model: 'haiku', version, at: 0, projectId: 'p', seq: 2,
});

describe('freshTurns', () => {
  it('keeps the replies since the date, keyed as replies.jsonl keys them, with the live judge’s latest route', () => {
    const turns = freshTurns([
      replies('s1:t1', 'Goal A', '2026-10-19T10:00:00Z', '2026-10-20T10:00:00Z'),
      verdict('s1', 't1', 4, 'v7'),
      verdict('s1', 't1', 2, 'v8'),
      replies('s2:t2', 'Goal B', '2026-10-21T10:00:00Z'),
    ], '2026-10-20');
    expect(turns).toEqual([
      { id: 's1:t1#1', goal: 'Goal A', agent: 'Lt. Reyes', at: '2026-10-20T10:00:00Z', lead: 'lead 1', captain: 'reply 1', live: { route: 2, version: 'v8' } },
      { id: 's2:t2#0', goal: 'Goal B', agent: 'Lt. Reyes', at: '2026-10-21T10:00:00Z', lead: 'lead 0', captain: 'reply 0' },
    ]);
  });

  it('leaves out the chief of staff’s own words and turns the captain stopped part-way', () => {
    const e = replies('s1:t1', 'Goal A', '2026-10-21T10:00:00Z', '2026-10-21T11:00:00Z', '2026-10-21T12:00:00Z');
    if (e.kind === 'captain-replies') {
      e.replies[0].captain = '[Chief of Staff] Carry on.';
      e.replies[1].captain = '[Request interrupted by user]';
    }
    expect(freshTurns([e], '2026-10-20').map((t) => t.id)).toEqual(['s1:t1#2']);
  });

  it('leaves out the goals it’s told to', () => {
    expect(freshTurns([replies('s1:t1', 'This goal', '2026-10-21T10:00:00Z')], '2026-10-20', (g) => g === 'This goal')).toEqual([]);
  });
});

describe('pickSample', () => {
  const turn = (id: string, goal: string, at: string): FreshTurn => ({ id, goal, agent: 'a', at, lead: '', captain: '' });
  const turns = [turn('a', 'G1', '4'), turn('b', 'G1', '3'), turn('c', 'G1', '2'), turn('d', 'G2', '1')];
  it('takes turns in rank order, at most so many a goal, and gives them back in time order', () => {
    expect(pickSample(turns, 3, 2, (id) => id).map((t) => t.id)).toEqual(['d', 'b', 'a']);
  });
  it('stops at the count', () => {
    expect(pickSample(turns, 1, 2, (id) => id).map((t) => t.id)).toEqual(['a']);
  });
});

describe('labelCards', () => {
  it('escapes what the lead and captain said, keeping bold and code', () => {
    expect(cardText('<b> **yes** `x` & "q"')).toBe('&lt;b&gt; <b>yes</b> <code>x</code> &amp; &quot;q&quot;');
  });

  it('numbers the cards from 1, marks a cut start, and can’t be broken out of by a script tag', () => {
    const html = labelCards([{ id: 'x', goal: 'G', agent: 'Lt. Reyes', at: '1', lead: '[−900]… the end', captain: '</script><script>alert(1)' }]);
    expect(html).toContain('"n":1');
    expect(html).toContain('"cut":true');
    expect(html).not.toContain('</script><script>alert');
  });
});

describe('reading the fresh files', () => {
  it('reads the live judge’s route where there is one', () => {
    expect([...liveRoutes([{ id: 'a', live: { route: 3 } }, { id: 'b' }, { id: 'c', live: { route: 9 } }, 'x'])]).toEqual([['a', 3]]);
  });
  it('reads Jev’s answers by turn', () => {
    expect([...answersById([{ id: 'a', answers: { new_slice: { noul: 0.4 } } }, { answers: {} }])]).toEqual([['a', { new_slice: { noul: 0.4 } }]]);
  });
});
