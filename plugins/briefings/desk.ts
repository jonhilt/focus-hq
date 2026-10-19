import path from 'node:path';
import type { PluginHost, ResumeHow } from '../../plugin-api/server';
import { type QuickAnswerer, quickAnswerNote, recentReplies, whoAnswers } from './quickAnswer';
import { type BriefingReply, type BriefingSpot, briefingQuestion } from './shared';

/** Who the lead hears the quick answer from. */
export const QUICK_ANSWERER = 'Quick answerer';

/**
 * Where the captain's questions about a lead's briefing go (`whoAnswers`): to the lead between turns, who answers
 * aloud as they write; while they're busy, to the quick answerer, whose answer comes straight back, and the lead hears
 * the question and the answer, to put it right. If the quick answerer can't answer, the question goes to the lead after all.
 */
export class BriefingDesk {
  constructor(
    private readonly host: Pick<PluginHost, 'agent' | 'artifact' | 'recentLines' | 'settings' | 'goals' | 'leadCheckouts'>,
    private readonly answerer: QuickAnswerer,
  ) {}

  async ask(leadId: string, ask: { briefing: string; spot?: BriefingSpot; question: string; how?: ResumeHow }): Promise<BriefingReply> {
    const agent = this.host.agent(leadId);
    const work = agent?.lead;
    if (!work) throw new Error('There’s no goal to ask about');
    const briefing = work.artifacts?.find((a) => a.id === ask.briefing);
    if (!briefing) throw new Error(`Nothing called ${ask.briefing} is on the screen`);
    const question = ask.question.trim();
    if (!question) throw new Error('Ask a question');
    const toLead = (): BriefingReply => {
      const sent = this.host.goals.message(leadId, briefingQuestion(briefing, ask.spot, question), { how: ask.how });
      return 'costly' in sent ? sent : { by: 'lead' };
    };
    // the lead's workspace, where their checkouts stand side by side: the quick answerer may read it
    const checkout = this.host.leadCheckouts(leadId)[0];
    if (!agent || whoAnswers(agent.status) === 'lead' || !checkout) return toLead();
    const page = await this.host.artifact(leadId, `${briefing.id}.html`);
    const html = page ? new TextDecoder().decode(page) : '';
    const answered = await this.answerer.answer({
      cwd: path.dirname(checkout.dir),
      leadName: agent.name,
      goal: work.title,
      note: work.note,
      briefing: { id: briefing.id, title: briefing.title, html },
      spot: ask.spot,
      question,
      recent: recentReplies([...this.host.recentLines(leadId, 200)]),
      settings: this.host.settings(),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => undefined);
    if (!answered) return toLead();
    this.host.goals.message(leadId, quickAnswerNote(briefing.title, ask.spot, question, answered.text), { from: QUICK_ANSWERER });
    return { by: 'quick', text: answered.text };
  }
}
