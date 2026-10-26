import path from 'node:path';
import type { GoalNote, LeadWork } from '../../shared/types';
import { threadContacts } from './contacts';
import { turnedWaypoint } from './waypoints';

// A goal's brief: a markdown file the lead keeps beside the repos in their workspace (./brief.md) with Claude Code's own
// tools, in place of a note tool. Ops only reads it: the goal's title (its `#` heading), and under headings of their
// own what done looks like, what the slices taught, ideas for next and the loose threads, for the chart, the captain and
// the plugins; and the whole file again for the lead once their conversation is compacted. Pure: sessions.ts reads
// the file, and the lead may write it any way they like (a heading missing only means that part doesn't show).

/** The brief's name, at the root of the lead's workspace. */
export const BRIEF_FILE = 'brief.md';

/** The tools a lead edits a file with, which Ops hears of as each finishes (a PostToolUse hook): one on the brief has it read again. */
export const EDIT_TOOLS = 'Write|Edit|MultiEdit';

/** Whether a file tool's input (`Write`, `Edit`…) is about the brief in workspace `cwd`, however the path is put. */
export function editsBrief(cwd: string, toolInput: unknown): boolean {
  const file = typeof toolInput === 'object' && toolInput !== null ? Reflect.get(toolInput, 'file_path') : undefined;
  return typeof file === 'string' && path.resolve(cwd, file) === path.join(cwd, BRIEF_FILE);
}

/** How much of the brief Ops keeps (it goes to every browser with the goal), and of what it reads out of it. */
export const BRIEF_LIMITS = { chars: 20_000, title: 120, item: 400, learned: 30, next: 12, threads: 20 } as const;

/** What a brief says: its title, the note, and the loose threads, each as the lead wrote it. */
export interface ReadBrief {
  title?: string;
  note: GoalNote;
  threads: string[];
}

type Section = 'done' | 'learned' | 'next' | 'threads' | 'other';

/** Which part of the note a heading starts, by its words: the lead's own headings, loosely. */
function sectionOf(heading: string): Section {
  const h = heading.toLowerCase();
  if (/thread|contact|loose end|open question/.test(h)) return 'threads';
  if (/^(what )?done\b|definition of done/.test(h)) return 'done';
  if (/^(what (we|the slices?) )?(learn|lesson|taught)/.test(h)) return 'learned';
  if (/^(ideas? for )?next|^ideas/.test(h)) return 'next';
  return 'other';
}

/** A line of markdown as plain text: links as their words, no emphasis or code marks. */
const plain = (text: string) =>
  text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)/g, '').replace(/\s+/g, ' ').trim();

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** A section's items: each top-level bullet with what follows it, or each paragraph when there are no bullets. A ticked box is done with. */
function items(lines: readonly string[]): string[] {
  const out: string[] = [];
  let open: string[] | undefined;
  const bulleted = lines.some((l) => BULLET.exec(l)?.[1].length === 0);
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    if (bulleted ? bullet && bullet[1].length < 2 : !line.trim() && open) {
      if (open) out.push(open.join(' '));
      open = bulleted && bullet ? [bullet[2]] : undefined;
    } else if (line.trim() && (open || !bulleted)) {
      // what comes before a section's first bullet introduces them: it isn't one
      (open ??= []).push(line.trim());
    }
  }
  if (open) out.push(open.join(' '));
  return out.filter((t) => !/^\[[xX]\]/.test(t.trim())).map((t) => plain(t.replace(/^\[[ ]\]\s*/, ''))).filter(Boolean);
}

/** The brief, read: its first `#` heading is the goal's title; each `##` (or deeper) heading starts the part it names. */
export function readBrief(text: string): ReadBrief {
  const sections: Record<Section, string[]> = { done: [], learned: [], next: [], threads: [], other: [] };
  let title: string | undefined;
  let at: Section = 'other';
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading && heading[1] === '#' && title === undefined) title = plain(heading[2]);
    else if (heading) at = sectionOf(plain(heading[2]));
    else sections[at].push(line);
  }
  const L = BRIEF_LIMITS;
  const list = (s: Section, most: number) => items(sections[s]).map((t) => clip(t, L.item)).slice(0, most);
  return {
    ...(title && { title: clip(title, L.title) }),
    note: { done: clip(items(sections.done).join(' '), L.item * 2), learned: list('learned', L.learned), next: list('next', L.next) },
    threads: list('threads', L.threads),
  };
}

const same = (a: string, b: string) => plain(a).toLowerCase() === plain(b).toLowerCase();

/** The brief as Ops keeps it: cut short past `BRIEF_LIMITS.chars`, saying so. */
export const keptBrief = (text: string): string =>
  text.length <= BRIEF_LIMITS.chars ? text : `${text.slice(0, BRIEF_LIMITS.chars)}\n\n[Ops kept only the first ${BRIEF_LIMITS.chars} characters of this brief.]`;

/**
 * The goal once Ops has read the lead's brief: the file as it is, the title it gives (or the one the goal had), the note,
 * the contacts its loose threads are (`threadContacts`), and the waypoint a change of what done looks like turns the
 * course at. The ideas for next the captain spun off stay off the note until the lead takes them off the brief. The same
 * goal when the brief hasn't changed.
 */
export function briefedGoal(work: LeadWork, text: string, now: number): LeadWork {
  const md = keptBrief(text);
  if (md === work.briefMd) return work;
  const read = readBrief(md);
  const spun = (work.spunOffIdeas ?? []).filter((s) => read.note.next.some((i) => same(s, i)));
  const note: GoalNote = { ...read.note, next: read.note.next.filter((i) => !spun.some((s) => same(s, i))) };
  const { briefAsked: _, spunOffIdeas: __, ...rest } = work;
  const contacts = threadContacts(work, read.threads, now);
  return {
    ...rest,
    briefMd: md,
    title: read.title ?? work.title,
    note,
    waypoints: turnedWaypoint(work, note, now),
    ...(contacts.length && { contacts }),
    ...(spun.length && { spunOffIdeas: spun }),
  };
}

/** A goal from before brief.md, whose lead kept a note with the note tool and hasn't been asked to write the brief. */
export const needsBrief = (work: Pick<LeadWork, 'briefMd' | 'briefAsked' | 'note' | 'contacts'>): boolean =>
  work.briefMd === undefined && !work.briefAsked && (!!work.note || !!work.contacts?.some((c) => !c.closed));

/** A goal's note and open contacts (from the note tool, before brief.md) as a brief, for its lead to write. */
export function noteAsBrief(work: Pick<LeadWork, 'title' | 'note' | 'contacts'>): string {
  const n = work.note;
  const section = (heading: string, lines: string[]) => [`## ${heading}`, '', ...(lines.length ? lines : ['- '])].join('\n');
  return [
    `# ${work.title}`,
    section('Done looks like', n?.done ? [n.done] : []),
    section('Learned', (n?.learned ?? []).map((l) => `- ${l}`)),
    section('Next', (n?.next ?? []).map((x) => `- ${x}`)),
    section('Loose threads', (work.contacts ?? []).filter((c) => !c.closed).map((c) => `- ${c.text}`)),
  ].join('\n\n');
}

/** What a lead from before brief.md hears as their next turn starts: the note tool is gone, and their note is a file now. */
export function briefMovedNote(work: Pick<LeadWork, 'title' | 'note' | 'contacts'>): string {
  return [
    `[Ops] The goal's note is now a file you keep yourself: ./${BRIEF_FILE}, at the root of your workspace beside the repos (it's in no repo, so it's never committed). The note tool is gone. Write the file now, starting from your note as it stood, and edit it with your usual tools from here on. Ops reads it as you change it, shows it to the captain, and gives it back to you whenever your conversation is compacted.`,
    `\`\`\`markdown\n${noteAsBrief(work)}\n\`\`\``,
  ].join('\n\n');
}

/**
 * The goal as the lead needs it where their conversation may have been summarised or lost: the goal as the captain put it,
 * and the brief as Ops last read it (or, before brief.md, the note).
 */
export function briefForPrompt(work: Pick<LeadWork, 'title' | 'brief' | 'briefMd' | 'note' | 'contacts'>): string {
  const parts = [`The goal: ${work.title}`];
  if (work.brief && work.brief !== work.title) parts.push(`As the captain first put it:\n${work.brief.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}`);
  if (work.briefMd !== undefined) parts.push(`Your brief, ./${BRIEF_FILE}, as it stands:\n\n${work.briefMd.trim() || '(empty)'}`);
  else if (work.note || work.contacts?.length) parts.push(`Your note as it stood (write it to ./${BRIEF_FILE}):\n\n${noteAsBrief(work)}`);
  else parts.push(`You haven't written ./${BRIEF_FILE} yet.`);
  return parts.join('\n\n');
}
