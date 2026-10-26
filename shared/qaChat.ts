import { DEFAULT_MERGE_CHECKS, mergeCheckNames } from './mergeCheckRules';
import { autoMergeFor } from './mergeGateRules';
import { QA_BRIEF_MAX } from './qa';
import { autoQaFor, autoSendBackFor, qaProofFor } from './qaRules';
import { EFFORT_LEVELS, type Effort, type Project, type QaChatTurn, type QaSettingsChange } from './types';

// Talking to the QA officer at the Playbook: the talk Ops passes on, the change the officer may propose (only
// to the settings in QaSettingsChange, checked here whatever the officer said), and how it shows as a diff. Pure, so
// it's unit tested (shared/qaChat.test.ts); server/agents/qaChat.ts asks the officer, client/src/ui/qaChat.ts shows it.

/** QA's settings as they work now, defaults filled in: what a proposed change is weighed against. */
export interface QaSettingsNow {
  autoQa: boolean;
  autoSendBack: boolean;
  qaProof: boolean;
  autoMerge: boolean;
  /** null: the model's default. */
  qaEffort: Effort | null;
  mergeChecks: string[];
  qaBrief: string;
}

type QaField = keyof QaSettingsChange;
type QaSwitchField = 'autoQa' | 'autoSendBack' | 'qaProof' | 'autoMerge';

/** Each setting the officer may change, by the name the Playbook gives it, in the Playbook's order. */
export const QA_CHAT_FIELDS: Record<QaField, string> = {
  autoQa: 'Test every PR',
  autoSendBack: 'Send failed PRs back',
  qaProof: 'Block only with proof',
  autoMerge: 'Auto-merge',
  qaEffort: 'How hard it thinks',
  mergeChecks: 'Scripts to run',
  qaBrief: 'Your brief',
};

const SWITCHES: QaSwitchField[] = ['autoQa', 'autoSendBack', 'qaProof', 'autoMerge'];

/** The most turns of the talk the officer is given (the latest), and the most characters of each. */
export const QA_CHAT_TURNS = 10;
export const QA_CHAT_TURN_CHARS = 4000;

/** A project's QA settings as they work now. */
export function qaSettingsNow(project: Pick<Project, QaSwitchField | 'qaEffort' | 'mergeChecks' | 'qaBrief'>): QaSettingsNow {
  return {
    autoQa: autoQaFor(project),
    autoSendBack: autoSendBackFor(project),
    qaProof: qaProofFor(project),
    autoMerge: autoMergeFor(project),
    qaEffort: project.qaEffort ?? null,
    mergeChecks: [...(project.mergeChecks ?? DEFAULT_MERGE_CHECKS)],
    qaBrief: project.qaBrief ?? '',
  };
}

/**
 * The talk so far, as the client sent it (any JSON): its last turns that are a captain's or the officer's words, each
 * trimmed and cut short. Throws, in words, unless it ends with something the captain said.
 */
export function qaChatTurns(messages: unknown): QaChatTurn[] {
  const turns = (Array.isArray(messages) ? messages : []).flatMap((m: unknown): QaChatTurn[] => {
    const { who, text } = fields(m);
    if ((who !== 'captain' && who !== 'officer') || typeof text !== 'string' || !text.trim()) return [];
    return [{ who, text: text.trim().slice(0, QA_CHAT_TURN_CHARS) }];
  }).slice(-QA_CHAT_TURNS);
  if (turns.at(-1)?.who !== 'captain') throw new Error('Say something to the QA officer first');
  return turns;
}

const fields = (v: unknown): Partial<Record<string, unknown>> => (v !== null && typeof v === 'object' ? v : {});

/**
 * The change the officer proposed, as it can be applied: only the settings it may change, each a valid value (a
 * switch on or off, an effort level or "default", script names, the brief's whole text), and only those that differ
 * from how they are `now`. Undefined when nothing's left to change.
 */
export function qaChatChange(proposed: unknown, now: QaSettingsNow): QaSettingsChange | undefined {
  const p = fields(proposed);
  const change: QaSettingsChange = {};
  for (const field of SWITCHES) if (typeof p[field] === 'boolean' && p[field] !== now[field]) change[field] = p[field];
  const effort = effortOf(p.qaEffort);
  if (effort !== undefined && effort !== now.qaEffort) change.qaEffort = effort;
  const checks = typeof p.mergeChecks === 'string' || Array.isArray(p.mergeChecks) ? mergeCheckNames(p.mergeChecks) : undefined;
  if (checks && checks.join(' ') !== now.mergeChecks.join(' ')) change.mergeChecks = checks;
  const brief = typeof p.qaBrief === 'string' ? p.qaBrief.trimEnd().slice(0, QA_BRIEF_MAX) : undefined;
  if (brief !== undefined && brief !== now.qaBrief.trimEnd()) change.qaBrief = brief;
  return Object.keys(change).length ? change : undefined;
}

/** An effort level; null for the model's default ("default", null or empty); undefined for anything else. */
function effortOf(v: unknown): Effort | null | undefined {
  if (v === null || v === '' || v === 'default') return null;
  return EFFORT_LEVELS.find((e) => e === v);
}

/** One setting a proposed change touches, as the Playbook shows it: its name, and its value before and after. */
export interface QaChangeRow {
  field: QaField;
  label: string;
  from: string;
  to: string;
}

/** The rows of a proposed change, in the Playbook's order. The brief's are its whole text, for a line diff. */
export function qaChangeRows(change: QaSettingsChange, now: QaSettingsNow): QaChangeRow[] {
  return ORDER.flatMap((field) => (change[field] === undefined ? [] : [{ field, label: QA_CHAT_FIELDS[field], from: shown(field, now[field]), to: shown(field, change[field]) }]));
}

const ORDER: QaField[] = [...SWITCHES, 'qaEffort', 'mergeChecks', 'qaBrief'];

/** A setting's value in words. */
function shown(field: QaField, value: QaSettingsChange[QaField]): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (field === 'qaEffort') return value ?? 'default';
  return value ?? '';
}

/** A line of a line diff: in both, only the new text, or only the old. */
export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** The lines of `after` against `before`, by their longest common run of lines: what was taken out, and what added. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  // common[i][j]: how many lines a[i..] and b[j..] have in common, in order
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || common[i][j + 1] > common[i + 1][j])) lines.push({ kind: 'added', text: b[j++] });
    else lines.push({ kind: 'removed', text: a[i++] });
  }
  return lines;
}
