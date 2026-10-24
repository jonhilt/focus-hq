import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScorer, parseScorer, SCORER_DIR, ScorerFileError, scoreOf } from './scorerFiles';

const scorer = (front: string, body = 'Grade the report.\n') =>
  `---\ndescription: Grades QA's reports.\nrole: qa\nmodel: haiku\nsamplingRate: 25\nlabels:\n  thorough: 1\n  shallow: 0.5\n  wrong: 0\npassingScore: 1\nmaxTurns: 2\ntimeout: 3m\n${front}---\n${body}`;
const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ScorerFileError) return err.message;
    throw err;
  }
  return undefined;
};

describe('the scorers’ files', () => {
  it('has each one loading, the QA report scorer on its scale', () => {
    for (const file of fs.readdirSync(SCORER_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')) expect(loadScorer(file.slice(0, -3)).rubric).not.toBe('');
    expect(loadScorer('qa-report')).toMatchObject({ role: 'qa', model: 'haiku', samplingRate: 25, labels: { thorough: 1, shallow: 0.5, wrong: 0 }, passingScore: 1, maxTurns: 2, timeoutMs: 180_000 });
  });

  it('reads a scorer’s scale, and its rubric from the body', () => {
    expect(parseScorer('qa-report', scorer(''), 'qa-report.md')).toMatchObject({ name: 'qa-report', description: "Grades QA's reports.", rubric: 'Grade the report.', digest: expect.stringMatching(/^[0-9a-f]{8}$/) });
  });

  it('gives another digest for other words or another scale, and the same for another model or rate', () => {
    const digest = (src: string) => parseScorer('qa-report', src, 'qa-report.md').digest;
    const plain = digest(scorer(''));
    expect(digest(scorer('', 'Grade it harshly.\n'))).not.toBe(plain);
    expect(digest(scorer('').replace('shallow: 0.5', 'shallow: 0.25'))).not.toBe(plain);
    expect(digest(scorer('').replace('model: haiku', 'model: sonnet').replace('samplingRate: 25', 'samplingRate: 50'))).toBe(plain);
  });

  it('names the file and line of a field that isn’t one, or is wrong', () => {
    expect(error(() => parseScorer('qa-report', scorer('budget: 10\n'), 'qa-report.md'))).toBe("qa-report.md:13: budget isn't a scorer's field: they're description, role, model, samplingRate, labels, passingScore, maxTurns, timeout");
    expect(error(() => parseScorer('qa-report', scorer('').replace('role: qa', 'role: auditor'), 'qa-report.md'))).toContain('qa-report.md:3: role is the crew role whose work it grades');
    expect(error(() => parseScorer('qa-report', scorer('').replace('samplingRate: 25', 'samplingRate: 250'), 'qa-report.md'))).toContain('qa-report.md:5: samplingRate is how many of every hundred');
    expect(error(() => parseScorer('qa-report', scorer('').replace('shallow: 0.5', 'shallow: 5'), 'qa-report.md'))).toBe('qa-report.md:8: labels.shallow is a score from 0 to 1');
    expect(error(() => parseScorer('qa-report', scorer('').replace('  shallow: 0.5\n  wrong: 0\n', ''), 'qa-report.md'))).toContain('two at least');
    expect(error(() => parseScorer('qa-report', scorer('').replace('passingScore: 1', 'passingScore: 2'), 'qa-report.md'))).toContain('qa-report.md:10: passingScore is the score work passes at');
    expect(error(() => parseScorer('qa-report', scorer('').replace('timeout: 3m', 'timeout: soon'), 'qa-report.md'))).toContain('qa-report.md:12: timeout is a time');
  });

  it('wants its frontmatter, a description and a rubric', () => {
    expect(error(() => parseScorer('qa-report', 'Grade the report.', 'qa-report.md'))).toBe('qa-report.md:1: starts with its frontmatter, between two --- lines');
    expect(error(() => parseScorer('qa-report', scorer('', '\n'), 'qa-report.md'))).toContain('its body is the rubric');
    expect(error(() => parseScorer('qa-report', scorer('').replace("description: Grades QA's reports.\n", ''), 'qa-report.md'))).toContain('description says');
    expect(error(() => loadScorer('qa-reprot'))).toBe(`${path.join('.focus', 'scorers', 'qa-reprot.md')}: missing: there's no scorer of that name`);
  });

  it('scores a label as its scale says, and passes it at the passing score', () => {
    const s = parseScorer('qa-report', scorer(''), 'qa-report.md');
    expect([scoreOf(s, 'thorough'), scoreOf(s, 'shallow'), scoreOf(s, 'wrong'), scoreOf(s, 'brilliant'), scoreOf(s, 'toString')]).toEqual([
      { score: 1, passed: true },
      { score: 0.5, passed: false },
      { score: 0, passed: false },
      undefined,
      undefined,
    ]);
  });
});
