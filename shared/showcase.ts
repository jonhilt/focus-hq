// The demo ship's showcase (docs/studio.md): a busy ship to film a walk round, rather than one scenario to play. Every
// team station in the Focus holodeck has a goal under way, each lead playing one thing over and over, so whichever
// station you walk up to is in the middle of it. Pure, shared by the training console, its reset and the demo runner.

/** What a showcase lead keeps doing. */
export type ShowcaseRole = 'subagents' | 'workflow' | 'briefing' | 'qa';

export interface ShowcaseRoom {
  /** Its team station, from 0. */
  station: number;
  role: ShowcaseRole;
  /** The goal its lead works on. */
  goal: string;
  /**
   * What its lead puts on the station's screen first, from scenes/showcase/: an explainer a real lead drew (`.json`, the
   * input its `explain` call took, from its transcript) or a page one showed (`.html`).
   */
  screen?: { file: string; title: string };
}

export const SHOWCASE = {
  label: 'Busy ship',
  blurb: 'Every team station in the Focus holodeck busy at once: subagents, a workflow on the pads, a briefing, and QA',
  project: 'Focus',
  color: '#f5b041',
  theme: 'office',
  repos: ['demo/focus'],
  rooms: [
    { station: 0, role: 'subagents', goal: 'Map where the office reads its agents’ transcripts, and what each reader needs', screen: { file: 'subagents-basics.json', title: 'How subagents work in Claude Code' } },
    { station: 1, role: 'workflow', goal: 'Review the transporter rooms against every kind of workflow before they ship', screen: { file: 'flow-hologram-mockup.html', title: 'The room, from where you beam in' } },
    { station: 2, role: 'briefing', goal: 'Show how a dynamic workflow runs, and what the transporter room shows of it', screen: { file: 'workflow-moving-parts.json', title: 'How a dynamic workflow runs' } },
    { station: 3, role: 'qa', goal: 'The captain’s log says why each goal closed' },
  ] satisfies ShowcaseRoom[],
} as const;

/** The showcase room a lead's first message starts, by its goal: none for any other goal. */
export function showcaseRoom(message: string): ShowcaseRoom | undefined {
  const text = message.trim();
  return SHOWCASE.rooms.find((room) => text.startsWith(room.goal));
}

/**
 * Whether a message that comes mid-turn ends a showcase lead's turn rather than going into it: the station that ships
 * keeps its turn to push follow-ups, so its slice landing (the captain merged it from the board) is the one thing that
 * stops it. The office keeps the message for the lead's next turn, which starts on the next slice's branch.
 */
export function endsShowcaseTurn(role: ShowcaseRole, message: string): boolean {
  return role === 'qa' && /\bSlice \d+ has landed\b/.test(message);
}
