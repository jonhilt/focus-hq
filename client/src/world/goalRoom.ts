import { openQuestion } from '../../../shared/artifacts';
import type { Agent, GoalNote, LeadPr, QaStatus } from '../../../shared/types';

// What a team station shows of its goal beyond the lead's own screen: whether its briefing room is in session, on the
// lamps and sign at its door, the lead's note on the goal, on the board in its briefing room, and what the team's up to
// at a glance, on its screen on the holodeck's teams wall.

/**
 * How a goal room stands, seen from its door: no goal there, the lead at work, waiting on you to approve something,
 * waiting for your reply, waiting for a free slot to start, or stopped. A question the lead's asked you (with visual
 * options) waits on you too, while nothing more pressing does.
 */
export type GoalRoomTone = 'free' | 'in-session' | 'needs-you' | 'your-turn' | 'queued' | 'stopped';

export function goalRoomState(lead: Pick<Agent, 'status' | 'lead' | 'held'> | undefined): { tone: GoalRoomTone; label: string } {
  if (!lead) return { tone: 'free', label: 'Free' };
  if (openQuestion(lead) && lead.status !== 'waiting' && lead.status !== 'error' && lead.status !== 'stopped') return { tone: 'needs-you', label: 'Your answer' };
  // waiting for your plan's usage limit to reset, like one waiting for a slot
  if (lead.held) return { tone: 'queued', label: 'On hold' };
  switch (lead.status) {
    case 'waiting':
      return { tone: 'needs-you', label: 'Needs you' };
    case 'done':
      // a lead's turn ends with them waiting for yours
      return { tone: 'your-turn', label: 'Your turn' };
    case 'queued':
      return { tone: 'queued', label: 'Queued' };
    case 'error':
    case 'stopped':
      return { tone: 'stopped', label: 'Stopped' };
    case 'setting-up':
    case 'working':
    case 'testing':
    case 'pushing':
      return { tone: 'in-session', label: 'In session' };
  }
}

/** How far through its checklist the slice is, as a whole percentage, or null while it hasn't one. */
export function sliceProgress(note: GoalNote | undefined): number | null {
  if (!note?.slice.length) return null;
  return Math.round((100 * note.slice.filter((i) => i.done).length) / note.slice.length);
}

/**
 * A heading on the goal board and what's under it, each item with its mark and wrapped to at most `lines` lines;
 * `dim` for what's done with.
 */
export interface NoteSection {
  heading: string;
  lines: number;
  items: { mark: string; text: string; dim?: boolean }[];
}

/** How many of the lessons the board shows: the latest, since the note keeps them oldest first. */
const LESSONS = 2;

/**
 * The goal board's note pane, most pressing first, as far down as it fits: this slice's checklist, what done looks
 * like, what might come next, then the latest lessons. A section with nothing in it is left out.
 */
export function noteSections(note: GoalNote, slice: number): NoteSection[] {
  const out: NoteSection[] = [];
  if (note.slice.length) out.push({ heading: `Slice ${slice}`, lines: 2, items: note.slice.map((i) => ({ mark: i.done ? '☑' : '☐', text: i.text, dim: i.done })) });
  if (note.done) out.push({ heading: 'Done looks like', lines: 3, items: [{ mark: '◎', text: note.done }] });
  if (note.next.length) out.push({ heading: 'Next', lines: 1, items: note.next.map((text) => ({ mark: '→', text })) });
  if (note.learned.length) out.push({ heading: 'Learned', lines: 2, items: note.learned.slice(-LESSONS).map((text) => ({ mark: '•', text })) });
  return out;
}

/** Which of the board's rows (each its top and bottom, top down, in canvas pixels) a point `y` down it is on, if any. */
export function rowAt(rows: { top: number; bottom: number }[], y: number): number | undefined {
  const i = rows.findIndex((r) => y >= r.top && y < r.bottom);
  return i < 0 ? undefined : i;
}

/** Who sits round a briefing room's table, as the goal board lists them: the lead, the reviewer, then the helpers. */
export function roster<T>(lead: T | undefined, reviewer: T | undefined, helpers: (T | undefined)[]): { who: T; role: 'Lead' | 'Reviewer' | 'Helper' }[] {
  const out: { who: T; role: 'Lead' | 'Reviewer' | 'Helper' }[] = [];
  if (lead) out.push({ who: lead, role: 'Lead' });
  if (reviewer) out.push({ who: reviewer, role: 'Reviewer' });
  for (const h of helpers) if (h) out.push({ who: h, role: 'Helper' });
  return out;
}

/**
 * What a goal's lead is up to right now, in a line, for the teams wall: what they need from you while they need
 * something, otherwise what they're doing (or last did).
 */
export function leadNow(lead: Pick<Agent, 'status' | 'activity' | 'permission' | 'lead' | 'error'>): string {
  const question = openQuestion(lead);
  switch (lead.status) {
    case 'waiting':
      return lead.permission ? `Asking you: ${lead.permission.summary}` : 'Needs you';
    case 'error':
      return lead.error ? `Hit a problem: ${lead.error}` : 'Hit a problem';
    case 'stopped':
      return 'Stopped';
    case 'queued':
      return 'Waiting for a free slot to carry on';
  }
  if (question) return `Asked you: ${question.question}`;
  if (lead.status === 'done' && lead.lead?.closing) return `Ready to wrap up: ${lead.lead.closing.reason}`;
  return lead.activity || (lead.status === 'done' ? 'Waiting for your reply' : 'At work');
}

/**
 * As much of a slice's checklist as fits in `room` lines: all of it if it fits; otherwise the ticked-off items at its
 * top folded into one line (`done` of them), then what's still to do, the last line saying how many more there are.
 */
export function checklistGlance(items: GoalNote['slice'], room: number): { done: number; items: GoalNote['slice']; more: number } {
  if (items.length <= room) return { done: 0, items, more: 0 };
  let done = 0;
  while (done < items.length && items[done].done) done++;
  const rest = items.slice(done);
  const left = room - (done ? 1 : 0);
  if (rest.length <= left) return { done, items: rest, more: 0 };
  const shown = rest.slice(0, Math.max(0, left - 1));
  return { done, items: shown, more: rest.length - shown.length };
}

/** How a goal's pull request stands, on the teams wall: merged or closed, otherwise how QA has it. */
export type PrGlance = 'open' | 'testing' | 'passed' | 'failed' | 'merged' | 'closed';

export function prGlance(pr: Pick<LeadPr, 'outcome'>, qa: QaStatus | undefined): PrGlance {
  if (pr.outcome) return pr.outcome;
  switch (qa) {
    case 'queued':
    case 'testing':
      return 'testing';
    case 'passed':
    case 'failed':
      return qa;
    case 'error':
    case undefined:
      return 'open';
  }
}
