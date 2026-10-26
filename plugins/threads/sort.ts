// Sort for me (README.md): the threads plugin asking a model where a project's threads still to decide end. Pure: what
// it tells the model, and the proposals it takes from the answer (which threads it asks about is threadsRules.ts');
// the server does the asking.
import { type Agent, type GoalRecord, type LedgerEvent, projectIntents, type ThreadProposal } from '../../plugin-api/shared';
import { NOTE_LIMIT, THREAD_ENDS, type Thread } from './shared';

/** The model that sorts: Claude Code's alias for the latest Sonnet. A judgement over the project's record, a few cents a sort. */
export const SORT_MODEL = 'sonnet';

/** How many of a project's closed goals, the latest, the model reads of: every one since the oldest thread, so it can say which did it. */
const GOALS_READ = 200;

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
The user's own decisions, when listed, say what they want: follow them over anything you'd infer (a thread they asked to keep is parked, not dropped; one waiting on their review is next for them). A pull request listed as merged is done.
A risk (a secret in plain text, a security hole, one customer's data reaching another) is next for the user, whatever it serves, even if no guardrail names it.
When the project's intents are listed, they're what its work is for, as the user agreed them: judge every thread against them, contacts too, and start each why with the name of the intent it serves (its words before the colon) or "Serves none". next: it serves an intent and is worth doing now; say who. parked: it serves one, but not yet; say until when. dropped: it serves none of them. A thread that puts one of the guardrails at risk is next for the user, whatever it serves. Leave one out only if you can't tell what it serves.
When no intents are listed, an idea for next whose goal closed more than ${STALE_DAYS} days before today, that no goal since has taken up and that nothing in the record says still matters, went nowhere: propose dropped, saying nothing has picked it up since its goal closed (and when). The user keeps the ones they still want. Leave out any other thread the record doesn't let you judge, a contact especially: no proposal is better than a guess, and the user decides every one.
Never say something happened unless the record says so. Keep each why under 140 characters, in plain words.`;

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

/** A pull request's key, as `merged` holds them. */
const prKey = (repo: string, pr: number) => `${repo}#${pr}`;

/** A goal's pull requests as the model reads them: each with whether it merged, at the goal's close or since (`merged`). */
function prsLine(g: GoalRecord, merged: ReadonlySet<string>): string | undefined {
  const prs = g.prs.map((p) => `${p.repo.split('/').pop() ?? p.repo}#${p.number} ${p.outcome === 'merged' || merged.has(prKey(p.repo, p.number)) ? 'merged' : (p.outcome ?? 'open')}`);
  return prs.length ? `pull requests: ${prs.join(', ')}` : undefined;
}

/** A goal as the model reads it: its title, when it closed, what done looked like, what it learned last, and its pull requests. */
function goalLine(g: GoalRecord, merged: ReadonlySet<string>): string {
  const parts = [g.note?.done && `done looked like: ${cut(g.note.done, 300)}`, g.note?.learned.length && `learned: ${words(g.note.learned, 3)}`, prsLine(g, merged)].filter(Boolean);
  return `- “${g.title}” (closed ${day(g.closedAt)})${parts.length ? `: ${parts.join('; ')}` : ''}`;
}

/** A goal under way as the model reads it: its title, what done looks like, and where it's heading. */
function underWayLine(lead: Pick<Agent, 'lead'>): string[] {
  const work = lead.lead;
  if (!work) return [];
  const parts = [work.note?.done && `done looks like: ${cut(work.note.done, 300)}`, work.note?.next.length && `next: ${words(work.note.next, 5)}`].filter(Boolean);
  return [`- “${work.title}”${parts.length ? `: ${parts.join('; ')}` : ''}`];
}

type IntentLine = Extract<LedgerEvent, { kind: 'intent' }>;

/** The project's compass as the model reads it (its own intent lines, as `projectIntents` reads them): what it's for, its guardrails and its intents. */
function compassLines(intents: readonly IntentLine[]): string {
  const about = intents.find((i) => !i.id);
  const aims = intents.filter((i) => i.id).map((i) => `- ${i.what}`);
  if (!about && !aims.length) return 'The project’s intents: none agreed yet.';
  return [
    `What the project is for: ${about?.what ?? 'not said'}${about?.constraints.length ? `\nIts guardrails, how the work is done: ${about.constraints.join('; ')}` : ''}`,
    `Its intents, what the work is for:\n${aims.length ? aims.join('\n') : '- none agreed yet'}`,
  ].join('\n');
}

/** How many of the user's decisions on a project, the latest, the model reads. */
const DECISIONS_READ = 40;

/** One of the user's own decisions on a project's work: what a lead asked them, and what they said. */
export interface UserDecision {
  at: number;
  goal?: string;
  asked: string;
  said: string;
}

/** Answers that say nothing of what the user wants: passing another's words on, an acknowledgement, a goal closed (short ones, "yes" or "continue", are left out by their length). */
const SAYS_NOTHING = /^(Sent the chief of staff|Acknowledged|Closed the goal)\b/i;

/** What a sort reads of a project besides its threads: its compass, goals under way and closed, what merged, and the user's decisions. */
export interface SortRecord {
  now: number;
  closed: readonly GoalRecord[];
  leads: readonly Pick<Agent, 'lead'>[];
  intents?: readonly IntentLine[];
  merged?: ReadonlySet<string>;
  decisions?: readonly UserDecision[];
}

/** Project `projectId`'s record from the ledger, as a sort on day `now` reads it, with its goals under way (`leads`). */
export function sortRecord(events: readonly LedgerEvent[], projectId: string, leads: readonly Pick<Agent, 'lead'>[], now: number): SortRecord {
  const mine = events.filter((e) => e.projectId === projectId);
  return {
    now,
    leads,
    closed: closedGoals(mine, projectId),
    intents: projectIntents([...mine], projectId),
    merged: new Set(mine.flatMap((e) => (e.kind === 'merged' ? [prKey(e.repo, e.pr)] : []))),
    decisions: mine
      .flatMap((e) => (e.kind === 'captain-decision' && e.answer.trim().length >= 12 && !SAYS_NOTHING.test(e.answer.trim()) ? [{ at: e.at, ...(e.goal && { goal: e.goal }), asked: e.item.what, said: e.answer }] : []))
      .slice(-DECISIONS_READ),
  };
}

const decisionLine = (d: UserDecision) => `- ${day(d.at)}${d.goal ? ` · “${d.goal}”` : ''} · asked: ${cut(d.asked, 160)} · said: ${cut(d.said.replace(/\s+/g, ' '), 300)}`;

/**
 * What the model's asked: the project's compass, its goals under way and closed (with their pull requests), the
 * user's latest decisions on it, then the threads to decide, each by an id of its own.
 */
export function sortPrompt(listed: readonly Thread[], record: SortRecord): string {
  const threads = listed.map((t, i) =>
    `t${i + 1} · from “${t.goalTitle}” (closed ${t.closedAt === undefined ? 'earlier' : day(t.closedAt)}) · ${t.idea ? 'idea for next' : `contact, noticed ${day(t.at)}`} · ${cut(t.text, 400)}`);
  const under = record.leads.flatMap(underWayLine);
  const merged = record.merged ?? new Set<string>();
  return [
    `Today is ${day(record.now)}.`,
    compassLines(record.intents ?? []),
    `Goals under way:\n${under.length ? under.join('\n') : '- none'}`,
    `Goals closed, the latest first:\n${record.closed.slice(0, GOALS_READ).map((g) => goalLine(g, merged)).join('\n') || '- none'}`,
    `The user’s latest decisions on this project, oldest first:\n${record.decisions?.length ? record.decisions.map(decisionLine).join('\n') : '- none'}`,
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
