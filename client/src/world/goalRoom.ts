import { openQuestion } from '../../../shared/artifacts';
import { hailOf } from '../../../shared/tricorder';
import type { Agent, GoalNote, LeadPr, LeadWork, QaStatus } from '../../../shared/types';

// What a team station shows of its goal beyond the lead's own screen: whether its briefing room is in session, on the
// lamps and sign at its door, the lead's note on the goal, on the board in its briefing room, and what the team's up to
// at a glance, on its screen over its pod in the holodeck.

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

/** One step of the slice under way, done or still to do. */
export interface SliceStep {
  text: string;
  done: boolean;
}

/** The slice under way's steps: the tasks the lead has added or moved on in it, on the task list it keeps for itself (kept on its waypoint). */
export function sliceSteps(work: Pick<LeadWork, 'slice' | 'waypoints'> | undefined): SliceStep[] {
  const tasks = work?.waypoints?.find((w) => w.slice === work.slice)?.tasks ?? [];
  return tasks.map((t) => ({ text: t.subject, done: t.status === 'completed' }));
}

/** How far through its steps the slice is, as a whole percentage, or null while it hasn't any. */
export function sliceProgress(steps: readonly SliceStep[]): number | null {
  if (!steps.length) return null;
  return Math.round((100 * steps.filter((i) => i.done).length) / steps.length);
}

/**
 * A heading on the goal board and what's under it, each item with its mark; `dim` for what's done with. `side` says
 * which of the board's columns it goes in: the slice and where it's going under the goal, next and lessons under the
 * crew.
 */
export interface NoteSection {
  heading: string;
  side: 'goal' | 'crew';
  items: { mark: string; text: string; dim?: boolean }[];
}

/** How many of the lessons the board shows: the latest, since the note keeps them oldest first. */
const LESSONS = 2;

/**
 * The goal board's note, most pressing first: this slice's tasks, what done looks like, what might come next,
 * then the latest lessons. A section with nothing in it is left out.
 */
export function noteSections(note: GoalNote, slice: number, steps: readonly SliceStep[] = []): NoteSection[] {
  const out: NoteSection[] = [];
  if (steps.length) out.push({ heading: `Slice ${slice} · ${steps.filter((i) => i.done).length} of ${steps.length}`, side: 'goal', items: steps.map((i) => ({ mark: i.done ? '☑' : '☐', text: i.text, dim: i.done })) });
  if (note.done) out.push({ heading: 'Done looks like', side: 'goal', items: [{ mark: '◎', text: note.done }] });
  if (note.next.length) out.push({ heading: 'Next', side: 'crew', items: note.next.map((text) => ({ mark: '→', text })) });
  if (note.learned.length) out.push({ heading: 'Learned', side: 'crew', items: note.learned.slice(-LESSONS).map((text) => ({ mark: '•', text })) });
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
 * What a goal's lead is up to right now, in a line, for the screen over its pod: what they need from you while they need
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
 * As much of a slice's tasks as fits in `room` lines: all of it if it fits; otherwise the ticked-off items at its
 * top folded into one line (`done` of them), then what's still to do, the last line saying how many more there are.
 */
export function checklistGlance(items: SliceStep[], room: number): { done: number; items: SliceStep[]; more: number } {
  if (items.length <= room) return { done: 0, items, more: 0 };
  let done = 0;
  while (done < items.length && items[done].done) done++;
  const rest = items.slice(done);
  const left = room - (done ? 1 : 0);
  if (rest.length <= left) return { done, items: rest, more: 0 };
  const shown = rest.slice(0, Math.max(0, left - 1));
  return { done, items: shown, more: rest.length - shown.length };
}

/** How a goal's pull request stands, on the screen over its pod: merged or closed, otherwise how QA has it. */
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

/**
 * Who holds a goal's next move, on the screen over its pod and the sign at its door: its lead while they're at work,
 * QA while it tests what they shipped, a plugin while it claims it (the chief of staff, counting down to sending its
 * words), and otherwise the captain. `holder` is `lead`, `qa`, `you` or the claiming plugin's key; `why` is the line
 * that says why; `sign` names it in a word or two at the door; `counter` is a plugin's countdown on its pill.
 */
export interface GoalMove {
  holder: string;
  why: string;
  sign: string;
  counter?: string;
  /** The captain's move, but asking nothing of them now (a plugin's `quiet` claim): the lamps don't call them for it. */
  quiet?: boolean;
}

/** A plugin's claim on a goal's next move (`GoalPart.move`), by the holder key it declared. */
export interface MoveClaim {
  key: string;
  /** The holder's name, for the sign at the door. */
  label: string;
  why: string;
  counter?: string;
  /** It hands the move to the captain, rather than holding it: what it read leaves them something (`why`). */
  captain?: boolean;
  /** With `captain`: theirs, but asking nothing of them now, so it steps aside for anyone else's move and doesn't call them. */
  quiet?: boolean;
}

/** A pull request of the slice's, as the move reads it: its number and how it stands. */
export interface MovePr {
  number: number;
  state: PrGlance;
}

/**
 * What only the captain can answer, whatever else is going on, and why it's theirs: a raised hand, an error, a
 * question, a goal ready to close, a lead stopped, waiting on them or on hold for the plan's limit. Undefined for none.
 */
function captainsNow(lead: Agent): string | undefined {
  const hail = hailOf(lead);
  if ((hail && hail !== 'turn') || lead.status === 'stopped' || lead.status === 'waiting') return leadNow(lead);
  if (lead.held) return 'On hold until your plan’s usage limit resets, unless you carry on with your API key';
  return undefined;
}

/**
 * Whose move it is on `lead`'s goal, with the slice's pull requests `prs` and a plugin's `claim`, if one has a say:
 * what only the captain can answer comes first, then a plugin's claim (for itself, or handing it to the captain), then
 * the lead at work, then QA testing what they shipped, then the captain's (a pull request to merge, one QA failed, or
 * the turn that's ended, quietly when a plugin's quiet claim says it asks nothing of them now).
 */
export function goalMove(lead: Agent, prs: readonly MovePr[], claim: MoveClaim | undefined): GoalMove {
  const { label } = goalRoomState(lead);
  const owed = captainsNow(lead);
  if (owed) return { holder: 'you', why: owed, sign: label };
  if (claim?.captain && !claim.quiet) return { holder: 'you', why: claim.why, sign: label };
  if (claim && !claim.captain) return { holder: claim.key, why: claim.why, sign: claim.label, ...(claim.counter !== undefined && { counter: claim.counter }) };
  if (lead.status !== 'done') return { holder: 'lead', why: leadNow(lead), sign: label };
  const testing = prs.filter((p) => p.state === 'testing').map((p) => `#${p.number}`);
  if (testing.length) return { holder: 'qa', why: `Shipped ${testing.join(', ')}; QA is testing it. Nothing asked of you.`, sign: 'QA testing' };
  const passed = prs.find((p) => p.state === 'passed');
  if (passed) return { holder: 'you', why: `QA passed #${passed.number}: it waits for you to merge it.`, sign: `Merge #${passed.number}` };
  const failed = prs.find((p) => p.state === 'failed');
  if (failed) return { holder: 'you', why: `QA failed #${failed.number}: send it back to the lead, or look yourself.`, sign: 'QA failed' };
  if (claim?.quiet) return { holder: 'you', why: claim.why, sign: label, quiet: true };
  return { holder: 'you', why: leadNow(lead), sign: label };
}

/** One of the pills in a station's "whose move" row: lit for whoever holds the move, its countdown on it. */
export interface MovePill {
  key: string;
  label: string;
  colour: string;
  lit: boolean;
}

/**
 * The "whose move" row: every holder there is (`holders`, in order: the lead, QA, the plugins', the captain), whoever
 * holds `move` lit, with its countdown on its pill. The captain's, lit, is in `yours` (the room's tone), as the lamps
 * and the rest of the screen are, so their move shows in one colour.
 */
export function movePills(holders: readonly { key: string; label: string; colour: string }[], move: Pick<GoalMove, 'holder' | 'counter'>, yours?: string): MovePill[] {
  return holders.map(({ key, label, colour }) => {
    const lit = key === move.holder;
    return { key, label: lit && move.counter !== undefined ? `${label} · ${move.counter}` : label, colour: lit && key === 'you' && yours ? yours : colour, lit };
  });
}

/** How brightly a dim lamp shows a move held by someone other than the captain: lit, but not calling. */
export const HELD_ELSEWHERE = 0.3;

/**
 * How brightly the lamps by a station's door glow at `t` (s), from off (0) to full (1): they call the captain only
 * when the move is theirs (`yours`), pulsing while something needs them, steady while it's their turn; while the lead,
 * QA or a plugin holds it, they're dim and still.
 */
export function lampGlow(tone: GoalRoomTone, yours: boolean, t: number): number {
  if (tone === 'free') return 0;
  if (!yours) return HELD_ELSEWHERE;
  return { 'in-session': 0.8 + 0.2 * Math.sin(t * 2), 'needs-you': 0.6 + 0.4 * Math.sin(t * 7), 'your-turn': 1, queued: 0.55, stopped: 1 }[tone];
}
