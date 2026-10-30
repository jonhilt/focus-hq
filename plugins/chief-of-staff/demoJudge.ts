import { demoPace, sleep } from '../../plugin-api/server';
import type { Judge } from './chief';
import { LANE_SCHEMA } from './laneJudge';
import { type Ask, MAX_ASKS, type Reply } from './shared';

/** The replies the demo's judge suggests on a turn that asks something: fitted to the question where it knows it, yes or not yet otherwise. */
export function demoReplies(prompt: string): Reply[] {
  if (/keep the goal open|close (it|the goal)/i.test(prompt)) return [{ label: 'Keep it open', text: 'Keep the goal open: there’s more to do.' }, { label: 'Close it', text: 'Close it: it’s done.' }];
  if (/redraw/i.test(prompt)) return [{ label: 'Yes, redraw it', text: 'Yes, redraw that part in more detail, please.' }, { label: 'No need', text: 'No need: that’s clear enough.' }];
  return [{ label: 'Go ahead', text: 'Yes, go ahead.' }, { label: 'Not yet', text: 'Not yet: hold off until I’ve had a look.' }];
}

/** The replies to a question that offers two things ("the shared link or the emails?"): one each; otherwise `demoReplies`. */
function repliesTo(question: string): Reply[] {
  const either = /:\s*(?:the\s+)?(.+?)\s+or\s+(?:the\s+)?(.+?)\?$/i.exec(question);
  if (!either) return demoReplies(question);
  const [, a = '', b = ''] = either;
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return [{ label: cap(a), text: `${cap(a)} first.` }, { label: cap(b), text: `${cap(b)} first.` }];
}

/**
 * The asks in what the lead said (the prompt's `<<< … >>>`), a question each, when it asks more than one: one that asks
 * to merge a pull request under THE LEAD'S OPEN PULL REQUESTS is left out, since the card has its merge button.
 */
export function demoAsks(prompt: string): Ask[] {
  const said = prompt.slice(prompt.lastIndexOf('<<<') + 3, prompt.lastIndexOf('>>>'));
  const open = /THE LEAD'S OPEN PULL REQUESTS[^\n]*\n((?:- .*\n?)*)/.exec(prompt)?.[1] ?? '';
  const questions = said.split(/(?<=[?.!])\s+/).map((q) => q.trim().replace(/^(?:and|also|so)\s+/i, '')).filter((q) => q.endsWith('?'));
  if (questions.length < 2) return [];
  const merging = (q: string) => /\bmerge\b/i.test(q) && [...q.matchAll(/#(\d+)/g)].some(([, n]) => open.includes(`#${n}`));
  return questions.filter((q) => !merging(q)).slice(0, MAX_ASKS).map((q) => ({ ask: q.charAt(0).toUpperCase() + q.slice(1), replies: repliesTo(q) }));
}

/**
 * The demo's judge: takes a moment, then sends a turn that asks something to the captain's queue, one that says it
 * hasn't tested what it reports back to the lead, and carries on otherwise.
 */
export class DemoJudge implements Judge {
  readonly model = 'demo';

  async judge(req: { prompt: string; schema?: Record<string, unknown> }): Promise<{ structured: unknown; costUsd?: number }> {
    await sleep(300 / demoPace());
    // a ship's lane: it keeps the lead's pick (a lane read only ever raises)
    if (req.schema === LANE_SCHEMA) return { structured: { lane: 'ship', why: 'It only wires in parts as they are, so it can merge once QA passes it.' }, costUsd: 0 };
    const asks = /\?\s*(>>>)?\s*$/.test(req.prompt);
    // several questions in one turn: a card with an ask for each
    const several = demoAsks(req.prompt);
    if (several.length)
      return {
        structured: { route: 2, check: 'captains', asks: several, why: 'The lead puts several decisions to you, each of its own.', says: `The lead needs ${several.length === 1 ? 'one answer' : `${several.length} answers`} from you; each is a decision of its own.`, message: 'The lead has a few things for you to decide. Answer each, and they go to the lead together.' },
        costUsd: 0,
      };
    const moved = demoMove(req.prompt);
    if (moved) return { structured: moved, costUsd: 0 };
    const untested = /\b(?:untested|not tested|haven['’]t tested)\b/i.test(req.prompt.slice(req.prompt.lastIndexOf('<<<')));
    if (untested && !asks)
      return {
        structured: { route: 4, check: 'evidence', asks: [{ ask: 'Test it before reporting it done', replies: [] }], why: 'The lead reports the work done without having tested it, and it can test it itself.', says: 'The lead says the work is done but hasn\'t tested it, so I\'ve sent it back to test it and show what it saw. Nothing for you yet.', message: 'Before this goes to the captain, test what you built and show what you saw.' },
        costUsd: 0,
      };
    return {
      structured: asks
        ? { route: 2, check: 'captains', asks: [{ ask: 'The lead asks you to pick, and recommends one: go with it?', replies: demoReplies(req.prompt) }], why: 'The lead is asking you to choose, and it has said which way it would go, so this can wait in your queue.', says: 'The lead needs you to pick between the options it laid out, and says which it would take. Pick one when you\'re ready.', message: 'The lead has a question for you and recommends the option it describes. Shall it go ahead with that?' }
        : { route: 1, check: 'none', asks: [{ ask: 'Carry on with the next step it described', replies: [] }], why: 'The lead is making progress within the slice and has said what it will do next.', says: 'The lead is getting on with the slice and has said what comes next. Nothing for you.', message: 'Thanks, that all sounds right. Carry on with the next step you described.' },
      costUsd: 0,
    };
  }
}

/**
 * Work the lead says isn't part of its goal: a move to the first other open goal the judge was shown, or a new goal
 * when there's none (handoverRules.ts), the move picked.
 */
export function demoMove(prompt: string): Record<string, unknown> | undefined {
  if (!/\bisn[’']t part of this goal\b/i.test(prompt.slice(prompt.lastIndexOf('<<<')))) return undefined;
  const other = /THE OTHER OPEN GOALS[^\n]*\n- (\S+): “([^”]*)” \(([^,)]+)/.exec(prompt);
  const what = 'the retries for failed pushes';
  const ask = other ? `Move ${what} to ${other[3]}’s goal?` : `Start a new goal for ${what}?`;
  const where = other ? `${other[3]}’s goal, “${other[2]}”` : 'a goal of its own';
  return {
    route: 2, check: 'captains', why: 'The lead built work that belongs outside its goal, and moving it is yours to decide.',
    says: `The lead built retries for failed pushes along the way, which isn’t this goal’s work. I’d move it to ${where}.`,
    message: `The lead built retries for failed pushes, outside this goal. I recommend moving them to ${where}, so this goal stays on its slice.`,
    asks: [{
      ask, replies: [{ label: 'Keep it here', text: 'Keep the retries here for now.' }],
      move: { what, to: other?.[1] ?? 'new', brief: 'Retries for failed pushes are built on the lead’s branch, with their tests passing. Take them into your goal and ship them from there.', pick: 'move' },
    }],
  };
}

