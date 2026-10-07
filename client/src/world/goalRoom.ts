import type { Agent, GoalNote } from '../../../shared/types';

// What a team station shows of its goal beyond the lead's own screen: whether its briefing room is in session, on the
// lamps and sign at its door, and the lead's note on the goal, on the board in its briefing room.

/**
 * How a goal room stands, seen from its door: no goal there, the lead at work, waiting on you to approve something,
 * waiting for your reply, waiting for a free slot to start, or stopped.
 */
export type GoalRoomTone = 'free' | 'in-session' | 'needs-you' | 'your-turn' | 'queued' | 'stopped';

export function goalRoomState(lead: Pick<Agent, 'status'> | undefined): { tone: GoalRoomTone; label: string } {
  if (!lead) return { tone: 'free', label: 'Free' };
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
 * The goal board's two columns: this slice's checklist (what's under way, first and in full) and what might come
 * next; then what done looks like and the latest lessons. A section with nothing in it is left out.
 */
export function noteColumns(note: GoalNote, slice: number): [NoteSection[], NoteSection[]] {
  const left: NoteSection[] = [];
  const right: NoteSection[] = [];
  if (note.slice.length) {
    left.push({ heading: `Slice ${slice}`, lines: 2, items: note.slice.map((i) => ({ mark: i.done ? '☑' : '☐', text: i.text, dim: i.done })) });
  }
  if (note.next.length) left.push({ heading: 'Next', lines: 1, items: note.next.map((text) => ({ mark: '→', text })) });
  if (note.done) right.push({ heading: 'Done looks like', lines: 4, items: [{ mark: '◎', text: note.done }] });
  if (note.learned.length) right.push({ heading: 'Learned', lines: 2, items: note.learned.slice(-LESSONS).map((text) => ({ mark: '•', text })) });
  return [left, right];
}
