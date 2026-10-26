import { describe, expect, it } from 'vitest';
import type { Agent } from '../../plugin-api/shared';
import { countdown, cosMove, SENDING_MS } from './moveRules';
import { CHIEF_OF_STAFF, type CosRead, JUDGING_MS, type Verdict } from './shared';

const verdict = (route: Verdict['route']): Verdict => ({ route, ask: 'Write the wishlist tests next', why: 'w', message: 'm' });
const lead = (read?: CosRead, status: Agent['status'] = 'done'): Pick<Agent, 'status' | 'lead'> => ({
  status,
  lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: [], ...(read && { marks: { [CHIEF_OF_STAFF]: read } }) },
});

describe('the chief of staff’s hold on a goal’s move', () => {
  it('holds it while it reads the turn, and hands it to the captain once that takes too long', () => {
    expect(cosMove(lead({ at: 1000 }), 1000 + JUDGING_MS - 1)).toEqual({ why: 'Reading the turn, to see where it goes' });
    expect(cosMove(lead({ at: 1000 }), 1000 + JUDGING_MS)).toEqual({ why: 'The chief of staff couldn’t read the turn in time: it’s yours', captain: true });
  });

  it('holds it while its words for the lead count down to sending themselves', () => {
    expect(cosMove(lead({ at: 1, judged: verdict(4), sendsAt: 100_001 }), 1)).toEqual({ why: 'Back to the lead: Write the wishlist tests next — sends by itself unless you hold it', counter: '1:40' });
  });

  it('holds it at 0:00 while its words go, and hands it to the captain if they don’t', () => {
    const sending = lead({ at: 1, judged: verdict(4), sendsAt: 10_000 });
    expect(cosMove(sending, 10_000)).toEqual({ why: 'Back to the lead: Write the wishlist tests next — sending it now', counter: '0:00' });
    expect(cosMove(sending, 10_000 + SENDING_MS - 1)?.captain).toBeUndefined();
    expect(cosMove(sending, 10_000 + SENDING_MS)).toEqual({ why: 'Back to the lead: Write the wishlist tests next — ready for you to send from Comms', captain: true });
  });

  it('hands the captain a card, an interrupt, and words they held or that don’t send themselves', () => {
    expect(cosMove(lead({ at: 1, judged: verdict(2) }), 2)).toEqual({ why: 'A card for you: Write the wishlist tests next', captain: true });
    expect(cosMove(lead({ at: 1, judged: verdict(3) }), 2)).toEqual({ why: 'An interrupt for you: Write the wishlist tests next', captain: true });
    expect(cosMove(lead({ at: 1, judged: verdict(1) }), 2)).toEqual({ why: 'Carry on: Write the wishlist tests next — ready for you to send from Comms', captain: true });
    expect(cosMove(lead({ at: 1, judged: verdict(4) }), 2)?.captain).toBe(true);
  });

  it('hands the captain a turn they acknowledged, quietly, whatever it made of it', () => {
    for (const r of [{ at: 1, acked: 2 }, { at: 1, judged: verdict(2), acked: 2 }, { at: 1, judged: verdict(1), acked: 2, sendsAt: 100 }]) {
      expect(cosMove(lead(r), 3)).toEqual({ why: 'You’ve read it: it waits for your next message, or Ops’ news', captain: true, quiet: true });
    }
    expect(cosMove(lead({ at: 1, acked: 2 }, 'working'), 3)).toBeUndefined();
  });

  it('claims nothing without a read of the turn, or once the lead’s at work again', () => {
    expect(cosMove(lead(), 0)).toBeUndefined();
    expect(cosMove(lead({ at: 1000 }, 'working'), 1000)).toBeUndefined();
  });
});

describe('countdown', () => {
  it('is m:ss rounded up, and 0:00 once it’s up', () => {
    expect(countdown(100_000)).toBe('1:40');
    expect(countdown(59_001)).toBe('1:00');
    expect(countdown(1)).toBe('0:01');
    expect(countdown(-5)).toBe('0:00');
  });
});
