import { Effect, Option } from 'effect';
import type { Agent, MessageReply, ResumeHow } from '../../../shared/types';
import { answerMessage } from '../../../shared/artifacts';
import { answerQuestion, type ArtifactInput, askQuestion, type QuestionInput, showArtifact, applyNote, type NoteInput, pageErrorsNote } from '../lead';
import { beatMoments, explainerCheck, explainerPage, type ExplainerInput, momentNotes } from '../explainer';
import { applyContacts } from '../contacts';
import { checklistWaypoint, headedWaypoint, notedWaypoint } from '../waypoints';
import { type Picture, Renderer } from '../services';
import type { ToolReply } from '../types';
import { Part, Refused } from './core';

/** The lead's office tools besides ship: the goal's note, show, explain, ask (and the captain's answer) and propose_close. */
export class GoalTools extends Part {
  /** The lead's note tool: the goal's note and title, as they want them. */
  noteGoal(agent: Agent, input: NoteInput): Effect.Effect<string, Refused> {
    return Effect.gen({ self: this }, function* () {
      const work = agent.lead;
      if (!work) return yield* new Refused({ message: 'There’s no goal to keep a note on' });
      const now = Date.now();
      const next = applyNote(work, input);
      if ('error' in next) return yield* new Refused({ message: next.error });
      const contacts = applyContacts(work, input, now);
      if ('error' in contacts) return yield* new Refused({ message: contacts.error });
      const noted = notedWaypoint(work, input, next.note, now);
      const headed = input.heading !== undefined ? headedWaypoint({ slice: work.slice, waypoints: noted ?? work.waypoints }, input.heading, now) : noted;
      // the checklist sent again: the commits so far are ones the lead has had the chance to tick off (`checklist.ts`)
      const waypoints = input.slice !== undefined ? checklistWaypoint({ slice: work.slice, waypoints: headed ?? work.waypoints }, now) : headed;
      this.update(agent, { lead: { ...work, title: next.title, note: next.note, ...(waypoints && { waypoints }), ...(contacts.length && { contacts }) }, issue: { ...agent.issue, title: next.title } });
      const contact = input.contact?.trim() ? contacts.at(-1) : undefined;
      const logged = contact ? ` Logged contact ${contact.id}.` : '';
      return `Noted.${logged} The captain sees the note on the goal, and you hear it again at each new slice.`;
    });
  }

  /**
   * The lead's show tool: the page goes on the goal, with a picture of it for the station's screen. A page the office
   * can't take a picture of still goes up: the captain can open it, though the screen only shows its title.
   */
  showArtifact(agent: Agent, input: ArtifactInput): Effect.Effect<string, Refused, Renderer> {
    return Effect.map(this.showPage(agent, input), (shown) => shown.text);
  }

  /** show's work, with the picture it took: `moments` asks for an explainer's stage at those times too. */
  private showPage(agent: Agent, input: ArtifactInput, moments?: readonly number[]): Effect.Effect<{ text: string; picture?: Picture }, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      if (!agent.lead) return yield* new Refused({ message: 'There’s no goal to show it on' });
      const checked = showArtifact(agent.lead.artifacts ?? [], input, Date.now());
      if ('error' in checked) return yield* new Refused({ message: checked.error });
      this.store.saveArtifact(agent.id, `${input.id}.html`, Buffer.from(input.html));
      const picture = yield* (yield* Renderer).render(input.html, moments).pipe(
        Effect.map((taken) => ({ bytes: taken.image, errors: taken.errors, taken })),
        Effect.catch((err) => Effect.succeed({ failed: err.message })),
      );
      if ('bytes' in picture) this.store.saveArtifact(agent.id, `${input.id}.jpg`, picture.bytes);
      else this.store.deleteArtifact(agent.id, `${input.id}.jpg`);
      // taking the picture takes a moment: the goal may have closed, or the lead shown something else, meanwhile
      const work = agent.lead;
      if (!work) return { text: 'The goal closed before it went up.' };
      const next = showArtifact(work.artifacts ?? [], input, Date.now());
      if ('error' in next) return yield* new Refused({ message: next.error });
      // each goes on the waypoint of the slice it was last shown in, as evidence of what it set out to do
      this.update(agent, { lead: { ...work, artifacts: next.map((a) => (a.id === input.id ? { ...a, slice: work.slice, ...('bytes' in picture && { image: true }) } : a)) } });
      const where = `“${next.find((a) => a.id === input.id)?.title ?? input.title}” is on your station's screen; the captain can open it up close.`;
      return 'bytes' in picture
        ? { text: `${where}${pageErrorsNote(picture.errors)}`, picture: picture.taken }
        : { text: `${where} The office couldn't take a picture of it for the screen (${picture.failed}), so the screen shows only its title.` };
    });
  }

  /** The lead's explain tool: their beats and stage go in the office's player, which goes up like any of show's visuals. */
  explain(agent: Agent, input: ExplainerInput): Effect.Effect<ToolReply, Refused, Renderer> {
    return Effect.gen({ self: this }, function* () {
      const built = explainerPage(input);
      if ('error' in built) return yield* new Refused({ message: built.error });
      const shown = yield* this.showPage(agent, built, beatMoments(input.beats));
      const seconds = input.beats.reduce((sum, b) => sum + b.seconds, 0);
      const text = `${shown.text} It's an explainer of ${input.beats.length} beats, ${Math.round(seconds)} seconds in all.`;
      const moments = shown.picture?.moments ?? [];
      if (!moments.length) return { text, images: [] };
      return { text: `${text} ${explainerCheck(momentNotes(moments))}`, images: moments.map((m) => m.image) };
    });
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
      // taking them takes a moment: the goal may have closed, or the lead asked again, meanwhile
      const work = agent.lead;
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
      return `Your question is on your station's screen with its ${asked.options.length} options${missing ? ` (the office couldn't take a picture of ${missing} of them, so the screen shows just their labels)` : ''}. The captain's pick comes back to you as a message from them: end your turn here and wait for it.`;
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
    this.update(agent, { lead: { ...work, questions: answered.questions } });
    return agent;
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
