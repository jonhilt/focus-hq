import { describe, expect, it } from 'vitest';
import type { Studio } from '../../shared/types';
import { applyStudio, STUDIO_LIMITS, studioReply } from './studio';

const started = (more: Partial<Studio> = {}): Studio => ({ premise: 'How Claude delegates', beats: [], gaps: [], at: 1, ...more });
const ok = (result: Studio | { error: string }): Studio => {
  if ('error' in result) throw new Error(result.error);
  return result;
};

describe('applyStudio', () => {
  it('starts with the premise, and refuses anything before it', () => {
    expect(applyStudio(undefined, { gap: 'What does /batch cost?' }, 5)).toEqual({ error: expect.stringContaining('Start with the premise') });
    expect(applyStudio(undefined, { premise: '  How   Claude delegates ' }, 5)).toEqual({ premise: 'How Claude delegates', beats: [], gaps: [], at: 5 });
  });

  it('replaces what it’s sent and keeps the rest', () => {
    const studio = ok(applyStudio(started({ takeaway: 'Reach for the smallest rung' }), { beats: [{ title: 'Alone', point: 'One context fills up' }, { title: 'Subagents', point: ' ' }] }, 7));
    expect(studio).toEqual({ premise: 'How Claude delegates', takeaway: 'Reach for the smallest rung', beats: [{ title: 'Alone', point: 'One context fills up' }, { title: 'Subagents' }], gaps: [], at: 7 });
  });

  it('refuses parts that are too long, or too many beats', () => {
    expect(applyStudio(undefined, { premise: 'x'.repeat(STUDIO_LIMITS.premise + 1) }, 1)).toHaveProperty('error');
    expect(applyStudio(started(), { beats: Array.from({ length: STUDIO_LIMITS.beats + 1 }, (_, i) => ({ title: `B${i}` })) }, 1)).toHaveProperty('error');
    expect(applyStudio(started(), { beats: [{ title: '' }] }, 1)).toHaveProperty('error');
  });

  it('logs gaps with the next id and closes them answered or dropped', () => {
    const one = ok(applyStudio(started(), { gap: 'How many agents can a workflow run at once?' }, 2));
    const two = ok(applyStudio(one, { gap: 'Does /batch need a clean tree?' }, 3));
    expect(two.gaps.map((g) => g.id)).toEqual(['g1', 'g2']);
    const answered = ok(applyStudio(two, { closeGap: { id: 'g1', as: 'answered', answer: 'Up to 16 in a wave' } }, 4));
    expect(answered.gaps[0].closed).toEqual({ as: 'answered', answer: 'Up to 16 in a wave', at: 4 });
    expect(applyStudio(answered, { closeGap: { id: 'g1', as: 'dropped' } }, 5)).toEqual({ error: 'Gap g1 was already answered.' });
    expect(applyStudio(answered, { closeGap: { id: 'g9', as: 'dropped' } }, 5)).toEqual({ error: expect.stringContaining('Open gaps: g2') });
    expect(ok(applyStudio(answered, { gap: 'Another?' }, 6)).gaps.at(-1)!.id).toBe('g3');
  });

  it('refuses a gap that’s already open, or one too many', () => {
    const one = ok(applyStudio(started(), { gap: 'Cost?' }, 2));
    expect(applyStudio(one, { gap: 'cost?' }, 3)).toEqual({ error: 'That\'s already open as g1.' });
    const full = started({ gaps: Array.from({ length: STUDIO_LIMITS.open }, (_, i) => ({ id: `g${i + 1}`, text: `Q${i}`, at: i })) });
    expect(applyStudio(full, { gap: 'One more' }, 9)).toHaveProperty('error');
  });
});

describe('studioReply', () => {
  it('says which gap it logged and which are open', () => {
    const after = started({ gaps: [{ id: 'g1', text: 'Cost?', at: 1 }] });
    expect(studioReply(started(), after)).toBe('The studio holodeck shows it. Logged gap g1. Open gaps: g1 (Cost?).');
    expect(studioReply(after, after)).toBe('The studio holodeck shows it. Open gaps: g1 (Cost?).');
  });
});
