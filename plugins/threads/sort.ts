// Sort for me (README.md): the threads plugin asking a model where a project's threads still to decide end. Pure: which
// threads it asks about, what it tells the model, and the proposals it takes from the answer; the server does the asking.
import type { Agent, GoalRecord, LedgerEvent, ThreadProposal } from '../../plugin-api/shared';
import { NOTE_LIMIT, THREAD_ENDS, type Thread } from './shared';

/** The model that sorts: Claude Code's alias for the latest Sonnet. A judgement over the project's record, a few cents a sort. */
export const SORT_MODEL = 'sonnet';

/**
 * At most this many threads a sort: every one a project has to decide, in one call, so a thread said twice is seen
 * twice and a press doesn't ask about the same oldest ones again (Focus's own had about 200 at the first press).
 */
export const SORT_LIMIT = 300;

/** How many of a project's closed goals, the latest, the model reads of: every one since the oldest thread, so it can say which did it. */
const GOALS_READ = 200;

/** The threads a sort asks about: a closed goal's (not one under way, of `underWay`), still to decide; never proposed first, then oldest first. */
export function toSort(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>): Thread[] {
  return (threads ?? [])
    .filter((t) => !t.decided && !underWay.has(t.goal))
    .sort((a, b) => Number(!!a.proposed) - Number(!!b.proposed) || a.at - b.at)
    .slice(0, SORT_LIMIT);
}

/** Project `projectId`'s closed goals, as each last closed, the latest first. */
export function closedGoals(events: readonly LedgerEvent[], projectId: string): GoalRecord[] {
  const last = new Map<string, GoalRecord>();
  for (const e of events) if (e.kind === 'goal-closed' && e.projectId === projectId) last.set(e.goal.id, e.goal);
  return [...last.values()].sort((a, b) => b.closedAt - a.closedAt);
}

/** An idea for next nothing has picked up this many days after its goal closed is proposed dropped, unless the record says it still matters. */
export const STALE_DAYS = 7;

export const SORT_SYSTEM = `You help the user clear a software project's loose threads: contacts a goal's lead logged as needing real attention (a risk, a question, something off the course), and ideas for next a goal still had when it closed. For each thread, propose where it ends, from what the project's record shows:
- resolved: a later goal did it. Say which, by its title.
- dropped: it no longer matters (overtaken, done another way, or it went nowhere for a good reason). Say why, in a few words.
- parked: worth keeping, but not now. Say until when, or until what.
- next: it still matters and should be done. Say who takes it on: "you", or the title of a goal under way that should.
When a thread says the same as another listed thread, give that thread's id as sameAs, and propose resolved or dropped for the one that adds nothing.
An idea for next whose goal closed more than ${STALE_DAYS} days before today, that no goal since has taken up and that nothing in the record says still matters, went nowhere: propose dropped, saying nothing has picked it up since its goal closed (and when). The user keeps the ones they still want.
Leave out any other thread the record doesn't let you judge, a contact especially: no proposal is better than a guess, and the user decides every one. Never say something happened unless the record says so. Keep each why under 140 characters, in plain words.`;

/** What the model may answer: a proposal per thread it can judge, by the id the prompt gave it. */
export const SORT_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The thread’s id, as listed: t1, t2…' },
          as: { type: 'string', enum: [...THREAD_ENDS] },
          why: { type: 'string', description: 'Who takes it on (next), until when (parked), why (dropped) or what did it (resolved)' },
          sameAs: { type: 'string', description: 'The id of a listed thread it says the same as, if any' },
        },
        required: ['id', 'as', 'why'],
      },
    },
  },
  required: ['proposals'],
};

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const cut = (text: string, n: number) => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);
const words = (list: readonly string[] | undefined, n: number) => (list ?? []).slice(-n).map((x) => cut(x, 200)).join('; ');

/** A goal as the model reads it: its title, when it closed, what done looked like, and what it learned last. */
function goalLine(g: GoalRecord): string {
  const parts = [g.note?.done && `done looked like: ${cut(g.note.done, 300)}`, g.note?.learned.length && `learned: ${words(g.note.learned, 3)}`].filter(Boolean);
  return `- “${g.title}” (closed ${day(g.closedAt)})${parts.length ? `: ${parts.join('; ')}` : ''}`;
}

/** A goal under way as the model reads it: its title, what done looks like, and where it's heading. */
function underWayLine(lead: Pick<Agent, 'lead'>): string[] {
  const work = lead.lead;
  if (!work) return [];
  const parts = [work.note?.done && `done looks like: ${cut(work.note.done, 300)}`, work.note?.next.length && `next: ${words(work.note.next, 5)}`].filter(Boolean);
  return [`- “${work.title}”${parts.length ? `: ${parts.join('; ')}` : ''}`];
}

/** What the model's asked on day `now`: the project's goals under way and closed, then the threads to decide, each by an id of its own. */
export function sortPrompt(listed: readonly Thread[], closed: readonly GoalRecord[], leads: readonly Pick<Agent, 'lead'>[], now: number): string {
  const threads = listed.map((t, i) =>
    `t${i + 1} · from “${t.goalTitle}” (closed ${t.closedAt === undefined ? 'earlier' : day(t.closedAt)}) · ${t.idea ? 'idea for next' : `contact, noticed ${day(t.at)}`} · ${cut(t.text, 400)}`);
  const under = leads.flatMap(underWayLine);
  return [
    `Today is ${day(now)}.`,
    `Goals under way:\n${under.length ? under.join('\n') : '- none'}`,
    `Goals closed, the latest first:\n${closed.slice(0, GOALS_READ).map(goalLine).join('\n') || '- none'}`,
    `Threads to decide:\n${threads.join('\n')}`,
  ].join('\n\n');
}

const isEnd = (as: unknown): as is ThreadProposal['as'] => THREAD_ENDS.some((end) => end === as);
const at = (id: unknown, listed: readonly Thread[]) => (typeof id === 'string' && /^t\d+$/.test(id) ? listed[Number(id.slice(1)) - 1] : undefined);

/** One item of the model's answer as a proposal, if it's whole: a listed thread, an end, and why (or the thread it says the same as). */
function proposalOf(item: unknown, listed: readonly Thread[]): ThreadProposal | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const field = (name: string): unknown => Reflect.get(item, name);
  const [t, as, why, same] = [at(field('id'), listed), field('as'), field('why'), at(field('sameAs'), listed)];
  const said = typeof why === 'string' ? why.replace(/\s+/g, ' ').trim() : '';
  if (!t || !isEnd(as) || !said) return undefined;
  const note = same && same !== t ? `Same as “${cut(same.text, 60)}” (${cut(same.goalTitle, 40)}): ${said}` : said;
  return { goalId: t.goal, contact: t.contact, as, note: cut(note, NOTE_LIMIT) };
}

/** The proposals in the model's answer (`structured`) for the threads it was asked about: each whole one, one per thread, the first. */
export function proposalsFrom(structured: unknown, listed: readonly Thread[]): ThreadProposal[] {
  const answer = typeof structured === 'object' && structured !== null ? Reflect.get(structured, 'proposals') : undefined;
  const items: unknown[] = Array.isArray(answer) ? answer : [];
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const p = proposalOf(item, listed);
    const key = p && `${p.goalId}:${p.contact}`;
    if (!p || !key || seen.has(key)) return [];
    seen.add(key);
    return [p];
  });
}

/**
 * What the demo ship's stand-in for the model answers: an idea that shares words with a goal under way goes to it,
 * other ideas are dropped, and contacts are taken on by the captain.
 */
export function demoAnswer(listed: readonly Thread[], leads: readonly Pick<Agent, 'lead'>[]): { proposals: { id: string; as: string; why: string }[] } {
  const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const goalFor = (t: Thread) => leads.find((a) => a.lead && [...words(a.lead.title)].filter((w) => words(t.text).has(w)).length >= 2)?.lead?.title;
  return {
    proposals: listed.map((t, i) => {
      const goal = t.idea ? goalFor(t) : undefined;
      const id = `t${i + 1}`;
      if (goal) return { id, as: 'next', why: `“${goal}”, under way` };
      return t.idea ? { id, as: 'dropped', why: 'Its goal closed without it, and nothing since has picked it up' } : { id, as: 'next', why: 'you' };
    }),
  };
}
