import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BENCHMARK_DIR, BenchmarkFileError, judgeFor, loadBenchmark, loadBenchmarks, parseBenchmark, pickConfigurations } from './benchmarkFiles';

const catchFile = (extra = '', configurations = '  - name: main\n') =>
  `description: QA's catch rate.\nrole: qa\nsample: 10\ncontrols: false\nconcurrency: 2\n${extra}configurations:\n${configurations}`;
const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof BenchmarkFileError) return err.message;
    throw err;
  }
  return undefined;
};

describe('the benchmarks’ files', () => {
  it('has every benchmark’s, each of which loads, with what the scripts ran before they had them', () => {
    const [qaCatch, bugReplay] = loadBenchmarks();
    expect(qaCatch).toMatchObject({ name: 'qa-catch', role: 'qa', sample: 10, controls: false, concurrency: 2, configurations: [{ name: 'main' }] });
    expect(bugReplay).toMatchObject({ name: 'bug-replay', role: 'qa', controls: false, concurrency: 2, judge: { model: 'claude-opus-5-5', maxTurns: 2, timeoutMs: 180_000 }, configurations: [{ name: 'main' }] });
    // every commit a traced bug came from, as before
    expect(bugReplay?.sample).toBeUndefined();
  });

  it('reads a configuration’s crew ref, model and effort', () => {
    const b = parseBenchmark('qa-catch', catchFile('', '  - name: main\n  - name: terse\n    crew: focus/terse-qa\n    model: claude-sonnet-5-5\n    effort: high\n'), 'qa-catch.yaml');
    expect(b.configurations).toEqual([{ name: 'main' }, { name: 'terse', crew: 'focus/terse-qa', model: 'claude-sonnet-5-5', effort: 'high' }]);
  });

  it('names the file and the line of a field that isn’t read, or is wrong', () => {
    expect(error(() => parseBenchmark('qa-catch', catchFile('judge:\n  model: x\n'), 'qa-catch.yaml'))).toBe(
      "qa-catch.yaml:7: judge isn't read for this benchmark: its fields are description, role, configurations, sample, controls, concurrency",
    );
    expect(error(() => parseBenchmark('qa-catch', catchFile('budget: 10\n'), 'qa-catch.yaml'))).toContain("qa-catch.yaml:6: budget isn't read");
    expect(error(() => parseBenchmark('qa-catch', catchFile().replace('sample: 10', 'sample: ten'), 'qa-catch.yaml'))).toBe('qa-catch.yaml:3: sample is a whole number above 0, or left out for every task');
    expect(error(() => parseBenchmark('qa-catch', catchFile().replace('role: qa', 'role: lead'), 'qa-catch.yaml'))).toContain("qa-catch.yaml:2: role is qa");
    expect(error(() => parseBenchmark('qa-catch', catchFile().replace('controls: false', 'controls: sometimes'), 'qa-catch.yaml'))).toContain('qa-catch.yaml:4: controls is true or false');
    expect(error(() => parseBenchmark('qa-catch', catchFile().replace('concurrency: 2', 'concurrency: 0'), 'qa-catch.yaml'))).toContain('qa-catch.yaml:5: concurrency is a whole number');
    expect(error(() => parseBenchmark('qa-catch', catchFile().replace("description: QA's catch rate.\n", ''), 'qa-catch.yaml'))).toContain('description says');
  });

  it('wants its configurations named, apart, and only with what a configuration has', () => {
    const wrong = (configurations: string) => error(() => parseBenchmark('qa-catch', catchFile('', configurations), 'qa-catch.yaml'));
    expect(wrong('  - name: main\n  - name: main\n')).toBe("qa-catch.yaml:8: name main is another configuration's already");
    expect(wrong('  - name: Main Branch\n')).toContain('qa-catch.yaml:7: name is lowercase letters');
    expect(wrong('  - name: main\n    effort: huge\n')).toContain('qa-catch.yaml:8: effort is one of');
    expect(wrong('  - name: main\n    runner: cloud\n')).toBe("qa-catch.yaml:8: runner isn't a configuration's: they're name, crew, model, effort");
    expect(wrong('  - name: main\n    crew: ""\n')).toContain('qa-catch.yaml:8: crew is a git ref');
    expect(error(() => parseBenchmark('qa-catch', catchFile().replace('configurations:\n  - name: main\n', 'configurations: []\n'), 'qa-catch.yaml'))).toContain('configurations lists at least one');
  });

  it('wants a judge where the benchmark has one', () => {
    const replay = (judge: string) => `description: The bug replay.\nrole: qa\ncontrols: false\nconcurrency: 2\n${judge}configurations:\n  - name: main\n`;
    expect(judgeFor(parseBenchmark('bug-replay', replay('judge:\n  model: claude-opus-5-5\n  maxTurns: 2\n  timeout: 90s\n'), 'bug-replay.yaml'))).toEqual({ model: 'claude-opus-5-5', maxTurns: 2, timeoutMs: 90_000 });
    expect(error(() => parseBenchmark('bug-replay', replay(''), 'bug-replay.yaml'))).toContain('judge is a map');
    expect(error(() => parseBenchmark('bug-replay', replay('judge:\n  model: claude-opus-5-5\n  maxTurns: 2\n  timeout: soon\n'), 'bug-replay.yaml'))).toBe('bug-replay.yaml:8: judge.timeout is a time like 90s, 8m or 2h');
    expect(error(() => parseBenchmark('bug-replay', replay('judge:\n  model: claude-opus-5-5\n  maxTurns: 2\n  timeout: 3m\n  effort: max\n'), 'bug-replay.yaml'))).toContain("effort isn't a judge's");
  });

  it('says where YAML that isn’t YAML goes wrong', () => {
    expect(error(() => parseBenchmark('qa-catch', 'description: [unclosed\n', 'qa-catch.yaml'))).toMatch(/^qa-catch\.yaml(:\d+)?: isn't YAML/);
    expect(error(() => parseBenchmark('qa-catch', '- a list\n', 'qa-catch.yaml'))).toContain('is a map of fields');
  });

  it('picks the configurations a run names, in its order, or all of them', () => {
    const b = parseBenchmark('qa-catch', catchFile('', '  - name: main\n  - name: terse\n    crew: x\n'), 'qa-catch.yaml');
    expect(pickConfigurations(b, undefined).map((c) => c.name)).toEqual(['main', 'terse']);
    expect(pickConfigurations(b, 'terse,main').map((c) => c.name)).toEqual(['terse', 'main']);
    expect(error(() => pickConfigurations(b, 'tres'))).toBe('--config tres: .focus/benchmarks/qa-catch.yaml has no such configuration: it has main, terse');
  });

  it('refuses a folder with a file no benchmark has, or missing one’s', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmarks-'));
    for (const name of fs.readdirSync(BENCHMARK_DIR)) fs.copyFileSync(path.join(BENCHMARK_DIR, name), path.join(dir, name));
    fs.writeFileSync(path.join(dir, 'qa-cach.yaml'), catchFile());
    expect(error(() => loadBenchmarks(dir))).toContain("qa-cach.yaml: no benchmark has that name: they're qa-catch, bug-replay");
    fs.rmSync(path.join(dir, 'qa-cach.yaml'));
    fs.rmSync(path.join(dir, 'bug-replay.yaml'));
    expect(error(() => loadBenchmark('bug-replay', dir))).toContain('bug-replay.yaml: missing: every benchmark has its file');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
