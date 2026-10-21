import { Effect, Option } from 'effect';
import type { Agent, MessageReply, ResumeHow } from '../../../shared/types';
import { answerMessage, openQuestion } from '../../../shared/artifacts';
import { answerInChat, answerQuestion, type ArtifactInput, askQuestion, type QuestionInput, showArtifact, type NoteInput, notedGoal, pageErrorsNote } from '../lead';
import { type Frame, type Frames, type Picture, Renderer, Workspace } from '../services';
import { checkModel, modelError, modelReport } from '../../../shared/systemModel';
import type { SystemModel } from '../../../shared/types';
import { citedLines, modelPage } from '../modelPage';
import { sourceReader } from '../sourceReader';
import { Part, Refused } from './core';

/** The lead's `office` MCP tools besides ship: the goal's note, show, model, ask (and the captain's answer) and propose_close. */
export class GoalTools extends Part {
  /** The lead's note tool: the goal's note and title, as they want them. */
  noteGoal(agent: Agent, input: NoteInput): Effect.Effect<string, Refused> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work) return yield* new Refused({ message: 'There’s no goal to keep a note on' });
      const noted = notedGoal(work, input, Date.now());
      if ('error' in noted) return yield* new Refused({ message: noted.error });
      this.update(agent, { lead: noted.lead, issue: { ...agent.issue, title: noted.lead.title } });
      return noted.reply;
    });
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
   * The lead's model tool: a system model of how its code works (or what its change does), checked against the lead's
   * own workspace, drawn the one fixed way (shared/modelDrawing.ts), and shown like any of show's visuals, the code it cites carried in the
   * page. What didn't check out is drawn flagged and said back, for the lead to fix.
   */
  showModel(agent: Agent, input: { id: string; title: string; model: SystemModel }): Effect.Effect<string, Refused, Renderer | Workspace> {
    return Effect.gen({ self: this }, function* () {
      const bad = modelError(input.model);
      if (bad) return yield* new Refused({ message: bad });
      const read = sourceReader([(yield* Workspace).dir(agent.id)]);
      const { model, problems } = checkModel(input.model, read);
      const html = modelPage(model, input.title, citedLines(model, read));
      const shown = yield* this.showPage(agent, { id: input.id, title: input.title, html });
      // a model of how the code works is worth keeping past the goal: the plugins hear of it (cartography keeps them)
      this.core.plugins.modelShown(agent, { id: input.id, title: input.title, model, html, image: shown.picture?.image });
      return `${shown.text} ${modelReport(model, problems)}`;
    });
  }

  /**
   * A model checked against the code under `dirs` and drawn as the model tool draws it, with its picture when one can
   * be taken: for a plugin, a model a read-only session drew afresh (`PluginHost.drawModel`).
   */
  drawn(input: SystemModel, title: string, dirs: readonly string[]): Promise<{ model: SystemModel; problems: string[]; html: string; image?: Uint8Array }> {
    const bad = modelError(input);
    if (bad) return Promise.reject(new Refused({ message: bad }));
    const read = sourceReader(dirs);
    const { model, problems } = checkModel(input, read);
    const html = modelPage(model, title, citedLines(model, read));
    const picture = Effect.gen(function* () {
      return (yield* (yield* Renderer).render(html)).image;
    }).pipe(Effect.catch(() => Effect.void));
    return this.runtime.runPromise(picture).then((image) => ({ model, problems, html, ...(image ? { image } : {}) }));
  }

  /**
   * The lead's ask tool: the question goes on the station's screen, each option a page with a picture of its own, in
   * place of one still open. The captain's pick comes back to the lead as a message from them (`answer`).
   */
  askCaptain(agent: Agent, input: QuestionInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.lead) return yield* new Refused({ message: 'There’s no goal to ask about' });
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
   * The captain picks an option of the lead's open question: it's marked answered, and the lead hears which. Unless
   * hearing it would cost enough on your API key to ask the captain first (`how` is their answer): then nothing changes.
   */
  answer(id: string, questionId: string, option: string, note?: string, how?: ResumeHow): Agent | MessageReply {
    const agent = this.store.agent(id);
    const work = agent.lead;
    if (!work) throw new Error(`${agent.name} isn’t leading a goal`);
    const answered = answerQuestion(work.questions ?? [], questionId, option, note, Date.now());
    if ('error' in answered) throw new Error(answered.error);
    const reply = this.core.comms.message(id, answerMessage(answered.question, option, note), undefined, how);
    if ('costly' in reply) return reply;
    // read again: sending it may have changed the goal (a proposal to close dropped)
    if (agent.lead) this.update(agent, { lead: { ...agent.lead, questions: answered.questions } });
    return agent;
  }

  /**
   * The captain's chat message to an agent: once it's sent, a lead's open question counts as answered in chat (they
   * replied in words instead of picking an option). Not the message `answer` sends, which records the pick itself.
   */
  captainMessage(id: string, text: string, how?: ResumeHow): MessageReply {
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
