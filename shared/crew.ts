import type { Avatar, Planner } from './types';

// Permanent crew members, one of each per room. They're derived from the project id rather than stored, so the same
// officer is at the same stand on every reload and on every client.

const SURNAMES = [
  'Okafor', 'Haddad', 'Varga', 'Lindqvist', 'Moreau', 'Tanaka', 'Oyelaran', 'Kowalczyk', 'Reyes', 'Castellanos',
  'Novak', 'Adeyemi', 'Sorensen', 'Petrakis', 'Nakamura', 'Quintero', 'Abara', 'Halloran', 'Ivanova', 'Mensah',
];
const HAIR = ['#2d1b0e', '#5a3825', '#e6be8a', '#b55239', '#1e1e1e', '#95a5a6', '#f6e58d'];
const SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
/** Operations wear gold. */
const OPS_GOLD = '#e8b33c';

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The operations officer at a room's ＋ New issue stand, who drafts issues for it. */
export function plannerFor(projectId: string): Planner {
  const h = hash(`planner:${projectId}`);
  const avatar: Avatar = {
    shirt: OPS_GOLD,
    hair: HAIR[(h >>> 5) % HAIR.length],
    skin: SKIN[(h >>> 9) % SKIN.length],
    accessory: (h >>> 13) % 3 === 0 ? 'glasses' : 'none',
  };
  return { name: `${(h >>> 1) % 3 === 0 ? 'Ensign' : 'Lt.'} ${SURNAMES[h % SURNAMES.length]}`, avatar };
}
