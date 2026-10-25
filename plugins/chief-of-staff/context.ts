import type { Agent, LedgerEvent } from '../../plugin-api/shared';
import { goalDecisions, projectIntents } from '../../plugin-api/shared';
import { blocks, clip, messageFrom, transcriptLines } from '../../plugin-api/server';

// What the chief of staff reads a lead's turn against (README.md#what-it-reads-a-turn-against): what's agreed for the
// goal (the captain's first words, what done looks like, the decisions on record), the project's compass, and the
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
  /** The goal as the captain first put it. */
  firstWords?: string;
  /** What done looks like, from the lead's brief. */
  done?: string;
  /** What the project is for, and its guardrails. */
  project?: { what: string; guardrails: string[] };
  /** The project's intents, the outcomes its work is for. */
  intents: string[];
  /** The goal's decisions: made (agreed), and open (not agreed yet). */
  decided: { question: string; chosen: string }[];
  open: { question: string; proposed?: string }[];
  /** The captain's latest messages to the lead, oldest first. */
  captainSaid: string[];
}

/**
 * The captain's own messages in a lead's transcript, oldest first, the latest `count` of them, each clipped: what Ops,
 * QA and the chief of staff sent (`messageFrom`) and the harness's reminders left out, and the first, which started the
 * goal (its first words).
 */
export function captainWords(jsonl: string, count: number = CAPTAIN_WORDS.count): string[] {
  const said: string[] = [];
  for (const line of transcriptLines(jsonl)) {
    if (line.type !== 'user' || line.isMeta) continue;
    const text = blocks(line).flatMap((b) => (b.type === 'text' && b.text?.trim() ? [b.text] : [])).join('\n');
    // the harness's reminders come as the captain's too: what's left once they're taken out is theirs
    const words = clip(text, CAPTAIN_WORDS.chars);
    if (words && messageFrom(text) === 'captain') said.push(words);
  }
  return said.slice(1).slice(-count);
}

/** What a lead's turn is read against, from the lead, the ledger and the lead's transcript. */
export function turnContext(lead: Pick<Agent, 'id' | 'projectId'> & { lead?: { title: string; brief?: string; note?: { done: string } } }, ledger: readonly LedgerEvent[], jsonl: string): TurnContext {
  const intents = projectIntents([...ledger], lead.projectId);
  const about = intents.find((e) => !e.id);
  const { open, decided } = goalDecisions([...ledger], lead.id);
  const done = lead.lead?.note?.done?.trim();
  return {
    goal: lead.lead?.title || '(untitled)',
    ...(lead.lead?.brief?.trim() && { firstWords: clip(lead.lead.brief, FIRST_WORDS) }),
    ...(done && { done: clip(done, DONE) }),
    ...(about && { project: { what: about.what, guardrails: [...about.constraints] } }),
    intents: intents.filter((e) => e.id).map((e) => e.what),
    decided: decided.flatMap((d) => (d.chosen ? [{ question: d.question, chosen: d.chosen }] : [])),
    open: open.map((d) => ({ question: d.question, ...(d.proposed && { proposed: d.proposed }) })),
    captainSaid: captainWords(jsonl),
  };
}

const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join('\n');

/** The parts of a turn's context as the judge reads them, under headings, each left out when it's empty. */
export function contextText(c: TurnContext): string {
  const parts = [
    `GOAL: ${c.goal}`,
    c.firstWords && `The captain's first words:\n${c.firstWords}`,
    c.done && `What done looks like:\n${c.done}`,
    c.project && `THE PROJECT: ${c.project.what}${c.project.guardrails.length ? `\nGuardrails:\n${list(c.project.guardrails)}` : ''}`,
    c.intents.length && `The project's intents:\n${list(c.intents)}`,
    c.decided.length && `DECIDED (agreed):\n${list(c.decided.map((d) => `${d.question} → ${d.chosen}`))}`,
    c.open.length && `OPEN DECISIONS (not agreed yet):\n${list(c.open.map((d) => `${d.question}${d.proposed ? ` (the lead proposes: ${d.proposed})` : ''}`))}`,
    c.captainSaid.length && `THE CAPTAIN'S LATEST WORDS TO THE LEAD (oldest first):\n${list(c.captainSaid.map((s) => s.replace(/\s+/g, ' ')))}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}
