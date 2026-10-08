import type { Agent, GoalArtifact, GoalQuestion } from './types';

/** The size a lead lays an artifact out for: the office takes its picture at it, and the close-up scales it to fit. */
export const ARTIFACT_SIZE = { w: 1280, h: 800 } as const;

/** The size of the video the office records of an explainer, for a room's screen to loop. */
export const VIDEO_SIZE = { width: 1024, height: 640 } as const;

/** Where a lead's artifact is served: its live page, the picture of it the screen shows, or an explainer's video. */
export const artifactUrl = (leadId: string, artifact: GoalArtifact, kind: 'html' | 'jpg' | 'webm'): string =>
  `/api/artifacts/${leadId}/${artifact.id}.${kind}?v=${artifact.at}`;

/** What the screen shows of a lead's artifacts: the one shown last. */
export const latestArtifact = (artifacts: readonly GoalArtifact[] | undefined): GoalArtifact | undefined =>
  artifacts?.reduce<GoalArtifact | undefined>((latest, a) => (!latest || a.at > latest.at ? a : latest), undefined);

/** Where a question's option is served, like an artifact of its own. */
export const optionUrl = (leadId: string, question: GoalQuestion, option: string, kind: 'html' | 'jpg'): string =>
  `/api/artifacts/${leadId}/${question.id}.${option}.${kind}?v=${question.at}`;

/** The last of a goal's questions, while the captain hasn't answered it. */
export const unanswered = (questions: readonly GoalQuestion[] | undefined): GoalQuestion | undefined => {
  const last = questions?.at(-1);
  return last && !last.answer ? last : undefined;
};

/** The question the lead is waiting on the captain to answer, if there is one. */
export const openQuestion = (lead: Pick<Agent, 'lead'> | undefined): GoalQuestion | undefined => unanswered(lead?.lead?.questions);

/** What the lead hears when the captain picks an option. */
export function answerMessage(question: GoalQuestion, option: string, note?: string): string {
  const picked = question.options.find((o) => o.id === option);
  const said = note?.trim() ? `\n\n${note.trim()}` : '';
  return `I picked ${option.toUpperCase()}, “${picked?.label ?? option}”, for your question “${question.question}”.${said}`;
}
