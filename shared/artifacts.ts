import type { GoalArtifact } from './types';

/** The size a lead lays an artifact out for: the office takes its picture at it, and the close-up scales it to fit. */
export const ARTIFACT_SIZE = { w: 1280, h: 800 } as const;

/** Where a lead's artifact is served: its live page, or the picture of it the screen shows. */
export const artifactUrl = (leadId: string, artifact: GoalArtifact, kind: 'html' | 'jpg'): string =>
  `/api/artifacts/${leadId}/${artifact.id}.${kind}?v=${artifact.at}`;

/** What the screen shows of a lead's artifacts: the one shown last. */
export const latestArtifact = (artifacts: readonly GoalArtifact[] | undefined): GoalArtifact | undefined =>
  artifacts?.reduce<GoalArtifact | undefined>((latest, a) => (!latest || a.at > latest.at ? a : latest), undefined);
