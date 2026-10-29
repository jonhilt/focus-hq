import type { Agent, LedgerEvent, TermLine } from '../../plugin-api/shared';
import { projectIntents } from '../../plugin-api/shared';
import { clip } from '../../plugin-api/server';
import { messageEntries } from './thread';

// What the chief of staff reads a lead's turn against (README.md#what-it-reads-a-turn-against): what's agreed for the
// goal (the captain's first words, what done looks like), the project's compass, and the
// captain's own words to the lead. Without them it can't tell a step inside what's agreed from overreach: the backtest
// that gave it them (25 October 2026) kept a fifth fewer turns from the captain at the same share they engaged with,
// and its send-backs were the right ones. Pure, so it's tested (context.test.ts).

/** How many of the captain's latest messages to the lead it reads, and how much of each. */
export const CAPTAIN_WORDS = { count: 12, chars: 400 } as const;

/** How much of the captain's first words, and of what done looks like, it reads. */
const FIRST_WORDS = 1500;
const DONE = 800;

/** What it reads a turn against: each part empty when the goal has none. */
export interface TurnContext {
  goal: string;
  /** Who leads it: the judge names them in what it says to the captain. */
  lead?: string;
  /** The goal as the captain first put it. */
  firstWords?: string;
  /** What done looks like, from the lead's brief. */
  done?: string;
  /** What the project is for, and its guardrails. */
  project?: { what: string; guardrails: string[] };
  /** The project's intents, the outcomes its work is for. */
  intents: string[];
  /** The captain's latest messages to the lead, oldest first. */
  captainSaid: string[];
  /**
   * The lead's pull requests still open (`repo#n`, with its recap's title when it has one): the user's card shows each
   * with its merge button, so the judge makes no ask of merging one (crew/judge.md).
   */
  openPrs?: string[];
}

/**
 * The captain's own messages to a lead, oldest first, the latest `count` of them, each clipped: from the lead's log,
 * which keeps each message whole with who sent it (`messageEntries`). Their transcript doesn't: there, Ops' news waiting
 * for the lead is joined to the captain's next message, so their words were read as Ops' and lost. The first message,
 * the goal as they first put it (`firstWords`), is left out: the context has it already.
 */
export function captainWords(lines: readonly TermLine[], firstWords?: string, count: number = CAPTAIN_WORDS.count): string[] {
  return messageEntries(lines, firstWords).flatMap((e) => (e.kind === 'you' ? [clip(e.text, CAPTAIN_WORDS.chars)] : [])).slice(-count);
}

/** What a lead's turn is read against, from the lead, the ledger and the lead's log. */
type LeadPrs = { prs?: readonly { repo: string; number: number; outcome?: unknown; recap?: { title: string } }[] };

export function turnContext(lead: Pick<Agent, 'id' | 'projectId'> & { name?: string } & { lead?: { title: string; brief?: string; note?: { done: string } } & LeadPrs }, ledger: readonly LedgerEvent[], lines: readonly TermLine[]): TurnContext {
  const intents = projectIntents([...ledger], lead.projectId);
  const about = intents.find((e) => !e.id);
  const done = lead.lead?.note?.done?.trim();
  const openPrs = (lead.lead?.prs ?? []).filter((p) => !p.outcome).map((p) => `${p.repo}#${p.number}${p.recap?.title ? `: ${p.recap.title}` : ''}`);
  return {
    goal: lead.lead?.title || '(untitled)',
    ...(lead.name && { lead: lead.name }),
    ...(lead.lead?.brief?.trim() && { firstWords: clip(lead.lead.brief, FIRST_WORDS) }),
    ...(done && { done: clip(done, DONE) }),
    ...(about && { project: { what: about.what, guardrails: [...about.constraints] } }),
    intents: intents.filter((e) => e.id).map((e) => e.what),
    captainSaid: captainWords(lines, lead.lead?.brief),
    ...(openPrs.length && { openPrs }),
  };
}

const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join('\n');

/** The parts of a turn's context as the judge reads them, under headings, each left out when it's empty. */
export function contextText(c: TurnContext): string {
  const parts = [
    `GOAL: ${c.goal}`,
    c.lead && `THE LEAD: ${c.lead}`,
    c.firstWords && `The captain's first words:\n${c.firstWords}`,
    c.done && `What done looks like:\n${c.done}`,
    c.project && `THE PROJECT: ${c.project.what}${c.project.guardrails.length ? `\nGuardrails:\n${list(c.project.guardrails)}` : ''}`,
    c.intents.length && `The project's intents:\n${list(c.intents)}`,
    c.captainSaid.length && `THE CAPTAIN'S LATEST WORDS TO THE LEAD (oldest first):\n${list(c.captainSaid.map((s) => s.replace(/\s+/g, ' ')))}`,
    c.openPrs?.length && `THE LEAD'S OPEN PULL REQUESTS (the captain's card shows each with its merge button):\n${list(c.openPrs)}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}
