// The scheduler: a goal's lead asks to be woken later or regularly (schedule / schedules / unschedule), the
// schedule is kept in the plugin's own book through restarts, and each slot wakes the lead once, as a message from
// the scheduler; a slot run late, missed or held is toasted, and a run the lead doesn't answer within 20 minutes alerts
// the captain directly (alert.ts). FOCUS_PLUGINS=scheduler, then switched on per project.
import { z } from 'zod';
import type { FocusPlugin, LeadTool, PluginHost } from '../../plugin-api/server';
import { Book } from './book';
import { alertCaptain, alertWait } from './alert';
import { answeredLateText, describeTimes, lateBy, slotTime, unansweredText } from './rules';
import { type Delivery, Scheduler } from './scheduler';
import { freshScheduler, type RunRecord, SCHEDULER, type Schedule, type SchedulerState } from './shared';

/** Who the lead hears a run from. */
const FROM = 'Scheduler';
/** How long after Focus starts the first tick waits: past the turns Focus stopped part way through picking up again. */
const FIRST_TICK_MS = 5_000;

/** Wakes a schedule's lead, unless the goal's gone or the plugin's switched off for its project. */
function deliver(host: PluginHost, s: Schedule, text: string): Delivery {
  if (!host.agent(s.leadId) || !host.on(s.projectId)) return 'gone';
  try {
    return 'costly' in host.goals.message(s.leadId, text, { from: FROM }) ? 'held' : 'sent';
  } catch {
    return 'gone';
  }
}

/** What the captain's toast says of a slot that didn't run on time. */
export function heardToast(s: Schedule, run: RunRecord): { level: 'info' | 'error'; text: string } {
  const when = slotTime(run.slot, s.tz, run.at);
  if (run.outcome === 'missed') return { level: 'error', text: `${s.leadName}’s ${when} check (${s.id}) was missed: Focus was down or the machine asleep. A later one ran instead.` };
  if (run.outcome === 'held') return { level: 'error', text: `${s.leadName}’s ${when} check (${s.id}) is waiting: picking their conversation up on the API key costs, so it’s held until your plan’s limit resets.` };
  return { level: 'info', text: `${s.leadName}’s ${when} check (${s.id}) ran ${lateBy(run.at - run.slot)} late: Focus was down or the machine asleep.` };
}

/** A schedule as the lead reads it in the tools' answers. */
const line = (sched: Scheduler, s: Schedule, now: number) => {
  const next = sched.next(s);
  return `${s.id}: ${describeTimes(s, now)}, next ${next === null ? 'none' : slotTime(next, s.tz, now)}: ${s.what}`;
};

/** The alert tool: a lead raises something to the captain directly (toast, ledger, the bot's webhook), at most every 10 minutes. */
function alertTool(host: PluginHost, now: () => number): LeadTool {
  const last = new Map<string, number>();
  return {
    name: 'alert',
    description: 'Alert the captain directly, now, not through anyone’s routing: a toast, a line in the ship’s log, and their phone when Focus has a bot. Only for what can’t wait for your turn to end (a rollout going wrong, something you’re watching breaking); everything else goes in your turn as usual. At most one every 10 minutes.',
    input: { text: z.string().describe('What the captain needs to know, in a sentence or two: it’s all they see.') },
    run: async (lead, input) => {
      const { text } = z.object({ text: z.string() }).parse(input);
      if (!text.trim()) throw new Error('Say what the captain needs to know (`text`).');
      const at = now();
      const wait = alertWait(last.get(lead.agent.id), at);
      if (wait) throw new Error(`You alerted the captain a moment ago: the next can go in ${lateBy(wait)}. Put this in your turn instead, or wait.`);
      last.set(lead.agent.id, at);
      const goal = lead.agent.lead?.title;
      await alertCaptain(host, { projectId: lead.agent.projectId, agentId: lead.agent.id, agentName: lead.agent.name, ...(goal && { goal }), text: `${lead.agent.name}: ${text.trim()}` }, at);
      return 'The captain has been alerted.';
    },
  };
}

function leadTools(sched: Scheduler, now: () => number): LeadTool[] {
  return [
    {
      name: 'schedule',
      description: [
        'Ask to be woken later or regularly: at each time you get a message from the Scheduler saying what you asked to do, and the schedule holds across turns and Focus restarts.',
        'Give `cron` (five parts: minute hour day month weekday, e.g. "7 9,15,21 * * *" for 09:07, 15:07 and 21:07 daily) with an optional `until` (a day like 2026-10-26 means to the end of it), or `at` for once (2026-10-24T09:07).',
        'Times are read in `timezone` (an IANA name), this machine’s by default. Each run is a turn of yours, so no more often than every 5 minutes.',
        'If Focus was down or asleep when one fell due, the latest one runs as soon as it’s back, marked late, and the ones before it are reported missed, not run. The captain is told of each.',
      ].join(' '),
      input: {
        what: z.string().describe('What to do when it’s due: you hear this back each time.'),
        cron: z.string().optional().describe('A five-part cron pattern, for a repeating schedule.'),
        at: z.string().optional().describe('A single time, like 2026-10-24T09:07, for once.'),
        until: z.string().optional().describe('With `cron`: no run after this (2026-10-26, or 2026-10-26T21:30).'),
        timezone: z.string().optional().describe('An IANA time zone, like Europe/London: this machine’s by default.'),
      },
      run: async (lead, input) => {
        const ask = z.object({ what: z.string(), cron: z.string().optional(), at: z.string().optional(), until: z.string().optional(), timezone: z.string().optional() }).parse(input);
        const s = sched.add({ leadId: lead.agent.id, projectId: lead.agent.projectId, leadName: lead.agent.name }, ask);
        return `Scheduled ${line(sched, s, now())}`;
      },
      // the demo's scripted lead keeps an eye on its rollout three times a day
      demo: () => ({ what: 'Check the rollout’s error rate and say if it’s climbing.', cron: '7 9,15,21 * * *' }),
    },
    {
      name: 'schedules',
      description: 'Your schedules (from the schedule tool): each one’s id, times, next run and what it does.',
      input: {},
      run: async (lead) => {
        const mine = sched.of(lead.agent.id);
        return mine.length ? mine.map((s) => line(sched, s, now())).join('\n') : 'You have no schedules.';
      },
    },
    {
      name: 'unschedule',
      description: 'Stop one of your schedules, by its id (`schedules` lists them).',
      input: { id: z.string().describe('The schedule’s id, like sch-3.') },
      run: async (lead, input) => {
        const { id } = z.object({ id: z.string() }).parse(input);
        if (!sched.remove(lead.agent.id, id.trim())) throw new Error(`You have no schedule ${id}: \`schedules\` lists yours.`);
        return `Unscheduled ${id}.`;
      },
    },
  ];
}

/** Who a run's alert is about, as the captain reads it: none once the goal's gone, since there's no one left to answer. */
function about(host: PluginHost, sched: Scheduler, run: RunRecord, tz: string) {
  const lead = host.agent(run.leadId);
  if (!lead) return undefined;
  const s = sched.of(run.leadId).find((x) => x.id === run.scheduleId);
  return { lead, who: { id: run.scheduleId, leadName: lead.name, tz: s?.tz ?? tz } };
}

const scheduler: FocusPlugin = {
  id: SCHEDULER,
  start(host) {
    // the book is the record; this is the browser's copy of it, made afresh as Focus starts
    const state = host.state<SchedulerState>(freshScheduler, { saved: false });
    const book = new Book(host.dataDir());
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sched: Scheduler = new Scheduler({
      book,
      now: () => Date.now(),
      tz,
      deliver: (s, text) => deliver(host, s, text),
      heard: (s, run) => {
        const { level, text } = heardToast(s, run);
        host.toast(level, text, s.leadId);
      },
      unanswered: (run, now) => {
        const it = about(host, sched, run, tz);
        if (it) void alertCaptain(host, { projectId: it.lead.projectId, agentId: it.lead.id, agentName: it.lead.name, ...(it.lead.lead && { goal: it.lead.lead.title }), text: unansweredText(it.who, run, now) }, now);
      },
      answeredLate: (run, now) => {
        const it = about(host, sched, run, tz);
        if (it) host.toast('info', answeredLateText(it.who, run, now), it.lead.id);
      },
      publish: (view) => state.set(view),
    });
    if (book.setAside) host.toast('error', `The scheduler’s book couldn’t be read, so every schedule was lost: it’s kept at ${book.setAside}.`);
    setTimeout(() => sched.start(), FIRST_TICK_MS).unref();
    return {
      leadTools: [...leadTools(sched, () => Date.now()), alertTool(host, () => Date.now())],
      // the watchdog: a lead's turn ending answers the runs sent them by then
      turn: (agent, phase) => {
        if (phase === 'end') sched.turnEnded(agent.id);
      },
      // the captain stops a schedule from the panel
      routes: [{ method: 'post', path: '/unschedule', handle: ({ body }) => ({ removed: sched.remove(undefined, String(body.id)) }) }],
    };
  },
};

export default scheduler;
