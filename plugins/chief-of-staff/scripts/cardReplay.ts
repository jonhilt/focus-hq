// Card replay: the life of every card the captain was owed, replayed from Focus's own history (the ledger, each
// goal lead's run journal, state.json), and how each ended: the captain answered, the chief of staff's words went, or
// something else woke the lead first and wiped a card nobody had answered. The rules are in
// cardReplay.ts and cardReport.ts; this reads the files and prints. Read-only, free: no model is called.
//
//   pnpm run card-replay                    every card, summed up, and the ones the captain needed that were wiped
//   pnpm run card-replay --since 3          cards opened in the last 3 days
//   pnpm run card-replay --project <id>     one project's
//   pnpm run card-replay --json <file>      every card's timeline, written to <file>

import { writeFileSync } from 'node:fs';
import { focusLedger, focusRunJournals, focusSavedState, type LedgerEvent } from '../../../plugin-api/server';
import { leadNames, missedLines, summaryLines } from '../cardReport';
import { type Card, type DecisionFact, itemAgent, type LeadInfo, leadCards, type MergeFact, type VerdictFact } from '../cardReplay';

const args = process.argv.slice(2);
/** A flag's value: undefined without the flag, and an error with the flag but no value after it. */
function after(flag: string): string | undefined {
  if (!args.includes(flag)) return undefined;
  const value = args[args.indexOf(flag) + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}
const project = after('--project');
const json = after('--json');
const sinceArg = after('--since');
const sinceDays = sinceArg === undefined ? undefined : Number(sinceArg);
if (sinceDays !== undefined && !(sinceDays > 0)) throw new Error(`--since takes a number of days, not "${sinceArg}"`);
const since = sinceDays ? Date.now() - sinceDays * 86_400_000 : 0;

const ledger: readonly LedgerEvent[] = focusLedger().events ?? [];

const verdicts: VerdictFact[] = ledger.flatMap((e) => (e.kind === 'cos-verdict' ? [{ sessionId: e.sessionId, route: e.route, why: e.why, ...(e.message && { message: e.message }), at: e.at }] : []));

const merges: MergeFact[] = ledger.flatMap((e) => (e.kind === 'merged' ? [{ repo: e.repo, pr: e.pr, by: e.by }] : []));

/** The captain's inbox answers for each agent, by the agent id in the item's id (by name where it has none). */
function decisionsFor(id: string, name: string | undefined): DecisionFact[] {
  return ledger.flatMap((e) => {
    if (e.kind !== 'captain-decision') return [];
    const agent = itemAgent(e.item.id);
    return (agent ? agent === id : e.agent === name) ? [{ kind: e.item.kind, answer: e.answer, via: e.via, at: e.at }] : [];
  });
}

function allCards(): Card[] {
  const names = leadNames(ledger, focusSavedState());
  return focusRunJournals((id) => id.startsWith('lead_')).flatMap(({ agentId: id, entries }) => {
    const lead: LeadInfo = { id, projectId: /^lead_(proj_[^_]+)_/.exec(id)?.[1] ?? '?', ...names.get(id) };
    if (project && lead.projectId !== project) return [];
    return leadCards(lead, entries, { verdicts, decisions: decisionsFor(id, lead.name), merges }).filter((c) => c.openedAt >= since);
  }).sort((a, b) => a.openedAt - b.openedAt);
}

const cards = allCards();
for (const line of [...summaryLines(cards, { project, since }), ...missedLines(cards)]) console.log(line);
if (json) {
  writeFileSync(json, `${JSON.stringify(cards, null, 2)}\n`);
  console.log(`\nWrote ${cards.length} cards to ${json}`);
}
