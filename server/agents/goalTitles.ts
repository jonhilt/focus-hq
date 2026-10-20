/**
 * Titling a new goal: the office starts it under the captain's first words (`goalTitle`), and asks Haiku for a short
 * title that says what the work is, which replaces it unless the lead or the captain has retitled it meanwhile.
 */

export const GOAL_TITLE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string', description: 'The goal’s title: at most 60 characters.' } },
  required: ['title'],
  additionalProperties: false,
} as const;

export function goalTitleSystemPrompt(): string {
  return `You title pieces of software work. Given what someone asked for, reply with a title for it: what the work is, in 3 to 8 words and at most 60 characters, like a good pull request or issue title ("Readable branch names for slices", "Proposal editor: section reordering"). Plain words, sentence case, no quotes and no full stop. Title what is being asked for, leaving out examples and asides. Don't start with "We need" or "Can we".`;
}

export const goalTitlePrompt = (brief: string): string => `Title this work:\n\n${brief}`;

/** Whether a title from Haiku replaces the goal's: only while the goal still has the title it started with. */
export const takesTitle = (current: string, started: string, proposed: string | undefined): proposed is string =>
  !!proposed && current === started && proposed !== started;
