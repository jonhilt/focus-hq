import { describe, expect, it } from 'vitest';
import { lanePrompt, laneSystemPrompt, parseLane } from './laneJudge';

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
