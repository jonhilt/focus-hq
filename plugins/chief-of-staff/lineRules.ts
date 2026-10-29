// The direct line's decisions (README.md#the-direct-line): whether a goal it's asked to start starts, or is one it
// started already; whether it may tell a goal's lead something; what closing one it started does; and how the line
// picks up after a restart. Pure: the I/O is the line's (line.ts).
import type { CosLine, LineStart, LineTold } from './shared';

/** A goal's words as its key reads them: lowercase, punctuation and runs of space as one space. */
export const normalised = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The key a goal it starts is kept by: the project and its words, normalised, so asking again finds it. */
export const goalKey = (projectId: string, text: string): string => `${projectId}|${normalised(text)}`;

/** What `start_goal` does: starts it, finds it started already (a retried or resumed turn), or refuses, saying why. */
export type StartStep = { kind: 'start'; key: string } | { kind: 'already'; start: LineStart } | { kind: 'refuse'; why: string };

/**
 * Whether `call` starts a goal. It starts once: a goal with the same key it started that's still open (its lead
 * aboard, and not closed from the line) is found, not started again, whichever turn asks. Only in a project on the line,
 * and only with its words and why, since the user reads why.
 */
export function startStep(
  call: { projectId: string; text: string; why: string },
  line: { projects: readonly { id: string; name: string }[]; started: readonly LineStart[]; aboard: ReadonlySet<string> },
): StartStep {
  if (!line.projects.some((p) => p.id === call.projectId)) {
    return { kind: 'refuse', why: `There's no project ${call.projectId} on your line. The projects are: ${line.projects.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}.` };
  }
  if (!normalised(call.text)) return { kind: 'refuse', why: 'Say what the goal is: text.' };
  if (!call.why.trim()) return { kind: 'refuse', why: 'Say why you’re starting it: the user reads it.' };
  const key = goalKey(call.projectId, call.text);
  const start = line.started.find((s) => s.key === key && s.closed === undefined && line.aboard.has(s.leadId));
  return start ? { kind: 'already', start } : { kind: 'start', key };
}

/**
 * What `tell_goal` does: tells the lead; finds the same words told them already from the line (a retried or
 * resumed turn), not telling them twice; or refuses when they aren't an open goal's lead on the line, or there's
 * nothing to say.
 */
export type TellStep = { kind: 'tell'; leadId: string } | { kind: 'already' } | { kind: 'refuse'; why: string };

export function tellStep(call: { leadId: string; text: string }, line: { goals: readonly { id: string }[]; told: readonly LineTold[] }): TellStep {
  if (!line.goals.some((g) => g.id === call.leadId)) return { kind: 'refuse', why: `${call.leadId} isn't an open goal's lead on your line: use a lead id from the goals listed.` };
  const said = normalised(call.text);
  if (!said) return { kind: 'refuse', why: 'Say what to tell them: text.' };
  const again = line.told.some((t) => t.leadId === call.leadId && normalised(t.text) === said);
  return again ? { kind: 'already' } : { kind: 'tell', leadId: call.leadId };
}

/**
 * What Close on a goal it started does: closes it while it's open; a goal closed already (from the line, or its lead
 * gone some other way) is only marked closed, so pressing twice closes it once.
 */
export type CloseStep = { kind: 'close'; start: LineStart } | { kind: 'mark'; start: LineStart } | { kind: 'refuse'; why: string };

export function closeStep(key: string, started: readonly LineStart[], aboard: ReadonlySet<string>): CloseStep {
  const start = started.findLast((s) => s.key === key);
  if (!start) return { kind: 'refuse', why: 'It didn’t start that goal' };
  if (start.closed !== undefined) return { kind: 'refuse', why: 'That goal is closed already' };
  return aboard.has(start.leadId) ? { kind: 'close', start } : { kind: 'mark', start };
}

/** The line as it picks up after a restart: a turn Focus went down in the middle of ends failed, so the line stays usable. */
export function lineAfterRestart(line: CosLine): CosLine {
  if (line.status !== 'thinking') return line;
  return { ...line, status: 'failed', error: 'Interrupted when Focus shut down. Say it again.' };
}

/** Whether the user may say something now: not while a turn runs, and not nothing. */
export type SayStep = { kind: 'say'; text: string } | { kind: 'refuse'; why: string };

export function sayStep(line: Pick<CosLine, 'status'>, text: string): SayStep {
  if (line.status === 'thinking') return { kind: 'refuse', why: 'The chief of staff is still thinking' };
  const said = text.trim();
  return said ? { kind: 'say', text: said } : { kind: 'refuse', why: 'Say something first' };
}
