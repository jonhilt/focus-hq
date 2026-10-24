import { crewPrompt } from './crewFiles';

/**
 * Titling a new goal: Ops starts it under the captain's first words (`goalTitle`), and asks Haiku for a short
 * title that says what the work is, which replaces it unless the lead or the captain has retitled it meanwhile.
 */

export const GOAL_TITLE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string', description: 'The goal’s title: at most 60 characters.' } },
  required: ['title'],
  additionalProperties: false,
} as const;

/** The titler's instructions (.focus/crew/goal-title.md). */
export const goalTitleSystemPrompt = (): string => crewPrompt('goal-title', {}).trim();

export const goalTitlePrompt = (brief: string): string => `Title this work:\n\n${brief}`;

/** Whether a title from Haiku replaces the goal's: only while the goal still has the title it started with. */
export const takesTitle = (current: string, started: string, proposed: string | undefined): proposed is string =>
  !!proposed && current === started && proposed !== started;
