// The captain's chart of what happens when a lead's turn ends, as a lead would send it to the statechart tool: the
// tests' example, citing Focus's own code under `dir`, and the page to look at when the house style changes.
import path from 'node:path';
import type { Statechart } from './statechart';

export function exampleChart(dir: string): Statechart {
  const at = (file: string, line: number) => ({ file: path.join(dir, file), line });
  return {
    title: "What happens to a lead's words when its turn ends",
    source: 'Read from the chief-of-staff plugin and the goal lead, as of 21 Oct.',
    nodes: [
      { id: 'end', text: "A lead's turn ends", kind: 'works' },
      { id: 'read', kind: 'branch' },
      { id: 'ready', text: 'Its words wait in Ready', kind: 'works' },
      { id: 'words', kind: 'branch' },
      { id: 'send', text: 'The lead carries on with them', kind: 'works' },
      { id: 'early', text: "They're sent before you've finished reading", kind: 'risk' },
      { id: 'card', text: 'A card waits for you', kind: 'works' },
      { id: 'first', kind: 'branch' },
      { id: 'answer', text: 'The lead carries on with your answer', kind: 'works' },
      { id: 'qa', text: 'The lead is woken and the card vanishes unread', kind: 'bug' },
      { id: 'qa-fix', text: 'The verdict waits on the card; the chief of staff re-reads it', kind: 'fix' },
      { id: 'qa-parked', text: 'The lead fixes QA; the card stays on your screen as Parked', kind: 'fix' },
      { id: 'landed', text: 'The lead is woken and the card vanishes unread', kind: 'bug' },
      { id: 'landed-fix', text: 'The news waits on the card until you answer', kind: 'fix' },
      { id: 'conflict', text: 'The lead is woken by a message that looks like yours; the card vanishes', kind: 'bug' },
      { id: 'conflict-fix', text: "It's sent as the Office and waits on the card", kind: 'fix' },
    ],
    edges: [
      { from: 'end', to: 'read', label: 'the chief of staff reads it' },
      { from: 'read', to: 'ready', label: 'carry on, or back to the lead' },
      { from: 'ready', to: 'words', label: 'what happens to the words?' },
      { from: 'words', to: 'send', label: 'you press send' },
      { from: 'words', to: 'early', label: "2 minutes pass while you're reading the turn" },
      { from: 'read', to: 'card', label: 'card or interrupt, or no verdict in 60 s' },
      { from: 'card', to: 'first', label: 'what reaches the lead first?' },
      { from: 'first', to: 'answer', label: 'your answer' },
      { from: 'first', to: 'qa', label: 'QA fails the PR' },
      { from: 'qa', to: 'qa-fix', label: 'with the fix' },
      { from: 'qa-fix', to: 'qa-parked', label: 'chief of staff says fix QA first' },
      { from: 'first', to: 'landed', label: 'the slice lands' },
      { from: 'landed', to: 'landed-fix', label: 'with the fix' },
      { from: 'first', to: 'conflict', label: 'a merge conflict' },
      { from: 'conflict', to: 'conflict-fix', label: 'with the fix' },
    ],
    actors: [
      { name: 'captain', kind: 'person' },
      { name: 'chief of staff', kind: 'staff' },
      { name: 'Ops', kind: 'system' },
    ],
    leftOut: 'a turn cut short by the usage limit, and goals the chief of staff is switched off for.',
    triggers: [
      { transition: 'Turn ends → read', actor: 'chief of staff', guard: 'Switched on for the project; a lead, not a crew member', where: [at('plugins/chief-of-staff/chief.ts', 37)] },
      { transition: 'Send the words', actor: 'captain', guard: 'The words are still in Ready', where: [at('plugins/chief-of-staff/chief.ts', 32), at('plugins/chief-of-staff/chief.ts', 9999)] },
    ],
    properties: {
      safety: [{ id: 'P1', text: 'Nothing reaches the lead in your name that you didn\'t send.', status: 'broken', note: 'a merge conflict does (R2)' }],
      liveness: [{ id: 'P2', text: 'Every card is answered or parked, never lost.', status: 'unchecked' }],
    },
    risks: [
      { id: 'R1', severity: 'hi', title: 'The card vanishes unread', path: 'QA fails the PR while the card waits; the lead is woken and the card goes before you see it.', where: [at('plugins/chief-of-staff/chief.ts', 37)] },
      { id: 'R2', severity: 'med', title: 'A message looks like yours', path: 'A merge conflict wakes the lead with a message in your name.', where: [at('plugins/chief-of-staff/turn.ts', 16)] },
    ],
    open: ['Should Ready wait for you however long you take to read?'],
    formal: 'No model check yet: the paths are read from the code.',
  };
}
