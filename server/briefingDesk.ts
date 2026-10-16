import { type BriefingSpot, briefingQuestion } from '../shared/artifacts';
import type { BriefingReply, ResumeHow } from '../shared/types';
import type { AgentManager } from './agents/manager';
import { type QuickAnswerer, quickAnswerNote, recentReplies, whoAnswers } from './agents/quickAnswer';
import type { Store } from './store';

/** Who the lead hears the quick answer from. */
export const QUICK_ANSWERER = 'Quick answerer';

/**
 * Where the captain's questions about a lead's briefing go (`whoAnswers`): to the lead between turns, who answers
 * aloud as they write; while they're busy, to the quick answerer, whose answer comes straight back, and the lead hears
 * the question and the answer, to put it right. If the quick answerer can't answer, the question goes to the lead after all.
 */
export class BriefingDesk {
  constructor(
    private readonly store: Store,
    private readonly agents: () => AgentManager,
    private readonly answerer: QuickAnswerer,
    /** The lead's workspace, which the quick answerer may read. */
    private readonly workspace: (leadId: string) => string,
  ) {}

  async ask(leadId: string, ask: { briefing: string; spot?: BriefingSpot; question: string; how?: ResumeHow }): Promise<BriefingReply> {
    const agent = this.store.agent(leadId);
    const work = agent.lead;
    if (!work) throw new Error('There’s no goal to ask about');
    const briefing = work.artifacts?.find((a) => a.id === ask.briefing);
    if (!briefing) throw new Error(`Nothing called ${ask.briefing} is on the screen`);
    const question = ask.question.trim();
    if (!question) throw new Error('Ask a question');
    const toLead = (): BriefingReply => {
      const sent = this.agents().message(leadId, briefingQuestion(briefing, ask.spot, question), undefined, ask.how);
      return 'costly' in sent ? sent : { by: 'lead' };
    };
    if (whoAnswers(agent.status) === 'lead') return toLead();
    const html = (await this.store.readArtifact(leadId, `${briefing.id}.html`))?.toString('utf8') ?? '';
    const answered = await this.answerer.answer({
      cwd: this.workspace(leadId),
      leadName: agent.name,
      goal: work.title,
      note: work.note,
      briefing: { id: briefing.id, title: briefing.title, html },
      spot: ask.spot,
      question,
      recent: recentReplies(this.store.recentLines(leadId, 200)),
      settings: this.store.settings,
      signal: AbortSignal.timeout(90_000),
    }).catch(() => undefined);
    if (!answered) return toLead();
    this.agents().message(leadId, quickAnswerNote(briefing.title, ask.spot, question, answered.text), QUICK_ANSWERER);
    return { by: 'quick', text: answered.text };
  }
}
