import type { CrewSpeaker, CrewVoice, KokoroVoice } from './voice';
import { ACTIVE_STATUSES, type Agent, type Avatar, type Briefing, type Division, type Hairstyle, type Planner, type Rank, type Species } from './types';

// Who's aboard. Agents get a random look when they're hired. Permanent crew members, one of each per room (the
// operations officer at the New issue stand and the QA officer at the QA station), are derived from the project id
// rather than stored, so the same officer is at the same post on every reload and on every client. The ship's engineer
// is the one crew member who serves every room.

/** Each division's uniform colour, also used wherever the UI marks whose work something is. */
export const UNIFORM: Record<Division, string> = { command: '#d8433b', operations: '#e8b33c', sciences: '#3f8fd8' };
const DIVISIONS = Object.keys(UNIFORM) as Division[];

export const RANK_TITLE: Record<Rank, string> = { ensign: 'Ensign', lieutenant: 'Lt.' };

const SURNAMES = [
  'Okafor', 'Haddad', 'Varga', 'Lindqvist', 'Moreau', 'Tanaka', 'Oyelaran', 'Kowalczyk', 'Reyes', 'Castellanos',
  'Novak', 'Adeyemi', 'Sorensen', 'Petrakis', 'Nakamura', 'Quintero', 'Abara', 'Halloran', 'Ivanova', 'Mensah',
];

const HUMAN_SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
const HUMAN_HAIR = ['#2d1b0e', '#5a3825', '#e6be8a', '#b55239', '#1e1e1e', '#95a5a6', '#f6e58d'];
const LOOKS: Record<Species, { skin: string[]; hair: string[]; hairstyles: Hairstyle[] }> = {
  human: { skin: HUMAN_SKIN, hair: HUMAN_HAIR, hairstyles: ['crop', 'crop', 'bun', 'ponytail', 'curls', 'bald'] },
  vulcan: { skin: ['#f1c27d', '#e0ac69', '#c68642', '#ffe0bd'], hair: ['#1e1e1e', '#2d1b0e'], hairstyles: ['bowl'] },
  bajoran: { skin: HUMAN_SKIN, hair: HUMAN_HAIR, hairstyles: ['crop', 'bun', 'ponytail', 'curls'] },
  andorian: { skin: ['#8cc4ec', '#76b2e0', '#9fcdf0'], hair: ['#f4f6f8', '#dfe7f2'], hairstyles: ['crop', 'bun', 'ponytail'] },
  orion: { skin: ['#6cc070', '#58ad5e', '#7fcf7a'], hair: ['#1e1e1e', '#2d1b0e', '#b55239'], hairstyles: ['ponytail', 'curls', 'bun', 'crop'] },
  trill: { skin: HUMAN_SKIN, hair: HUMAN_HAIR, hairstyles: ['crop', 'bun', 'ponytail', 'curls'] },
};
/** Mostly humans, as aboard any Starfleet ship. */
const CREW_SPECIES: Species[] = ['human', 'human', 'human', 'human', 'vulcan', 'bajoran', 'andorian', 'orion', 'trill'];
const ACCESSORIES: Avatar['accessory'][] = ['none', 'none', 'none', 'glasses', 'implant'];

/** `roll` returns numbers in [0, 1), like Math.random. */
function rollAvatar(roll: () => number, division: Division, rank: Rank): Avatar {
  const pick = <T>(list: T[]) => list[Math.floor(roll() * list.length)];
  const species = pick(CREW_SPECIES);
  const looks = LOOKS[species];
  return { division, rank, species, skin: pick(looks.skin), hair: pick(looks.hair), hairstyle: pick(looks.hairstyles), accessory: pick(ACCESSORIES) };
}

/** A newly hired agent: an ensign from any division, fresh on the lower decks. */
export function randomAvatar(): Avatar {
  return rollAvatar(Math.random, DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)], 'ensign');
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: the same seed always rolls the same officer. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The operations officer at a room's ＋ New issue stand, who drafts issues for it. */
export function plannerFor(projectId: string): Planner {
  const h = hash(`planner:${projectId}`);
  const avatar = rollAvatar(seeded(h), 'operations', (h >>> 1) % 3 === 0 ? 'ensign' : 'lieutenant');
  return { name: `${RANK_TITLE[avatar.rank]} ${SURNAMES[h % SURNAMES.length]}`, avatar };
}

/** The QA officer at a room's QA station, beside the pull requests table, who reviews and tests every PR. Sciences: they run the diagnostics. */
export function qaOfficerFor(projectId: string): Planner {
  const h = hash(`qa:${projectId}`);
  const avatar = rollAvatar(seeded(h), 'sciences', (h >>> 1) % 3 === 0 ? 'ensign' : 'lieutenant');
  // never the same surname as the room's operations officer
  const taken = hash(`planner:${projectId}`) % SURNAMES.length;
  const surname = SURNAMES[(taken + 1 + ((h >>> 3) % (SURNAMES.length - 1))) % SURNAMES.length];
  return { name: `${RANK_TITLE[avatar.rank]} ${surname}`, avatar };
}

/**
 * The ship's engineer at the engineering station on the concourse: one for the whole ship, called to a briefing to read
 * the code and lay out options for a big change. Operations, like everyone who keeps the ship running.
 */
export function chiefEngineer(): Planner {
  const avatar = rollAvatar(seeded(hash('engineer')), 'operations', 'lieutenant');
  return { name: `${RANK_TITLE.lieutenant} Brennan`, avatar };
}

/**
 * Number One, the ship's first officer in the ready room: one for the whole ship, who talks anything through with the
 * captain, reading any project's code and the ship's live state. Command, like the captain.
 */
export function numberOne(): Planner {
  const avatar = rollAvatar(seeded(hash('number-one')), 'command', 'lieutenant');
  return { name: 'Cmdr. Adair', avatar };
}

/** Whether the engineer is at the lounge table: from the moment a briefing asks engineering until it's wrapped up. */
export function engineerAtBriefing(briefing: Pick<Briefing, 'status' | 'engineering'> | null): boolean {
  if (!briefing || briefing.status === 'done') return false;
  return briefing.status === 'engineering' || !!briefing.engineering;
}

/**
 * Whether the room's QA officer is at the lounge table rather than their QA station: for the length of a briefing
 * about their project, joining once any review they're in the middle of is done.
 */
export function qaAtBriefing(projectId: string, briefing: Pick<Briefing, 'projectId' | 'status'> | null, qaAgent: Pick<Agent, 'status'> | undefined): boolean {
  if (briefing?.projectId !== projectId || briefing.status === 'done') return false;
  return !qaAgent || !ACTIVE_STATUSES.includes(qaAgent.status);
}

/**
 * Each post's voices, none shared between the posts at a briefing, so the officer, QA and the engineer never sound
 * alike. Number One never sits in on one, so borrows a voice, at a pitch of their own.
 */
const VOICES: Record<CrewSpeaker, { kokoro: KokoroVoice[]; pitch: number }> = {
  officer: { kokoro: ['af_heart', 'am_michael', 'bf_emma', 'bm_george'], pitch: 1 },
  qa: { kokoro: ['af_bella', 'am_puck', 'bf_isabella', 'bm_fable'], pitch: 1.3 },
  engineer: { kokoro: ['am_fenrir'], pitch: 0.75 },
  'number-one': { kokoro: ['bm_george'], pitch: 0.9 },
};

/** The ship has one engineer and one Number One: the same voice whichever project they're talking about. */
const SHIPWIDE: CrewSpeaker[] = ['engineer', 'number-one'];

/** The voice a crew member speaks in at a briefing about the project: always the same one for the same person. */
export function crewVoice(speaker: CrewSpeaker, projectId: string): CrewVoice {
  const post = VOICES[speaker];
  const kokoro = post.kokoro[hash(`voice:${speaker}:${SHIPWIDE.includes(speaker) ? '' : projectId}`) % post.kokoro.length];
  return { kokoro, lang: kokoro.startsWith('b') ? 'en-GB' : 'en-US', pitch: post.pitch };
}
