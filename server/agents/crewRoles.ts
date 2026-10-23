import type { TemplateVars } from './crewTemplate';

// The crew roles that have a file in .focus/crew/ (`<role>.md`), and what each one's file may say. The words are
// the file's; what they may refer to, and which of its settings Ops reads, are the code's, so a file that refers to
// something the code doesn't fill in fails when it loads rather than reaching an agent half-written.

/** A setting a crew file's frontmatter may give, for the roles that read it. */
export type CrewSettingKey = 'model' | 'effort' | 'maxTurns' | 'timeout';

export interface CrewRole {
  /** What the prompt may refer to (`crewTemplate.ts`). */
  vars: TemplateVars;
  /** The short pieces under `texts:` that the code picks between, dotted (`assignment.issue`): every one, no others. */
  texts?: readonly string[];
  /** What those texts may refer to. */
  textVars?: TemplateVars;
  /** The settings Ops reads from the file: any other is an error, so nobody sets one that does nothing. */
  settings?: readonly CrewSettingKey[];
}

/** The rules more than one prompt shares, filled in by the code where a prompt says `{{scratchRule}}` and so on. */
const RULES = { publicWordsRule: 'text', scratchRule: 'text', waitRule: 'text' } as const;

export const CREW_ROLES = {
  /** A goal's lead: `leadSystemAppend` (lead.ts). */
  lead: { vars: { name: 'text', project: 'text', station: 'text', ...RULES } },
  /** An agent at a room's desk, on an issue, a pull request's conflicts or its QA fixes, or a plugin's brief: `systemAppend` (prompts.ts). */
  worker: {
    vars: { name: 'text', repo: 'text', number: 'text', branch: 'text', baseBranch: 'text', assignment: 'text', summary: 'text', cloud: 'flag', ...RULES },
    texts: ['assignment.issue', 'assignment.conflicts', 'assignment.fix', 'assignment.unknownBrief', 'summary.pullRequest', 'summary.conflicts', 'summary.fix'],
    textVars: { repo: 'text', number: 'text', baseBranch: 'text' },
  },
} as const satisfies Record<string, CrewRole>;

export type CrewRoleName = keyof typeof CREW_ROLES;
