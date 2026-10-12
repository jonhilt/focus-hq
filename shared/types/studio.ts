/**
 * A video a goal is making, as the lead and captain think it through standing in the studio: a holodeck it takes over
 * (docs/studio.md). The lead keeps it with its studio tool; the holodeck shows it, the premise first.
 */
export interface Studio {
  /** The video's basic idea, in a sentence or two. */
  premise: string;
  /** What the viewer should come away with. */
  takeaway?: string;
  /** The video's beats, in order: each a point it makes. */
  beats: StudioBeat[];
  /** What we still need to find out to make it, open and closed, oldest first. */
  gaps: StudioGap[];
  /** When the lead last changed it: the newest studio has the holodeck. */
  at: number;
}

export interface StudioBeat {
  title: string;
  /** What it gets across, in a line. */
  point?: string;
}

/** A gap in what we know that the video needs filled: open until it's answered (by research, or the captain) or dropped. */
export interface StudioGap {
  /** g1, g2, …: unique within the studio. */
  id: string;
  text: string;
  at: number;
  /** Missing while it's open. */
  closed?: { as: 'answered' | 'dropped'; answer?: string; at: number };
}
