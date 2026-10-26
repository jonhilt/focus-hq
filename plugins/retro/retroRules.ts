import type { Retro, RetroDraft } from './shared';

// The chief engineer's retro's decisions: the latest retro as it picks up after a restart, and whether a draft may
// still be decided. Pure, so it's tested
// (retroRules.test.ts).

/** The latest retro as it picks up after a restart: one under way when Focus shut down ends, so another can start. */
export function retroAfterRestart(saved: Retro): Retro {
  // a retro saved before drafts replaced proposals has none
  saved = { ...saved, drafts: saved.drafts ?? [], watch: saved.watch ?? [] };
  if (saved.status !== 'gathering' && saved.status !== 'thinking') return saved;
  return { ...saved, status: 'failed', activity: 'Interrupted', error: 'Interrupted when Focus shut down. Start it again.' };
}

/** The draft `id` of `retro`, while it waits for the captain's decision. */
export function undecided(retro: Retro, id: string): RetroDraft {
  const draft = retro.drafts.find((d) => d.id === id);
  if (!draft) throw new Error('That draft isn’t in the latest retro');
  if (draft.decision) throw new Error(`That draft was already ${draft.decision.accepted ? 'accepted' : 'rejected'}`);
  return draft;
}
