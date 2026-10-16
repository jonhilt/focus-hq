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
}

export const SHOWCASE = {
  label: 'Busy ship',
  blurb: 'Every team station in the Focus holodeck busy at once: subagents, a workflow on the pads, a briefing, and QA',
  project: 'Focus',
  color: '#f5b041',
  theme: 'office',
  repos: ['demo/focus'],
  rooms: [
    { station: 0, role: 'subagents', goal: 'Map where the office reads its agents’ transcripts, and what each reader needs' },
    { station: 1, role: 'workflow', goal: 'Review the transporter rooms against every kind of workflow before they ship' },
    { station: 2, role: 'briefing', goal: 'Show how a dynamic workflow runs, and what the transporter room shows of it' },
    { station: 3, role: 'qa', goal: 'The captain’s log says why each goal closed' },
  ] satisfies ShowcaseRoom[],
} as const;

/** The showcase room a lead's first message starts, by its goal: none for any other goal. */
export function showcaseRoom(message: string): ShowcaseRoom | undefined {
  const text = message.trim();
  return SHOWCASE.rooms.find((room) => text.startsWith(room.goal));
}
