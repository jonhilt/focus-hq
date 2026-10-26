import { Effect, Option } from 'effect';
import type { Agent, MessageReply, ResumeHow } from '../../../shared/types';
import { answerMessage, openQuestion } from '../../../shared/artifacts';
import { askProblem, goalDecisions, type RaiseInput, raiseDecision, settleDecision } from '../../../shared/decisions';
import { answerInChat, pageErrorsNote } from '../lead';
import { answerQuestion, type ArtifactInput, askQuestion, type QuestionInput, showArtifact } from '../leadRules';
import { BRIEF_FILE, briefedGoal, briefForPrompt, briefMovedNote, decisionLines, needsBrief } from '../briefFile';
import { type Frame, type Frames, type Picture, Renderer, Workspace } from '../services';
import { type Answers, type AskedQuestion, optionPage } from '../questions';
import { Part, Refused } from './core';

/** The lead's `office` MCP tools besides recap: show, ask (and the captain's answer), propose_close and decision. */
export class GoalTools extends Part {
  /**
   * Reads the lead's brief, ./brief.md in their workspace, and takes what it says onto the goal (`briefedGoal`): as an
   * edit of it finishes, and as each of their turns starts and ends. A brief that isn't there (not written yet, or a
   * reopened goal's, gone with its old workspace) leaves the goal as it was; a cloud lead's isn't here to read.
   */
  readBrief(leadId: string): Effect.Effect<void, never, Workspace> {
    return Effect.gen({ self: this }, function* () {
      const before = this.store.agents.get(leadId);
      if (!before?.lead || before.cloud) return;
      const workspace = yield* Workspace;
      const text = yield* workspace.readIn(workspace.dir(leadId), BRIEF_FILE);
      const lead = this.store.agents.get(leadId);
      if (text === undefined || !lead?.lead) return;
      const work = briefedGoal(lead.lead, text, Date.now());
      if (work !== lead.lead) this.update(lead, { lead: work, issue: { ...lead.issue, title: work.title } });
    });
  }

  /**
   * What a lead from before brief.md hears as their next turn starts, once: write the brief from the note they kept
   * (`briefMovedNote`). Nothing for any other lead.
   */
  briefMoved(leadId: string): string | undefined {
    const lead = this.store.agents.get(leadId);
    if (!lead?.lead || lead.cloud || !needsBrief(lead.lead)) return undefined;
    this.update(lead, { lead: { ...lead.lead, briefAsked: true } });
    return briefMovedNote(lead.lead);
  }

  /** What the lead hears once their conversation's compacted: the goal, their brief and its decisions (`briefForPrompt`). */
  afterCompact(leadId: string): string {
    const work = this.store.agents.get(leadId)?.lead;
    return work ? briefForPrompt(work, decisionLines(goalDecisions(this.store.ledger, leadId))) : '';
  }

  /**
   * The lead's show tool: the page goes on the goal, with a picture of it for the station's screen. A page Ops
   * can't take a picture of still goes up: the captain can open it, though the screen only shows its title.
   */
  showArtifact(agent: Agent, input: ArtifactInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.map(this.showPage(agent, input), (shown) => shown.text);
  }

  /**
   * show's work, with the pictures it took: `frames` asks for the page at those moments too, and what it saw in each
   * (the briefings plugin's explainer, its stage at each beat). For a plugin's lead tool, `LeadToolContext.showFrames`.
   */
  showFrames(agent: Agent, input: ArtifactInput, frames: Frames): Effect.Effect<{ text: string; frames: Frame[] }, Refused, Renderer> {
    return Effect.map(this.showPage(agent, input, frames), (shown) => ({ text: shown.text, frames: shown.picture?.frames ?? [] }));
  }

  /**
   * The pictures showFrames takes, and what the page saw in each, with the page kept off the screen (a plugin's draft,
   * checked before it goes up: `LeadToolContext.takeFrames`). None when Ops couldn't take them.
   */
  takeFrames(html: string, frames: Frames): Effect.Effect<Frame[], never, Renderer> {
    return Effect.gen(function* () {
      const picture = Option.getOrUndefined(yield* (yield* Renderer).render(html, frames).pipe(Effect.option));
      return picture?.frames ?? [];
    });
  }

  /** show's work, with the picture it took (and the page at each of `frames`). */
  private showPage(agent: Agent, input: ArtifactInput, frames?: Frames): Effect.Effect<{ text: string; picture?: Picture }, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.lead) return yield* new Refused({ message: 'There’s no goal to show it on' });
      const checked = showArtifact(agent.lead.artifacts ?? [], input, Date.now());
      if ('error' in checked) return yield* new Refused({ message: checked.error });
      this.store.saveArtifact(agent.id, `${input.id}.html`, Buffer.from(input.html));
      const picture = yield* (yield* Renderer).render(input.html, frames).pipe(
        Effect.map((taken) => ({ bytes: taken.image, errors: taken.errors, taken })),
        Effect.catch((err) => Effect.succeed({ failed: err.message })),
      );
      // taking the picture takes a moment: the goal may have closed (its lead gone home, what it showed filed with it),
      // or the lead shown something else, meanwhile
      const work = this.store.agents.has(agent.id) ? agent.lead : undefined;
      if (!work) return { text: 'The goal closed before it went up.' };
      const next = showArtifact(work.artifacts ?? [], input, Date.now());
      if ('error' in next) return yield* new Refused({ message: next.error });
      if ('bytes' in picture) this.store.saveArtifact(agent.id, `${input.id}.jpg`, picture.bytes);
      else this.store.deleteArtifact(agent.id, `${input.id}.jpg`);
      // each goes on the waypoint of the slice it was last shown in, as evidence of what it set out to do
      this.update(agent, { lead: { ...work, artifacts: next.map((a) => (a.id === input.id ? { ...a, slice: work.slice, ...('bytes' in picture && { image: true }) } : a)) } });
      const where = `“${next.find((a) => a.id === input.id)?.title ?? input.title}” is on your station's screen; the captain can open it up close.`;
      return 'bytes' in picture
        ? { text: `${where}${pageErrorsNote(picture.errors)}`, picture: picture.taken }
        : { text: `${where} Ops couldn't take a picture of it for the screen (${picture.failed}), so the screen shows only its title.` };
    });
  }

  /**
   * The lead's ask tool: the question goes on the station's screen, each option a page with a picture of its own, in
   * place of one still open. The captain's pick comes back to the lead as a message from them (`answer`).
   */
  askCaptain(agent: Agent, input: QuestionInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.lead) return yield* new Refused({ message: 'There’s no goal to ask about' });
      const undecidable = input.decision && askProblem(this.store.ledger, agent.id, input.decision, input.options.map((o) => o.label));
      if (undecidable) return yield* new Refused({ message: undecidable });
      const checked = askQuestion(agent.lead.questions ?? [], input, Date.now());
      if ('error' in checked) return yield* new Refused({ message: checked.error });
      // the pictures first, in memory: the question's id, and which files are whose, are settled once they're taken
      const renderer = yield* Renderer;
      const pictures: (Buffer | undefined)[] = [];
      for (const option of input.options) pictures.push(Option.getOrUndefined(yield* renderer.render(option.html).pipe(Effect.map((p) => p.image), Effect.option)));
      // taking them takes a moment: the goal may have closed (its lead gone home, its questions filed with it, pages
      // and all), or the lead asked again, meanwhile
      const work = this.store.agents.has(agent.id) ? agent.lead : undefined;
      if (!work) return 'The goal closed before the question went up.';
      const next = askQuestion(work.questions ?? [], input, Date.now());
      if ('error' in next) return yield* new Refused({ message: next.error });
      const { asked } = next;
      for (const q of next.dropped) for (const o of q.options) for (const ext of ['html', 'jpg']) this.store.deleteArtifact(agent.id, `${q.id}.${o.id}.${ext}`);
      for (const [i, option] of asked.options.entries()) {
        this.store.saveArtifact(agent.id, `${asked.id}.${option.id}.html`, Buffer.from(input.options[i].html));
        const picture = pictures[i];
        if (picture) this.store.saveArtifact(agent.id, `${asked.id}.${option.id}.jpg`, picture);
      }
      const questions = next.questions.map((q) => (q.id === asked.id ? { ...q, slice: work.slice, options: q.options.map((o, i) => (pictures[i] ? { ...o, image: true } : o)) } : q));
      this.update(agent, { lead: { ...work, questions } });
      this.print(agent, [{ kind: 'manager', text: `❓ Asked the captain: ${asked.question} (${asked.options.map((o) => `${o.id.toUpperCase()}: ${o.label}`).join(' · ')})` }]);
      const missing = pictures.filter((p) => !p).length;
      return `Your question is on your station's screen with its ${asked.options.length} options${missing ? ` (Ops couldn't take a picture of ${missing} of them, so the screen shows just their labels)` : ''}. The captain's pick comes back to you as a message from them: end your turn here and wait for it.`;
    });
  }

  /**
   * A lead's questions asked with Claude Code's AskUserQuestion: each goes on their station's screen in turn, as one asked
   * with the ask tool (an option's preview its page, or else what it says), and the captain's pick, or what they write
   * meanwhile, comes back as the tool's result, into the same turn (`answer`, `captainMessage`). Undefined when the turn
   * ends first: the question comes down (`withdraw`).
   */
  async askFromTool(agent: Agent, input: { questions: AskedQuestion[] }, signal: AbortSignal): Promise<Answers | undefined> {
    const answers: Answers = {};
    for (const q of input.questions) {
      const options = q.options.map((o) => ({ label: o.label, detail: o.description, html: o.preview ?? optionPage(o) }));
      const shown = await this.runtime.runPromise(this.askCaptain(agent, { question: q.question, ...(q.header && { context: q.header }), options }).pipe(Effect.as(true), Effect.orElseSucceed(() => false)));
      const asked = shown ? openQuestion(this.store.agents.get(agent.id)) : undefined;
      if (!asked) return undefined;
      // the turn waits on this one: it comes down if the turn ends first
      const work = this.store.agent(agent.id).lead;
      if (work) this.update(agent, { lead: { ...work, questions: (work.questions ?? []).map((x) => (x.id === asked.id ? { ...x, via: 'question-tool' as const } : x)) } });
      if (signal.aborted) {
        this.withdraw(agent.id, asked.id);
        return undefined;
      }
      const answer = await this.answerOf(agent, asked.id, q.question, signal);
      if (answer === undefined) return undefined;
      answers[q.question] = answer;
    }
    return answers;
  }

  /** Takes a question asked with Claude Code's question tool down, pages and all, now nothing waits on its answer. */
  private withdraw(leadId: string, questionId: string): void {
    const agent = this.store.agents.get(leadId);
    const work = agent?.lead;
    const question = work?.questions?.find((q) => q.id === questionId && !q.answer);
    if (!agent || !work || !question) return;
    for (const o of question.options) for (const ext of ['html', 'jpg']) this.store.deleteArtifact(leadId, `${question.id}.${o.id}.${ext}`);
    this.update(agent, { lead: { ...work, questions: (work.questions ?? []).filter((q) => q.id !== questionId) } });
    this.print(agent, [{ kind: 'system', text: `✻ Took down “${question.question}”: the turn that asked it ended unanswered` }]);
  }

  /** After a restart: nothing waits on a question asked with Claude Code's question tool any more, so each comes down. */
  recover(): void {
    for (const agent of this.store.agents.values()) {
      for (const q of agent.lead?.questions ?? []) if (q.via === 'question-tool' && !q.answer) this.withdraw(agent.id, q.id);
    }
  }

  /** The captain's answer to the lead's open question `questionId`, as their session waits on it; undefined if the turn ends first. */
  private answerOf(agent: Agent, questionId: string, question: string, signal: AbortSignal): Promise<string | undefined> {
    const rt = this.rt(agent.id);
    return new Promise((resolve) => {
      rt.asking = { questionId, resolve };
      this.update(agent, { activity: `Asking you: ${question.slice(0, 60)}` });
      signal.addEventListener('abort', () => {
        if (rt.asking?.questionId !== questionId) return;
        rt.asking = undefined;
        this.withdraw(agent.id, questionId);
        resolve(undefined);
      });
    });
  }

  /**
   * The captain picks an option of the lead's open question: it's marked answered, and the lead hears which. Unless
   * hearing it would cost enough on your API key to ask the captain first (`how` is their answer): then nothing changes.
   */
  answer(id: string, questionId: string, option: string, note?: string, how?: ResumeHow): Agent | MessageReply {
    const agent = this.store.agent(id);
    const work = agent.lead;
    if (!work) throw new Error(`${agent.name} isn’t leading a goal`);
    const answered = answerQuestion(work.questions ?? [], questionId, option, note, Date.now());
    if ('error' in answered) throw new Error(answered.error);
    // their session waits on it (they asked with Claude Code's question tool): the answer goes back into that turn
    const rt = this.rt(id);
    if (rt.asking?.questionId === questionId) {
      const { resolve } = rt.asking;
      rt.asking = undefined;
      this.update(agent, { activity: 'Reading your answer', lead: { ...work, questions: answered.questions } });
      if (answered.question.decision) this.decide(agent, answered.question.decision, answered.question.options.find((o) => o.id === option)?.label ?? option, note);
      resolve([answered.question.options.find((o) => o.id === option)?.label ?? option, note?.trim()].filter(Boolean).join(': '));
      return agent;
    }
    const reply = this.core.comms.message(id, answerMessage(answered.question, option, note), undefined, how);
    if ('costly' in reply) return reply;
    // read again: sending it may have changed the goal (a proposal to close dropped)
    if (agent.lead) this.update(agent, { lead: { ...agent.lead, questions: answered.questions } });
    if (answered.question.decision) this.decide(agent, answered.question.decision, answered.question.options.find((o) => o.id === option)?.label ?? option, note);
    return agent;
  }

  /** The captain's pick on a question that asked them to make a decision: it's decided, as they picked. */
  private decide(agent: Agent, id: string, chosen: string, note?: string): void {
    const settled = settleDecision(this.store.ledger, id, 'captain', chosen, note);
    if ('problem' in settled) console.warn(`[decisions] ${agent.name}’s ${id} wasn’t decided: ${settled.problem}`);
    else this.core.ledger.record(agent.projectId, settled.entry);
  }

  /**
   * The lead's decision tool: a decision raised on their goal, or one of its open ones changed, for the captain (or
   * the chief of staff where the captain lets it) to decide. The lead never decides one.
   */
  raiseDecision(agent: Agent, input: RaiseInput): Effect.Effect<string, Refused> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work) return yield* new Refused({ message: 'There’s no goal to raise a decision on' });
      const raised = raiseDecision(this.store.ledger, { id: agent.id, title: work.title }, agent.name, input);
      if ('problem' in raised) return yield* new Refused({ message: raised.problem });
      const refused = this.core.ledger.record(agent.projectId, raised.entry);
      if (refused) return yield* new Refused({ message: `The decision ${refused}` });
      const { id } = raised.entry;
      return `${input.id ? 'Changed' : 'Raised'} ${id}: “${raised.entry.question}”. It stays open until the captain decides it (or the chief of staff, where the captain lets it): to put it to the captain now, ask with decision "${id}" and each option labelled as one of its options.`;
    });
  }

  /**
   * The captain's chat message to an agent: once it's sent, a lead's open question counts as answered in chat (they
   * replied in words instead of picking an option). Not the message `answer` sends, which records the pick itself.
   */
  captainMessage(id: string, text: string, how?: ResumeHow): MessageReply {
    // the lead's turn waits on their question: what the captain writes is its answer, in their words
    const rt = this.rt(id);
    const waiting = rt.asking;
    const asked = this.store.agent(id).lead;
    if (waiting && asked && text.trim()) {
      rt.asking = undefined;
      this.update(this.store.agent(id), { activity: 'Reading your answer', lead: { ...asked, questions: answerInChat(asked.questions ?? [], text, Date.now()) } });
      waiting.resolve(text.trim());
      return { sent: true };
    }
    const reply = this.core.comms.message(id, text, undefined, how);
    if ('costly' in reply) return reply;
    const agent = this.store.agent(id);
    const work = agent.lead;
    if (work && text.trim() && openQuestion(agent)) this.update(agent, { lead: { ...work, questions: answerInChat(work.questions ?? [], text, Date.now()) } });
    return reply;
  }

  /** The lead's propose_close tool: the captain hears the goal looks done, and closes it or carries on. */
  proposeClose(agent: Agent, reason: string): Effect.Effect<string, Refused> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work) return yield* new Refused({ message: 'There’s no goal to close' });
      this.update(agent, { lead: { ...work, closing: { reason: reason.trim() || 'The goal looks done', at: Date.now() } } });
      this.print(agent, [{ kind: 'success', text: `🏁 ${agent.name} thinks “${work.title}” is ready to wrap up: ${reason.trim()}` }]);
      this.hub.toast('success', `🏁 ${agent.name} thinks “${work.title}” is ready to wrap up`, agent.id);
      return 'The captain sees that you think the goal is ready to wrap up. Tell them why in a sentence or two, then stop: they close the goal, or carry on with you.';
    });
  }
}
