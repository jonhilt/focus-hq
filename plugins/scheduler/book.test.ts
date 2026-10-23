import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Book } from './book';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-book-'));

describe('the scheduler’s book', () => {
  it('reads back what it wrote, and an empty book where there’s none', () => {
    const d = dir();
    const book = new Book(d);
    expect(book.read()).toEqual({ made: 0, schedules: [], runs: [] });
    const kept = { made: 1, schedules: [{ id: 'sch-1', leadId: 'l', projectId: 'p', leadName: 'N', what: 'x', cron: '0 9 * * *', tz: 'UTC', createdAt: 1 }], runs: [{ scheduleId: 'sch-1', leadId: 'l', slot: 2, at: 3, outcome: 'late' as const }] };
    book.write(kept);
    expect(new Book(d).read()).toEqual(kept);
  });

  it('keeps a damaged file aside rather than writing over it', () => {
    for (const text of ['{"made": 1, "sched', '{"made": "one", "schedules": [], "runs": []}']) {
      const d = dir();
      fs.writeFileSync(path.join(d, 'schedules.json'), text);
      const book = new Book(d);
      expect(book.read()).toEqual({ made: 0, schedules: [], runs: [] });
      expect(book.setAside).toMatch(/schedules\.json\.bad-\d+$/);
      const aside = fs.readdirSync(d).filter((f) => f.startsWith('schedules.json.bad-'));
      expect(aside).toHaveLength(1);
      expect(fs.readFileSync(path.join(d, aside[0] ?? ''), 'utf8')).toBe(text);
    }
  });
});
