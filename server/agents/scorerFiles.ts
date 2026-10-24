import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from '../../shared/records';
import { config } from '../config';
import { CrewFileError, durationMs, splitFrontmatter } from './crewFiles';
import { CREW_ROLES, type CrewRoleName } from './crewRoles';
import { yamlFields } from './yamlFields';

// The scorers' files, .focus/scorers/<name>.md in Focus's own checkout (.focus/scorers/README.md): how a model grades
// a crew role's real work, the rubric it's told in the body and the scale it grades on in the frontmatter. Whatever
// runs a scorer reads its file as it starts, so a broken one says what's wrong, with its file and line, before
// anything is graded.

export const SCORER_DIR = path.join(config.root, '.focus', 'scorers');

export interface Scorer {
  name: string;
  description: string;
  /** The crew role whose work it grades. */
  role: CrewRoleName;
  model: string;
  /** Of every hundred pieces of the role's work, how many it grades. */
  samplingRate: number;
  /** Each label the model may give, and the score it's worth, from 0 to 1. */
  labels: Readonly<Record<string, number>>;
  /** The score a piece of work passes at. */
  passingScore: number;
  maxTurns: number;
  timeoutMs: number;
  /** What the model is told: how to grade. */
  rubric: string;
  /** The rubric's words and the scale in short (8 hex digits): a different digest means work is graded differently. */
  digest: string;
}

/** What's wrong with a scorer's file, naming it (and the line, where there is one) the way an editor would. */
export class ScorerFileError extends Error {}

const FIELDS = ['description', 'role', 'model', 'samplingRate', 'labels', 'passingScore', 'maxTurns', 'timeout'];
const LABEL = /^[a-z][a-z-]*$/;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isRole = (v: unknown): v is CrewRoleName => typeof v === 'string' && v in CREW_ROLES;

/** A scorer's file, read and checked: `file` is how errors name it. */
export function parseScorer(name: string, source: string, file: string): Scorer {
  let split: ReturnType<typeof splitFrontmatter>;
  try {
    split = splitFrontmatter(source, file);
  } catch (err) {
    throw err instanceof CrewFileError ? new ScorerFileError(err.message) : err;
  }
  const { fields, fail } = yamlFields(split.frontmatter, file, (message) => new ScorerFileError(message), 2);
  if (!isRecord(fields)) return fail(`its frontmatter is a map of fields: ${FIELDS.join(', ')}`);
  for (const key of Object.keys(fields)) if (!FIELDS.includes(key)) fail(`${key} isn't a scorer's field: they're ${FIELDS.join(', ')}`, [key]);
  if (!text(fields.description)) fail('description says, in a line, what this scorer grades');
  if (!isRole(fields.role)) fail(`role is the crew role whose work it grades: one of ${Object.keys(CREW_ROLES).join(', ')}`, ['role']);
  if (!text(fields.model)) fail('model is a model id, like haiku or claude-haiku-4-5-20251001', ['model']);
  const rate = fields.samplingRate;
  if (typeof rate !== 'number' || !(rate > 0 && rate <= 100)) fail('samplingRate is how many of every hundred pieces of work it grades: above 0, at most 100', ['samplingRate']);
  const labels = labelsOf(fields.labels, fail);
  const passing = fields.passingScore;
  if (typeof passing !== 'number' || !Object.values(labels).some((score) => score >= passing)) fail('passingScore is the score work passes at: one of its labels has to reach it', ['passingScore']);
  if (!Number.isInteger(fields.maxTurns) || Number(fields.maxTurns) < 1) fail('maxTurns is a whole number above 0', ['maxTurns']);
  const timeoutMs = durationMs(fields.timeout);
  if (!timeoutMs) fail('timeout is a time like 90s, 3m or 1h', ['timeout']);
  const rubric = split.body.trim();
  if (!rubric) fail('its body is the rubric: how the model grades the work');
  return {
    name,
    description: String(fields.description).trim(),
    role: isRole(fields.role) ? fields.role : 'qa',
    model: String(fields.model).trim(),
    samplingRate: Number(rate),
    labels,
    passingScore: Number(passing),
    maxTurns: Number(fields.maxTurns),
    timeoutMs: Number(timeoutMs),
    rubric,
    digest: createHash('sha256').update(JSON.stringify([rubric, labels, passing])).digest('hex').slice(0, 8),
  };
}

function labelsOf(value: unknown, fail: (message: string, at?: (string | number)[]) => never): Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length < 2) return fail('labels gives each label the model may give its score, two at least: thorough: 1, shallow: 0.5', ['labels']);
  for (const [label, score] of Object.entries(value)) {
    if (!LABEL.test(label)) fail(`label ${label} is lowercase letters and dashes`, ['labels', label]);
    if (typeof score !== 'number' || score < 0 || score > 1) fail(`labels.${label} is a score from 0 to 1`, ['labels', label]);
  }
  return Object.fromEntries(Object.entries(value).map(([label, score]) => [label, Number(score)]));
}

/** A scorer's file in `dir` (.focus/scorers/ by default), `<name>.md`, read and checked. */
export function loadScorer(name: string, dir = SCORER_DIR): Scorer {
  const file = path.join(dir, `${name}.md`);
  const shown = path.relative(config.root, file) || file;
  if (!fs.existsSync(file)) throw new ScorerFileError(`${shown}: missing: there's no scorer of that name`);
  return parseScorer(name, fs.readFileSync(file, 'utf8'), shown);
}

/** The score `label` is worth, and whether it passes: undefined for a label the scorer hasn't got. */
export function scoreOf(scorer: Pick<Scorer, 'labels' | 'passingScore'>, label: string): { score: number; passed: boolean } | undefined {
  const score = Object.hasOwn(scorer.labels, label) ? scorer.labels[label] : undefined;
  return score === undefined ? undefined : { score, passed: score >= scorer.passingScore };
}
