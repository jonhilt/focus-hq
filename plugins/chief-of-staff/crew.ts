import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CrewRole, crewFolder } from '../../plugin-api/server';

// The chief of staff's crew files (crew/, as .focus/crew/README.md describes them): what the judge and the lane judge
// are told, and what each may refer to. Each one's version is a digest of its words, so verdicts from different
// prompts are never compared as one, and nobody has to remember to bump it.

const ROLES = {
  /** Where a lead's turn goes: `judgeSystemPrompt` (judge.ts). */
  judge: {
    vars: { orders: 'text', maxReplies: 'text', maxReplyLabel: 'text', pinned: 'flag', route: 'text', routeName: 'text' },
    texts: ['noOrders', 'route.1', 'route.2', 'route.3', 'route.4'],
    textVars: {},
  },
  /** Whether to raise a ship's lane: `laneSystemPrompt` (laneJudge.ts). */
  lane: { vars: { orders: 'text' }, texts: ['noOrders'], textVars: {} },
} as const satisfies Record<string, CrewRole>;

export const CREW = crewFolder(path.join(path.dirname(fileURLToPath(import.meta.url)), 'crew'), ROLES);

/** The role's prompt's version, kept on what it decides: its file's digest, so a change to its words is a new one. */
export const crewVersion = (role: keyof typeof ROLES): string => `${role}-${CREW.file(role).digest}`;
