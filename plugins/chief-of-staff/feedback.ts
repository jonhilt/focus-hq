import type { FeedbackSignal, PluginHost, PluginState } from '../../plugin-api/server';
import { transcriptLines } from '../../plugin-api/server';
import { feedbackPressed, feedbackPressOf, feedbackStep, turnKey, verdictOn } from './feedbackRules';
import type { CosLive } from './shared';

// The user's one-tap word on a lead's turn (README.md#didnt-need-me-and-you-should-have-asked-me): the route a press
// comes to, from a decision card in Comms, the phone, or a lead's message in Talk. It checks the ids the browser sent
// against Focus (the lead aboard, the turn one of their session's), writes the `captain-feedback` line the press
// makes (feedbackRules.ts decides it: pressed, or taken back), and tells every browser what's pressed now, read
// from the ledger, so a reload or a restart shows the same.

export type FeedbackHost = Pick<PluginHost, 'agent' | 'transcript' | 'ledger' | 'record'>;

export class Feedback {
  constructor(
    private readonly host: FeedbackHost,
    private readonly live: PluginState<CosLive>,
  ) {
    // what was pressed before Focus stopped, to every browser (nothing to tell them when nothing is)
    const pressed = feedbackPressed(this.host.ledger());
    if (Object.keys(pressed).length) this.live.set({ feedback: pressed });
  }

  /** A press: its line written, and the turn's signals pressed now. A press that doesn't name a lead's turn is refused, saying why. */
  async press(body: unknown): Promise<{ pressed: FeedbackSignal[] }> {
    const press = feedbackPressOf(body);
    const agent = this.host.agent(press.agentId);
    const sessionId = agent?.task === 'lead' ? agent.sessionId : undefined;
    // a turn the chief of staff judged is known by its verdict; any other, by the lead's transcript having the line
    const known = !!sessionId && (verdictOn(this.host.ledger(), sessionId, press.turnUuid) !== undefined || (await this.inTranscript(sessionId, press.turnUuid)));
    // decided on the ledger as it is now, after the transcript's read: two presses at once are one after the other
    const lead = agent?.task === 'lead' ? { name: agent.name, goal: agent.lead?.title, sessionId } : undefined;
    const step = feedbackStep(press, lead, this.host.ledger(), known);
    if (step.kind === 'refuse') throw new Error(step.why);
    this.host.record(this.projectOf(press.agentId), step.line);
    const pressed = feedbackPressed(this.host.ledger());
    this.live.set({ feedback: pressed });
    return { pressed: pressed[turnKey(step.line.sessionId, step.line.turnUuid)] ?? [] };
  }

  private projectOf(agentId: string): string {
    return this.host.agent(agentId)?.projectId ?? '';
  }

  private async inTranscript(sessionId: string, uuid: string): Promise<boolean> {
    const jsonl = await this.host.transcript(sessionId);
    if (!jsonl) return false;
    for (const line of transcriptLines(jsonl)) if (line.uuid === uuid) return true;
    return false;
  }
}

