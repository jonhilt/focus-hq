import { describe, expect, it } from 'vitest';
import { heardToast } from './server';
import type { RunRecord, Schedule } from './shared';
import { panelGroups } from './view';

const at = (iso: string) => Date.parse(iso);
const s: Schedule = { id: 'sch-1', leadId: 'lead-1', projectId: 'p', leadName: 'Novak', what: 'Check the rollout.', cron: '7 9,15,21 * * *', tz: 'Europe/London', createdAt: at('2026-10-23T11:00:00Z') };
const run = (slot: string, outcome: RunRecord['outcome'], late = 0): RunRecord => ({ scheduleId: 'sch-1', leadId: 'lead-1', slot: at(slot), at: at(slot) + late, outcome });

describe('the scheduler’s panel and toasts', () => {
  it('groups schedules by lead, with the next run and the latest runs', () => {
    const groups = panelGroups({
      schedules: [{ ...s, next: at('2026-10-24T08:07:00Z') }],
      runs: [run('2026-10-23T14:07:00Z', 'on-time'), { ...run('2026-10-23T20:07:00Z', 'late', 3 * 3_600_000), alertedAt: at('2026-10-23T23:27:00Z') }],
    }, at('2026-10-23T22:30:00Z'));
    expect(groups).toEqual([{
      leadId: 'lead-1', leadName: 'Novak',
      rows: [{ id: 'sch-1', times: 'cron “7 9,15,21 * * *” (Europe/London)', next: 'Sat 24 Oct 09:07', what: 'Check the rollout.', runs: [{ label: '15:07', outcome: 'on-time', unanswered: false }, { label: '21:07 · 3 h 0 min late · unanswered', outcome: 'late', unanswered: true }] }],
    }]);
  });

  it('tells the captain of a run late, missed or held', () => {
    expect(heardToast(s, run('2026-10-23T14:07:00Z', 'late', 20 * 60_000))).toEqual({ level: 'info', text: 'Novak’s 15:07 check (sch-1) ran 20 min late: Focus was down or the machine asleep.' });
    expect(heardToast(s, run('2026-10-23T14:07:00Z', 'missed')).level).toBe('error');
    expect(heardToast(s, run('2026-10-23T14:07:00Z', 'held')).text).toContain('held until your plan’s limit resets');
  });
});
