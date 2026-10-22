import { demoPace, sleep } from '../../plugin-api/server';
import type { Judge } from './chief';
import type { Reply } from './shared';

/** The replies the demo's judge suggests on a turn that asks something: fitted to the question where it knows it, yes or not yet otherwise. */
export function demoReplies(prompt: string): Reply[] {
  if (/keep the goal open|close (it|the goal)/i.test(prompt)) return [{ label: 'Keep it open', text: 'Keep the goal open: there’s more to do.' }, { label: 'Close it', text: 'Close it: it’s done.' }];
  if (/redraw/i.test(prompt)) return [{ label: 'Yes, redraw it', text: 'Yes, redraw that part in more detail, please.' }, { label: 'No need', text: 'No need: that’s clear enough.' }];
  return [{ label: 'Go ahead', text: 'Yes, go ahead.' }, { label: 'Not yet', text: 'Not yet: hold off until I’ve had a look.' }];
}

/** The demo's judge: takes a moment, then sends a turn that asks something to the captain's queue, and carries on otherwise. */
export class DemoJudge implements Judge {
  readonly model = 'demo';

  async judge(req: { prompt: string }): Promise<{ structured: unknown; costUsd?: number }> {
    await sleep(300 / demoPace());
    const asks = /\?\s*(>>>)?\s*$/.test(req.prompt);
    return {
      structured: asks
        ? { route: 2, ask: 'The lead asks you to pick, and recommends one: go with it?', why: 'The lead is asking you to choose, and it has said which way it would go, so this can wait in your queue.', message: 'The lead has a question for you and recommends the option it describes. Shall it go ahead with that?', replies: demoReplies(req.prompt) }
        : { route: 1, ask: 'Carry on with the next step it described', why: 'The lead is making progress within the slice and has said what it will do next.', message: 'Thanks, that all sounds right. Carry on with the next step you described.', replies: [] },
      costUsd: 0,
    };
  }
}
