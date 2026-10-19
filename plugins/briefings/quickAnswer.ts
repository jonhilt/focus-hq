import type { AgentStatus, GoalNote, Settings, TermLine } from '../../plugin-api/shared';
import { CODE_TOOLS, demoPace, isRecord, type PluginHost, repliesToSpeak, sleep } from '../../plugin-api/server';
import type { BriefingSpot } from './shared';

// A question the captain asks about a lead's briefing while the lead's busy goes to a quick answerer instead: a light
// model that reads the briefing, the lead's note, what they've said lately and their code, and answers in seconds. The
// lead hears the question and the answer, to put it right if it's wrong.

/**
 * Who answers a question about a lead's briefing: the lead, when they're between turns (or stopped, so the question
 * picks their session back up), or the quick answerer while they're in the middle of something, when the question
 * would wait behind their work.
 */
export function whoAnswers(status: AgentStatus): 'lead' | 'quick' {
  switch (status) {
    case 'done':
    case 'error':
    case 'stopped':
      return 'lead';
    default:
      return 'quick';
  }
}

export interface BriefingBeat {
  title: string;
  text: string;
  say: string;
}

/** An explainer's beats, read from its page (the player's `KIT_BEATS`); undefined for a page that isn't an explainer. */
export function briefingBeats(html: string): BriefingBeat[] | undefined {
  const json = /window\.KIT_BEATS = (\[.*?\]); window\.KIT_DUR/s.exec(html)?.[1];
  if (!json) return undefined;
  try {
    const beats: unknown = JSON.parse(json);
    if (!Array.isArray(beats)) return undefined;
    const said = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
    return beats.map((b) => (isRecord(b) ? { title: said(b.title), text: said(b.text), say: said(b.say) } : { title: '', text: '', say: '' }));
  } catch {
    return undefined;
  }
}

/** Most of a page this long is plenty to answer from; more only slows the answer. */
const PAGE_CHARS = 6000;

/** A shown page that isn't an explainer, as the words on it: no scripts, styles or tags. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PAGE_CHARS);
}

/** The last few things the lead said, as plain sentences, the latest last. */
export function recentReplies(lines: TermLine[], count = 8): string[] {
  return repliesToSpeak(lines).slice(-count);
}

export interface QuickQuestion {
  /** The lead's workspace, which the answerer may read. */
  cwd: string;
  leadName: string;
  goal: string;
  note?: GoalNote;
  briefing: { id: string; title: string; html: string };
  spot?: BriefingSpot;
  question: string;
  recent: string[];
  settings: Settings;
  signal: AbortSignal;
}

export interface QuickAnswerer {
  answer(req: QuickQuestion): Promise<{ text: string; costUsd?: number }>;
}

/** The quick answerer's model: the fastest, as the captain is waiting to hear it. */
export const QUICK_MODEL = 'claude-haiku-4-5-20251001';

export const QUICK_SYSTEM = [
  'You answer the captain’s questions about a briefing a goal lead made, while the lead is busy working. The captain is listening: your answer is read aloud.',
  'Answer in two to four spoken sentences: plain words, no code, file paths, Markdown, tables or lists. Answer what was asked, about the part of the briefing they were on.',
  'Base it on the briefing, the lead’s note and what the lead has said. If you need the code to be sure, read it (you have Read, Glob and Grep on the lead’s workspace), but only a file or two: speed matters more than thoroughness.',
  'If you can’t tell from what you have, say so plainly, and that the lead will pick it up. Never guess at what the code does.',
].join('\n');

/** What the quick answerer is asked: the briefing beat by beat (the one the captain's on marked), the goal, and the question. */
export function quickAnswerPrompt(q: Pick<QuickQuestion, 'leadName' | 'goal' | 'note' | 'briefing' | 'spot' | 'question' | 'recent'>): string {
  const beats = briefingBeats(q.briefing.html);
  const shown = beats
    ? beats.map((b, i) => `${i === q.spot?.beat ? '▶ ' : ''}Beat ${i + 1}, “${b.title}”: ${b.text}${b.say && b.say !== b.text ? ` (narration: ${b.say})` : ''}`).join('\n')
    : pageText(q.briefing.html);
  const note = q.note;
  return [
    `The goal: ${q.goal}. Its lead is ${q.leadName}.`,
    note?.done ? `What done looks like: ${note.done}` : '',
    note?.learned?.length ? `What the lead has learned:\n${note.learned.map((l) => `- ${l}`).join('\n')}` : '',
    `The briefing, “${q.briefing.title}”${beats ? ', beat by beat' : ''}:\n${shown}`,
    q.recent.length ? `What ${q.leadName} said lately, the latest last:\n${q.recent.map((r) => `- ${r}`).join('\n')}` : '',
    `The captain${q.spot ? ` is on beat ${q.spot.beat + 1}, “${q.spot.title}”, and` : ''} asks: ${q.question.trim()}`,
  ].filter(Boolean).join('\n\n');
}

/** What the lead hears after the quick answerer has answered for them: the question, its answer, and that they may correct it. */
export function quickAnswerNote(briefingTitle: string, spot: BriefingSpot | undefined, question: string, answer: string): string {
  const where = spot ? ` (beat ${spot.beat + 1}, “${spot.title}”)` : '';
  return [
    `While you were busy, the captain asked about your briefing “${briefingTitle}”${where}: ${question.trim()}`,
    `The quick answerer answered for you: ${answer.trim()}`,
    'No need to reply if that’s right. If it’s wrong or misses something that matters, tell the captain in a sentence or two when you next can.',
  ].join('\n\n');
}

/**
 * Answers the captain's question about a busy lead's briefing in seconds: Haiku, with the briefing, the lead's note
 * and what they've said in the prompt, reading the lead's workspace only if it must.
 */
export class ClaudeQuickAnswerer implements QuickAnswerer {
  constructor(private readonly host: Pick<PluginHost, 'readOnlySession'>) {}

  async answer(req: QuickQuestion): Promise<{ text: string; costUsd?: number }> {
    const result = await this.host.readOnlySession({
      cwd: req.cwd,
      systemAppend: QUICK_SYSTEM,
      prompt: quickAnswerPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity: () => undefined,
      builtins: CODE_TOOLS,
      model: QUICK_MODEL,
      maxTurns: 6,
      timeoutMs: 60_000,
    });
    if (!result.text.trim()) throw new Error('The quick answerer had nothing to say');
    return { text: result.text.trim(), costUsd: result.costUsd };
  }
}

/** Demo mode: the quick answerer, answering about the beat the captain's on in a second or so, as Haiku would. */
export class DemoQuickAnswerer implements QuickAnswerer {
  async answer(req: QuickQuestion): Promise<{ text: string }> {
    await sleep((800 + Math.random() * 600) / demoPace());
    const beat = req.spot ? briefingBeats(req.briefing.html)?.[req.spot.beat] : undefined;
    const about = beat ? `On “${beat.title}”: ${beat.text}` : `From “${req.briefing.title}”, as far as I can tell:`;
    return { text: `${about} ${req.leadName} is busy building the slice, so I've answered for now, and passed your question on in case there's more to it.` };
  }
}
