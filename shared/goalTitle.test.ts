import { describe, expect, it } from 'vitest';
import { goalTitle, tidyGoalTitle } from './goalTitle';

describe('goal titles', () => {
  it('starts from the captain’s first line, cut at a word', () => {
    expect(goalTitle('we need better branch names - when merging PRS for example on the Thomas project I’ve realised')).toBe('we need better branch names - when merging PRS for example…');
    expect(goalTitle('\n  Saved items.\nmore')).toBe('Saved items');
  });

  it('tidies a proposed title, and refuses one that isn’t a short line', () => {
    expect(tidyGoalTitle('“Readable branch names for slices.”\n')).toBe('Readable branch names for slices');
    expect(tidyGoalTitle('  Proposal   editor triage ')).toBe('Proposal editor triage');
    expect(tidyGoalTitle('x'.repeat(61))).toBeUndefined();
    expect(tidyGoalTitle('')).toBeUndefined();
    expect(tidyGoalTitle(undefined)).toBeUndefined();
  });
});
