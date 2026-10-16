import type { Agent, GoalArtifact, GoalQuestion } from './types';

/** The size a lead lays an artifact out for: the office takes its picture at it, and the close-up scales it to fit. */
export const ARTIFACT_SIZE = { w: 1280, h: 800 } as const;

/** Where a lead's artifact is served: its live page, or the picture of it the screen shows. */
export const artifactUrl = (leadId: string, artifact: GoalArtifact, kind: 'html' | 'jpg'): string =>
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

/** How the station screen's list sums up a settled question: the option picked, answered in chat, or never answered. */
export const answeredReadout = (question: GoalQuestion): string =>
  !question.answer ? 'NOT ANSWERED' : question.answer.option ? `PICKED ${question.answer.option.toUpperCase()}` : 'ANSWERED IN CHAT';

/** What the lead hears when the captain picks an option. */
export function answerMessage(question: GoalQuestion, option: string, note?: string): string {
  const picked = question.options.find((o) => o.id === option);
  const said = note?.trim() ? `\n\n${note.trim()}` : '';
  return `I picked ${option.toUpperCase()}, “${picked?.label ?? option}”, for your question “${question.question}”.${said}`;
}

/** Where the captain was in a briefing (an explainer) when they asked about it: its beat, counted from 0, and that beat's title. */
export interface BriefingSpot {
  beat: number;
  title: string;
}

/**
 * What the lead hears when the captain asks about one of their briefings, up close: which one, the beat they were on,
 * and that the answer is read out in the lead's voice as they write it, so it should be spoken, short and plain.
 */
export function briefingQuestion(briefing: Pick<GoalArtifact, 'id' | 'title'>, spot: BriefingSpot | undefined, question: string): string {
  const where = spot ? `, at beat ${spot.beat + 1}, “${spot.title}”` : '';
  return [
    `A question about your briefing “${briefing.title}” (\`${briefing.id}\`${where}): ${question.trim()}`,
    'I’m listening up close, and what you write back is read out to me in your voice as you write it. Answer in a few spoken sentences: plain words, no code, paths, tables or lists. If you need to look something up first, say so in a line before you do. If a picture would answer it better, answer aloud first, then explain it again under the same id.',
  ].join('\n\n');
}
