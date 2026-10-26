import { demoPace, sleep } from '../../plugin-api/server';
import type { Judge } from './chief';
import { LANE_SCHEMA } from './laneJudge';
import type { Reply } from './shared';

/** The replies the demo's judge suggests on a turn that asks something: fitted to the question where it knows it, yes or not yet otherwise. */
export function demoReplies(prompt: string): Reply[] {
  if (/keep the goal open|close (it|the goal)/i.test(prompt)) return [{ label: 'Keep it open', text: 'Keep the goal open: there’s more to do.' }, { label: 'Close it', text: 'Close it: it’s done.' }];
  if (/redraw/i.test(prompt)) return [{ label: 'Yes, redraw it', text: 'Yes, redraw that part in more detail, please.' }, { label: 'No need', text: 'No need: that’s clear enough.' }];
  return [{ label: 'Go ahead', text: 'Yes, go ahead.' }, { label: 'Not yet', text: 'Not yet: hold off until I’ve had a look.' }];
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
    const untested = /\b(?:untested|not tested|haven['’]t tested)\b/i.test(req.prompt.slice(req.prompt.lastIndexOf('<<<')));
    if (untested && !asks)
      return {
        structured: { route: 4, check: 'evidence', ask: 'Test it before reporting it done', why: 'The lead reports the work done without having tested it, and it can test it itself.', says: 'The lead says the work is done but hasn\'t tested it, so I\'ve sent it back to test it and show what it saw. Nothing for you yet.', message: 'Before this goes to the captain, test what you built and show what you saw.', replies: [] },
        costUsd: 0,
      };
    return {
      structured: asks
        ? { route: 2, check: 'captains', ask: 'The lead asks you to pick, and recommends one: go with it?', why: 'The lead is asking you to choose, and it has said which way it would go, so this can wait in your queue.', says: 'The lead needs you to pick between the options it laid out, and says which it would take. Pick one when you\'re ready.', message: 'The lead has a question for you and recommends the option it describes. Shall it go ahead with that?', replies: demoReplies(req.prompt) }
        : { route: 1, check: 'none', ask: 'Carry on with the next step it described', why: 'The lead is making progress within the slice and has said what it will do next.', says: 'The lead is getting on with the slice and has said what comes next. Nothing for you.', message: 'Thanks, that all sounds right. Carry on with the next step you described.', replies: [] },
      costUsd: 0,
    };
  }
}
