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
  lead: { vars: { name: 'text', project: 'text', station: 'text', shaping: 'flag', ...RULES } },
  /** An agent at a room's desk, on an issue, a pull request's conflicts or its QA fixes, or a plugin's brief: `systemAppend` (prompts.ts). */
  worker: {
    vars: { name: 'text', repo: 'text', number: 'text', branch: 'text', baseBranch: 'text', assignment: 'text', summary: 'text', cloud: 'flag', ...RULES },
    texts: ['assignment.issue', 'assignment.conflicts', 'assignment.fix', 'assignment.unknownBrief', 'summary.pullRequest', 'summary.conflicts', 'summary.fix'],
    textVars: { repo: 'text', number: 'text', baseBranch: 'text' },
  },
  /** The QA officer reviewing a pull request: `qaSystemAppend`, and the steps the Playbook lists (`qaSteps`, `huntingSteps`). */
  qa: {
    vars: {
      name: 'text', project: 'text', number: 'text', title: 'text', branch: 'text', baseBranch: 'text', url: 'text', sha: 'text',
      siblings: 'flag', siblingList: 'text', brief: 'flag', briefText: 'text', steps: 'text', proof: 'flag', hunt: 'text', probe: 'text', proofStep: 'text',
      spotChecks: 'text', publicWordsRule: 'text',
    },
    texts: [
      ...(['criteria', 'diff', 'checks', 'unread', 'browser', 'scripts'] as const).flatMap((step) => [`steps.${step}.title`, `steps.${step}.text`] as const),
      ...(['hunt', 'probe', 'proof'] as const).flatMap((step) => [`hunting.${step}.title`, `hunting.${step}.text`] as const),
      'run.listed',
      'run.unknown',
    ],
    textVars: { baseBranch: 'text', run: 'text', checks: 'text', maxScreenshots: 'text', recorded: 'flag', scratchRule: 'text', waitRule: 'text' },
  },
  /** The operations officer writing up an idea as an issue at the Ops station: `plannerSystemPrompt` (planner.ts). */
  planner: { vars: { name: 'text', project: 'text', repoList: 'text', publicWordsRule: 'text' }, settings: ['maxTurns', 'timeout'] },
  /** The operations officer looking into a stuck pull request: `triageSystemPrompt` (triage.ts). */
  triage: { vars: { name: 'text', project: 'text', number: 'text', publicWordsRule: 'text' }, settings: ['maxTurns', 'timeout'] },
  /**
   * The QA officer answering the captain at the Playbook: `qaChatSystemPrompt` (qaChat.ts). Its model is QA's, from the
   * captain's Settings, so the file doesn't give one.
   */
  'qa-chat': { vars: { name: 'text', project: 'text', autoQa: 'text', autoSendBack: 'text', qaProof: 'text', autoMerge: 'text' }, settings: ['maxTurns', 'timeout'] },
  /** Titling a new goal from the captain's first words: `goalTitleSystemPrompt` (goalTitles.ts). */
  'goal-title': { vars: {}, settings: ['model', 'maxTurns', 'timeout'] },
} as const satisfies Record<string, CrewRole>;

export type CrewRoleName = keyof typeof CREW_ROLES;
