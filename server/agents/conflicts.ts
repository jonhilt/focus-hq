import type { LedgerEntry } from '../../shared/ledger';
import type { Agent, Settings } from '../../shared/types';
import type { BaseMerge } from './types';

/**
 * The model and effort a new agent seated to resolve a pull request's merge conflicts works at, stamped on them so a
 * resumed session keeps them: the office's conflicts model, else its `model` setting, and the conflicts effort, if any.
 */
export function conflictsAgentModel(settings: Pick<Settings, 'model' | 'conflictsModel' | 'conflictsEffort'>): Pick<Agent, 'model' | 'effort'> {
  const model = settings.conflictsModel.trim() || settings.model.trim();
  return { model: model || undefined, effort: settings.conflictsEffort };
}

/**
 * How the office settles a conflicted file by itself, as the repo's `.gitattributes` says: `focus-merge=union` keeps
 * both sides' lines (append-only docs), `theirs` takes the base branch's version and `ours` the PR's (generated files,
 * like baked GLBs). A file with git's own `merge=union` counts as union too, though git rarely leaves one conflicted.
 */
export type MergeRule = 'union' | 'ours' | 'theirs';

const RULES: readonly string[] = ['union', 'ours', 'theirs'];

/** Each file's rule, from `git check-attr -z focus-merge merge -- <files>` (path, attribute, value, each ending in NUL). */
export function mergeRules(checkAttr: string): Map<string, MergeRule> {
  const fields = checkAttr.split('\0');
  const rules = new Map<string, MergeRule>();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [file, attr, value] = fields.slice(i, i + 3);
    if (attr === 'focus-merge' && RULES.includes(value)) rules.set(file, value as MergeRule);
    else if (attr === 'merge' && value === 'union' && !rules.has(file)) rules.set(file, 'union');
  }
  return rules;
}

/** The stages git left each conflicted file at (1 the common ancestor, 2 ours, 3 theirs), from `git ls-files -u -z`. */
export function conflictStages(lsFiles: string): Map<string, Set<number>> {
  const stages = new Map<string, Set<number>>();
  for (const line of lsFiles.split('\0')) {
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(line);
    if (!m) continue;
    const file = m[2];
    stages.set(file, (stages.get(file) ?? new Set()).add(Number(m[1])));
  }
  return stages;
}

/**
 * Which conflicted files the office settles by rule, and those left for an agent. A union needs both sides' versions
 * (a file deleted on one side isn't a union); taking one side's always works, deleting the file if that side did.
 */
export function autoMergePlan(stages: Map<string, Set<number>>, rules: Map<string, MergeRule>): { auto: { file: string; rule: MergeRule }[]; left: string[] } {
  const auto: { file: string; rule: MergeRule }[] = [];
  const left: string[] = [];
  for (const [file, has] of stages) {
    const rule = rules.get(file);
    if (rule && (rule !== 'union' || (has.has(2) && has.has(3)))) auto.push({ file, rule });
    else left.push(file);
  }
  return { auto, left };
}

/** What the ledger's `conflicts` line says about the office's merge of a PR's base: who resolved it, and the files that conflicted. */
export function conflictsRecord(merge: BaseMerge): Pick<Extract<LedgerEntry, { kind: 'conflicts' }>, 'resolved' | 'files' | 'broke'> {
  if (merge.kind === 'up-to-date') return { resolved: 'up-to-date' };
  if (merge.kind === 'merged') return merge.auto?.length ? { resolved: 'auto', files: merge.auto } : { resolved: 'office' };
  return { resolved: 'agent', ...(merge.files.length ? { files: merge.files } : {}), ...(merge.broke ? { broke: merge.broke } : {}) };
}
