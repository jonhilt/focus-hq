// The director over live play (docs/studio.md): a scene's beats stepped through while the captain plays the goal
// themselves, rather than filmed by the recorder. Pure, so the browser's overlay (client/src/ui/liveDirector.ts) only
// draws what these decide.

import type { SceneBeat } from './studio';

/** Where the overlay is in the scene: which beat, and when its cue came (ms), once it has. */
export interface LiveBeat {
  index: number;
  cuedAt?: number;
}

/**
 * What the captain does in a beat the recorder would act out for them; and, whenever the lead `asks` permission (to
 * ship, say), which the recorder grants as it's asked, to grant it.
 */
export function captainsMove(beat: SceneBeat, asks = false): string | undefined {
  if (asks && !beat.do) return 'Approve what the lead asks for';
  switch (beat.do) {
    case 'start-goal':
      return 'Start the goal at a free team station';
    case 'answer':
      return 'Answer the lead’s question';
    case 'reply':
      return `Tell the lead: “${beat.say ?? ''}”`;
    default:
      return undefined;
  }
}

/**
 * The beat after a moment of play: a beat with a cue moves on by itself once the cue has come and its hold is up; one
 * without waits for the captain's key, since live play goes at the captain's pace, not the recording's.
 */
export function liveTick(beats: SceneBeat[], at: LiveBeat, cued: boolean, now: number): LiveBeat {
  const beat = beats[at.index];
  if (!beat?.until) return at;
  if (at.cuedAt === undefined) return cued ? { ...at, cuedAt: now } : at;
  if (now - at.cuedAt < beat.hold * 1000 || at.index >= beats.length - 1) return at;
  return { index: at.index + 1 };
}

/** The beat a key steps to: on (`+1`) or back (`-1`), within the scene. */
export function liveStep(beats: SceneBeat[], at: LiveBeat, by: 1 | -1): LiveBeat {
  const index = Math.max(0, Math.min(beats.length - 1, at.index + by));
  return index === at.index ? at : { index };
}

/** The overlay's status line: where it is, what it waits for, and the keys. */
export function liveStatus(beats: SceneBeat[], at: LiveBeat): string {
  const beat = beats[at.index];
  const waits = beat?.until ? (at.cuedAt === undefined ? ` · waits for ${beat.until.replace(/-/g, ' ')}` : ' · cue came') : '';
  return `Beat ${at.index + 1} of ${beats.length}${waits} · ] next · [ back · O hide`;
}
