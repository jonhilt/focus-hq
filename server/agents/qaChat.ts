import { QA_CHAT_FIELDS, type QaSettingsNow } from '../../shared/qaChat';
import { qaSwitchSays, repoChecksLine } from '../../shared/qaPlaybook';
import { EFFORT_LEVELS, type QaChatTurn, type QaPlaybook, type Settings } from '../../shared/types';

// The captain talking to the QA officer at the Playbook: one read-only Claude call per message the captain sends, given
// the Playbook as it is and the talk so far, that answers and may propose a change to QA's settings. It changes
// nothing: the captain applies the change, or not. Its instructions, schema and parsing are here, pure, so they're unit
// tested (qaChat.test.ts); Ops' check of the change is `qaChatChange` (shared/qaChat.ts), and
// `Reviews.chat` (manager/reviews.ts) asks.

export interface QaChatRequest {
  officer: string;
  projectName: string;
  playbook: QaPlaybook;
  now: QaSettingsNow;
  /** Which model QA works on and how hard it thinks, in a sentence (`qaWhoLine`). */
  who: string;
  /** The talk so far, ending with what the captain just said. */
  turns: QaChatTurn[];
  settings: Settings;
  signal: AbortSignal;
}

/** What the officer said, and the change it proposed as it gave it: Ops checks it before the captain sees it. */
export interface QaChatAnswer {
  reply: string;
  change?: unknown;
  costUsd?: number;
}

/** Answers the captain at the Playbook. The live one is a read-only Claude call on the QA model; the demo's is scripted. */
export interface QaChatter {
  answer(req: QaChatRequest): Promise<QaChatAnswer>;
}

const flag = (what: string) => ({ type: 'boolean', description: what });

/** The settings the officer may propose a change to: those of `QaSettingsChange`, and nothing else. */
export const QA_CHANGE_PROPERTIES: Record<string, unknown> = {
  autoQa: flag(`${QA_CHAT_FIELDS.autoQa}: test every pull request the crew opens or pushes to, by yourself.`),
  autoSendBack: flag(`${QA_CHAT_FIELDS.autoSendBack}: a pull request the crew opened that you fail goes back to its developer to fix.`),
  qaProof: flag(`${QA_CHAT_FIELDS.qaProof}: fail a pull request only with proof Ops checks.`),
  autoMerge: flag(`${QA_CHAT_FIELDS.autoMerge}: merge a pull request the crew opened once you pass it and its checks are green.`),
  qaEffort: { type: 'string', enum: [...EFFORT_LEVELS, 'default'], description: 'How hard you think on a review; default: the model’s own.' },
  mergeChecks: { type: 'array', items: { type: 'string' }, description: 'The package.json scripts you run on every pull request (and the merge check runs), by name: the whole new list.' },
  qaBrief: { type: 'string', description: 'The brief: its whole new text. Keep its lines unless the captain asks to drop one, and add a line for something new.' },
};

export const QA_CHAT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: {
    reply: { type: 'string', description: 'What you say to the captain, in plain words: a few sentences at most.' },
    change: {
      type: 'object',
      additionalProperties: false,
      description: 'Only when the captain asks for something one of these settings does: just the settings to change, at their new values. Leave it out otherwise.',
      properties: QA_CHANGE_PROPERTIES,
    },
  },
};

export function qaChatSystemPrompt(req: Pick<QaChatRequest, 'officer' | 'projectName'>): string {
  return `
# You are ${req.officer}, QA officer for ${req.projectName} aboard the Focus

The captain is at your station, looking at your Playbook: what you do on every pull request of ${req.projectName}, built from your instructions and settings as they are now. They tell you, in plain words, what they want from you, or ask why you do something. You answer them, and when what they want means changing one of your settings, you propose the change.

You can propose a change to these settings only:
- the four switches: ${QA_CHAT_FIELDS.autoQa}, ${QA_CHAT_FIELDS.autoSendBack}, ${QA_CHAT_FIELDS.qaProof}, ${QA_CHAT_FIELDS.autoMerge};
- how hard you think on a review;
- the scripts you run on every pull request (the merge check runs the same ones), by their package.json names;
- the brief: what the captain asks you to check on every pull request, on top of your steps. Something they want looked at, skipped or done in a certain way goes in the brief, a line at a time: give its whole new text, keeping the lines it has.

Your steps are fixed: neither you nor the captain can change them here, nor your model (that's Model for QA, in the manager's Settings). When they ask for something you can't change, say so plainly, and propose the nearest thing you can (usually a line in the brief).

You change nothing yourself: the captain sees your change as a diff and applies it or not. Don't say it's done. Propose nothing when they only ask a question, or what they ask for is already so. Keep your reply short: a few sentences, no headings.
`.trim();
}

/** The Playbook as it is now and the talk so far, ending with what the captain just said. */
export function qaChatPrompt(req: Omit<QaChatRequest, 'settings' | 'signal'>): string {
  const { now, playbook } = req;
  const switches = (['autoQa', 'autoSendBack', 'qaProof', 'autoMerge'] as const).map((s) => `- ${QA_CHAT_FIELDS[s]}: ${now[s] ? 'on' : 'off'}. ${qaSwitchSays(s, now[s])}`);
  const repos = playbook.repos.map((r) => `- ${r.repo}: ${repoChecksLine(r)}${r.cloned ? (r.claudeMd ? ' It has a CLAUDE.md, which you follow.' : ' It has no CLAUDE.md.') : ''}`);
  const talk = req.turns.map((t) => `${t.who === 'captain' ? 'Captain' : 'You'}: ${t.text}`);
  return [
    '## Your Playbook as it is now',
    '',
    '### When you run',
    ...switches,
    '',
    '### Who, and how hard',
    `${req.who} How hard you think: ${now.qaEffort ?? 'default'}.`,
    '',
    '### Your steps (fixed)',
    ...playbook.steps.map((s, i) => `${i + 1}. ${s.title}\n${s.text}`),
    '',
    '### The checks you run',
    ...repos,
    `Scripts to run: ${now.mergeChecks.length ? now.mergeChecks.join(', ') : 'none'}`,
    '',
    '### The brief',
    now.qaBrief.trim() || '(empty)',
    '',
    '## The talk so far',
    '',
    ...talk,
    '',
    'Answer the captain’s last message.',
  ].join('\n');
}

/** The officer's answer from its structured output; null when it gave no reply. The change is checked by `qaChatChange`. */
export function parseQaChat(out: unknown): QaChatAnswer | null {
  if (out === null || typeof out !== 'object' || !('reply' in out) || typeof out.reply !== 'string' || !out.reply.trim()) return null;
  return { reply: out.reply.trim(), ...('change' in out && out.change !== undefined && { change: out.change }) };
}
