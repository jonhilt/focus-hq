// The scheduler's book: every schedule and its latest runs, in a file of the plugin's own. Each change is written
// whole to a new file, flushed to disk (fsync) and renamed into place before it says it's done, so a slot claimed
// is claimed for good: state.json's saves wait a moment and aren't flushed, and a slot lost there would run twice.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { RunRecord, Schedule } from './shared';

/** The most runs the book keeps, newest: enough for the panel and the watchdog to look back over. */
export const MOST_RUNS = 200;

export interface Kept {
  /** The last schedule number given out, so ids are never reused. */
  made: number;
  schedules: Schedule[];
  runs: RunRecord[];
}

const empty = (): Kept => ({ made: 0, schedules: [], runs: [] });

const scheduleShape = z.object({
  id: z.string(), leadId: z.string(), projectId: z.string(), leadName: z.string(), what: z.string(),
  cron: z.string().optional(), at: z.number().optional(), until: z.number().optional(), tz: z.string(),
  createdAt: z.number(), lastSlot: z.number().optional(),
});
const runShape = z.object({ scheduleId: z.string(), leadId: z.string(), slot: z.number(), at: z.number(), outcome: z.enum(['on-time', 'late', 'missed', 'held']),
  answerBy: z.number().optional(), answeredAt: z.number().optional(), alertedAt: z.number().optional(),
});
const keptShape = z.object({ made: z.number(), schedules: z.array(scheduleShape), runs: z.array(runShape) });

export class Book {
  private readonly file: string;
  /** Where a damaged book was put aside as it was read, for the captain to hear of. */
  setAside: string | undefined;

  constructor(dir: string) {
    this.file = path.join(dir, 'schedules.json');
  }

  /**
   * What was kept, or an empty book when there's none. A file that can't be read as a book (a half-written one never
   * replaces a whole one, so it's damaged some other way) is kept aside, `schedules.json.bad-<when>`, never written over.
   */
  read(): Kept {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return empty();
    }
    const kept = keptShape.safeParse(parseJson(text));
    if (kept.success) return kept.data;
    this.setAside = `${this.file}.bad-${Date.now()}`;
    fs.renameSync(this.file, this.setAside);
    return empty();
  }

  /** Writes the book whole and flushed before returning. */
  write(kept: Kept): void {
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify({ ...kept, runs: kept.runs.slice(-MOST_RUNS) }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
