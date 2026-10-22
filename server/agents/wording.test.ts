import { describe, expect, it } from 'vitest';
import { leadSystemAppend } from './lead';
import { qaPlaybook } from './qa';
import { PUBLIC_WORDS_RULE } from './wording';

describe('PUBLIC_WORDS_RULE', () => {
  it("keeps the ship's terms for people out of what others read", () => {
    expect(PUBLIC_WORDS_RULE).toContain('pull request');
    expect(PUBLIC_WORDS_RULE).toContain('never "the captain"');
  });

  it('is in QA’s and the leads’ prompts', () => {
    expect(qaPlaybook('Odo', { name: 'Shop', repos: ['acme/shop'] }, []).prompt).toContain(PUBLIC_WORDS_RULE);
    expect(leadSystemAppend({ name: 'Ivanova' }, 'Shop', 0)).toContain(PUBLIC_WORDS_RULE);
  });
});
