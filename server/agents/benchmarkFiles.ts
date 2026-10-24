import fs from 'node:fs';
import path from 'node:path';
import { isOneOf, isRecord } from '../../shared/records';
import { EFFORT_LEVELS, type Effort } from '../../shared/types';
import { config } from '../config';
import { durationMs } from './crewFiles';
import type { CrewRoleName } from './crewRoles';
import { type Fail, yamlFields } from './yamlFields';

// The benchmarks' files, .focus/benchmarks/<name>.yaml in Focus's own checkout (.focus/benchmarks/README.md): what
// each script that measures a role runs by default, and the configurations of that role it compares in one run (its
// crew file from another branch, another model or effort). The scripts read them as they start, so a broken one stops
// the run with the file and line at fault before any review is paid for.

export const BENCHMARK_DIR = path.join(config.root, '.focus', 'benchmarks');

/** A field a benchmark's file may give, for the benchmarks whose script reads it. */
export type BenchmarkField = 'sample' | 'controls' | 'concurrency' | 'judge';

/** Each benchmark: the role it measures, and the fields its script reads, any other being an error. */
export const BENCHMARKS = {
  /** QA's catch rate, on bugs planted in merged pull requests: tools/qaCatch.ts (docs/qa-catch.md). */
  'qa-catch': { role: 'qa', fields: ['sample', 'controls', 'concurrency'] },
  /** QA replayed on the commits real bugs came in with: tools/bugReplay.ts (docs/bug-corpus.md#replaying-qa). */
  'bug-replay': { role: 'qa', fields: ['sample', 'controls', 'concurrency', 'judge'] },
} as const satisfies Record<string, { role: CrewRoleName; fields: readonly BenchmarkField[] }>;

export type BenchmarkName = keyof typeof BENCHMARKS;

/** One way of seating the role, compared with the run's others on the same tasks. */
export interface Configuration {
  name: string;
  /** A git ref of Focus's repo whose crew file for the role it's told: this checkout's when there's none. */
  crew?: string;
  /** The role's model: as the machine's settings give it when there's none. */
  model?: string;
  /** The role's effort: the model's default when there's none. */
  effort?: Effort;
}

/** The model that judges a run's results, where a benchmark has one. */
export interface Judge {
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface Benchmark {
  name: BenchmarkName;
  description: string;
  role: CrewRoleName;
  /** How many tasks a run takes: all of them when it gives none. */
  sample?: number;
  /** Whether each run also reviews controls (code with no bug in it), for false alarms. */
  controls: boolean;
  /** How many reviews run at once. */
  concurrency: number;
  judge?: Judge;
  /** The first is the run's own (what the flow plugin shows); the rest are compared with it. */
  configurations: Configuration[];
}

/** What's wrong with a benchmark's file, naming it (and the line, where there is one) the way an editor would. */
export class BenchmarkFileError extends Error {}

const CONFIGURATION_FIELDS = ['name', 'crew', 'model', 'effort'];
const JUDGE_FIELDS = ['model', 'maxTurns', 'timeout'];

const positive = (v: unknown): v is number => Number.isInteger(v) && Number(v) > 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** A benchmark's file, read and checked: `file` is how errors name it. */
export function parseBenchmark(name: BenchmarkName, source: string, file: string): Benchmark {
  const { fields, fail } = yamlFields(source, file, (message) => new BenchmarkFileError(message));
  if (!isRecord(fields)) return fail('is a map of fields: description, role, configurations and its settings');
  const spec = BENCHMARKS[name];
  const allowed: readonly string[] = spec.fields;
  for (const key of Object.keys(fields)) {
    if (['description', 'role', 'configurations'].includes(key) || allowed.includes(key)) continue;
    fail(`${key} isn't read for this benchmark: its fields are description, role, configurations, ${allowed.join(', ')}`, [key]);
  }
  if (!text(fields.description)) fail('description says, in a line, what this benchmark measures');
  if (fields.role !== spec.role) fail(`role is ${spec.role}: this benchmark measures the ${spec.role} role's work`, ['role']);
  const sample = fields.sample;
  if (sample !== undefined && !positive(sample)) fail('sample is a whole number above 0, or left out for every task', ['sample']);
  if (typeof fields.controls !== 'boolean') fail('controls is true or false: whether a run also reviews code with no bug in it', ['controls']);
  if (!positive(fields.concurrency)) fail('concurrency is a whole number above 0: how many reviews run at once', ['concurrency']);
  const configurations = configurationsOf(fields.configurations, fail);
  return {
    name,
    description: String(fields.description).trim(),
    role: spec.role,
    ...(positive(sample) && { sample }),
    controls: fields.controls === true,
    concurrency: Number(fields.concurrency),
    ...(allowed.includes('judge') && { judge: judgeOf(fields.judge, fail) }),
    configurations,
  };
}

function configurationsOf(value: unknown, fail: Fail): Configuration[] {
  if (!Array.isArray(value) || !value.length) return fail("configurations lists at least one: the run's own first", ['configurations']);
  const seen = new Set<string>();
  return value.map((c: unknown, i): Configuration => {
    const at = (key?: string) => ['configurations', i, ...(key ? [key] : [])];
    if (!isRecord(c)) return fail('each configuration is a map: name, and any of crew, model, effort', at());
    for (const key of Object.keys(c)) if (!CONFIGURATION_FIELDS.includes(key)) fail(`${key} isn't a configuration's: they're ${CONFIGURATION_FIELDS.join(', ')}`, at(key));
    const name = c.name;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return fail('name is lowercase letters, digits and dashes, like main or terse-qa', at('name'));
    if (seen.has(name)) fail(`name ${name} is another configuration's already`, at('name'));
    seen.add(name);
    if (c.crew !== undefined && !text(c.crew)) fail("crew is a git ref of Focus's repo (a branch, tag or commit), or left out for this checkout's", at('crew'));
    if (c.model !== undefined && !text(c.model)) fail('model is a model id, like claude-sonnet-5-5', at('model'));
    if (c.effort !== undefined && !isOneOf(EFFORT_LEVELS, c.effort)) fail(`effort is one of ${EFFORT_LEVELS.join(', ')}`, at('effort'));
    return {
      name,
      ...(text(c.crew) && { crew: c.crew.trim() }),
      ...(text(c.model) && { model: c.model.trim() }),
      ...(isOneOf(EFFORT_LEVELS, c.effort) && { effort: c.effort }),
    };
  });
}

function judgeOf(value: unknown, fail: Fail): Judge {
  if (!isRecord(value)) return fail('judge is a map: model, maxTurns, timeout', ['judge']);
  for (const key of Object.keys(value)) if (!JUDGE_FIELDS.includes(key)) fail(`${key} isn't a judge's: they're ${JUDGE_FIELDS.join(', ')}`, ['judge', key]);
  if (!text(value.model)) fail('judge.model is a model id, like claude-opus-5-5', ['judge', 'model']);
  if (!positive(value.maxTurns)) fail('judge.maxTurns is a whole number above 0', ['judge', 'maxTurns']);
  const timeoutMs = durationMs(value.timeout);
  if (!timeoutMs) fail('judge.timeout is a time like 90s, 8m or 2h', ['judge', 'timeout']);
  return { model: String(value.model).trim(), maxTurns: Number(value.maxTurns), timeoutMs: Number(timeoutMs) };
}

/** A benchmark's file in `dir` (.focus/benchmarks/ by default), read and checked. */
export function loadBenchmark(name: BenchmarkName, dir = BENCHMARK_DIR): Benchmark {
  const file = path.join(dir, `${name}.yaml`);
  const shown = path.relative(config.root, file) || file;
  if (!fs.existsSync(file)) throw new BenchmarkFileError(`${shown}: missing: every benchmark has its file`);
  return parseBenchmark(name, fs.readFileSync(file, 'utf8'), shown);
}

/** Every benchmark's file in `dir`, read and checked; a .yaml there that's no benchmark's is an error too. */
export function loadBenchmarks(dir = BENCHMARK_DIR): Benchmark[] {
  const names = Object.keys(BENCHMARKS);
  const stray = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') && !names.includes(f.slice(0, -5)));
  if (stray.length) throw new BenchmarkFileError(`${stray.map((f) => path.relative(config.root, path.join(dir, f))).join(', ')}: no benchmark has that name: they're ${names.join(', ')}`);
  return Object.keys(BENCHMARKS).filter(isBenchmark).map((name) => loadBenchmark(name, dir));
}

/** The benchmark's judge: its file gives one where the benchmark reads it (`parseBenchmark`). */
export function judgeFor(benchmark: Benchmark): Judge {
  if (!benchmark.judge) throw new BenchmarkFileError(`.focus/benchmarks/${benchmark.name}.yaml: judge is missing`);
  return benchmark.judge;
}

const isBenchmark = (name: string): name is BenchmarkName => name in BENCHMARKS;

/** The configurations `picked` names (`--config a,b`), in its order, or all of them when it names none. */
export function pickConfigurations(benchmark: Benchmark, picked: string | undefined): Configuration[] {
  if (!picked) return benchmark.configurations;
  return picked.split(',').map((name) => {
    const found = benchmark.configurations.find((c) => c.name === name.trim());
    if (!found) throw new BenchmarkFileError(`--config ${name.trim()}: .focus/benchmarks/${benchmark.name}.yaml has no such configuration: it has ${benchmark.configurations.map((c) => c.name).join(', ')}`);
    return found;
  });
}
