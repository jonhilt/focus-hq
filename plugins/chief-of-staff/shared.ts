// The chief of staff (README.md): what its server part and the browser share.
import type { CosRoute } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, and the switch in a project's settings. */
export const CHIEF_OF_STAFF = 'chief-of-staff';

/** A lead's last turn as the chief of staff judged it: what the browser shows once the captain has answered it. */
export interface LatestVerdict {
  route: CosRoute;
  /** Its own words on why, as it wrote them. */
  why: string;
  /** When the turn it judged ended. */
  endedAt: number;
}

/** The plugin's state in the browser: each goal lead's latest verdict, by agent id. Kept in memory only. */
export interface ChiefState {
  latest: Record<string, LatestVerdict>;
}

export const freshChief = (): ChiefState => ({ latest: {} });

/**
 * Whether a verdict is on the turn the captain answered: the lead's turn had ended (not a tool they raised a hand for
 * mid-turn), at `finishedAt`, set a moment after the turn hook the verdict was judged on. An older turn's verdict, or
 * none, says nothing.
 */
export const onTurn = (verdict: LatestVerdict | undefined, lead: { status: string; finishedAt?: number }): verdict is LatestVerdict =>
  verdict !== undefined && lead.status === 'done' && lead.finishedAt !== undefined && Math.abs(verdict.endedAt - lead.finishedAt) < 10_000;
