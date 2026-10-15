import { describe, expect, it } from 'vitest';
import { catchGuard } from './qaGuard';

describe('catchGuard', () => {
  const planted = { file: 'a.ts', line: 1, before: '', after: '', bug: 'x' };
  it('reads the latest run as a guard, or says it hasn’t been measured', () => {
    const results = [{ repo: 'o/r', pr: 1, planted, outcome: 'caught' as const, summary: '' }, { repo: 'o/r', pr: 2, planted, outcome: 'missed' as const, summary: '' }];
    expect(catchGuard({ at: Date.parse('2026-10-15T09:00:00Z'), model: 'sonnet', results })).toBe('  QA catch rate: caught 1 of 2 planted bugs (50%), 0 failed for something else, 1 missed · 2026-10-15, sonnet');
    expect(catchGuard(undefined)).toMatch(/not measured yet/);
  });

  it('counts the clean pull requests QA failed among the guard', () => {
    const controls = [
      { repo: 'o/web', pr: 1, outcome: 'clean' as const, summary: '', costUsd: 0.3 },
      { repo: 'o/web', pr: 2, outcome: 'false-alarm' as const, summary: '', costUsd: 0.2 },
      { repo: 'o/web', pr: 3, outcome: 'error' as const, summary: '' },
    ];
    expect(catchGuard({ at: Date.parse('2026-10-15T09:00:00Z'), model: 'sonnet', results: [{ repo: 'o/web', pr: 1, planted, outcome: 'caught', summary: '' }], controls })).toBe(
      '  QA catch rate: caught 1 of 1 planted bugs (100%), 0 failed for something else, 0 missed, 1 of 2 clean ones failed · 2026-10-15, sonnet',
    );
  });
});
