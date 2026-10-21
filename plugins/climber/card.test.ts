import { describe, expect, it } from 'vitest';
import { climbCard } from './card';
import { freshClimb, type Climb } from './shared';

const ago = (at: number) => `${at}m ago`;
const climb = (patch: Partial<Climb>): Climb => ({ ...freshClimb(), ...patch });
const pr = { number: 42, url: 'https://github.com/o/r/pull/42' };
const rhee = { id: 'climber', name: 'Lt. Rhee', activity: 'Running the scorecard' };
const away = () => undefined;

describe('climbCard', () => {
  it('says what climbing does while nothing is under way', () => {
    const card = climbCard(undefined, away, 'Lt. Rhee', ago);
    expect(card).toMatchObject({ keepClimbing: false, stoppedWhy: null, pr: null, now: null, last: null });
    expect(card.intro).toMatch(/^With Keep climbing on, Lt\. Rhee takes the scorecard’s worst gap/);
  });

  it('shows the climber at work, with the pull request they opened', () => {
    expect(climbCard(climb({ keepClimbing: true, agentId: 'climber' }), (id) => (id === 'climber' ? { ...rhee, pr } : undefined), 'Lt. Rhee', ago)).toMatchObject({
      keepClimbing: true, pr, now: { kind: 'climbing', id: 'climber', name: 'Lt. Rhee', activity: 'Running the scorecard' }, intro: null,
    });
  });

  it('takes the climber for gone once they’ve left the ship', () => {
    expect(climbCard(climb({ agentId: 'climber' }), away, 'Lt. Rhee', ago)).toMatchObject({ now: null, pr: null });
  });

  it('says a climb’s pull request waits on the captain once the climber has left', () => {
    expect(climbCard(climb({ pr }), away, 'Lt. Rhee', ago)).toMatchObject({ pr, now: { kind: 'waiting' }, intro: null });
  });

  it('says how the last climb ended, and why climbing stopped', () => {
    expect(climbCard(climb({ cycles: 3, last: { pr: 7, outcome: 'closed', at: 5 } }), away, 'Lt. Rhee', ago).last).toBe('Last climb (PR #7) closed unmerged 5m ago · 3 so far');
    expect(climbCard(climb({ cycles: 4, last: { outcome: 'nothing', at: 2 }, stoppedWhy: 'Nothing worth changing' }), away, 'Lt. Rhee', ago)).toMatchObject({
      last: 'Last climb found nothing to change 2m ago · 4 so far', stoppedWhy: 'Nothing worth changing',
    });
  });
});
