import { describe, expect, it } from 'vitest';
import { retroAfterRestart, undecided } from './retroRules';
import { freshRetro, type RetroDraft } from './shared';

describe('retroAfterRestart', () => {
  it('ends a retro that was under way when Focus shut down', () => {
    expect(retroAfterRestart({ ...freshRetro(), status: 'thinking' })).toMatchObject({ status: 'failed', activity: 'Interrupted' });
    expect(retroAfterRestart({ ...freshRetro(), status: 'done' }).status).toBe('done');
  });

  it('gives a retro saved before drafts none', () => {
    const { drafts: _d, ...old } = freshRetro();
    expect(retroAfterRestart({ ...old, status: 'done' } as never).drafts).toEqual([]);
  });
});

describe('undecided', () => {
  const draft = (id: string, more: Partial<RetroDraft> = {}): RetroDraft =>
    ({ id, title: `Draft ${id}`, body: 'b', kind: 'check', measure: 'm', signatures: [], sessions: 3, ...more });
  const retro = { ...freshRetro(), status: 'done' as const, drafts: [draft('d1'), draft('d2', { decision: { accepted: true, at: 5 } }), draft('d3', { decision: { accepted: false, at: 6 } })] };

  it('is the draft still waiting for the captain’s decision', () => {
    expect(undecided(retro, 'd1').id).toBe('d1');
  });

  it('refuses a draft that isn’t in the latest retro, or one decided already', () => {
    expect(() => undecided(retro, 'd9')).toThrow('isn’t in the latest retro');
    expect(() => undecided(retro, 'd2')).toThrow('already accepted');
    expect(() => undecided(retro, 'd3')).toThrow('already rejected');
  });
});
