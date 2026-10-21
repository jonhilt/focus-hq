import { demoPace, sleep } from '../../plugin-api/server';
import type { Judge } from './chief';

/** The demo's judge: takes a moment, then sends a turn that asks something to the captain's queue, and carries on otherwise. */
export class DemoJudge implements Judge {
  readonly model = 'demo';

  async judge(req: { prompt: string }): Promise<{ structured: unknown; costUsd?: number }> {
    await sleep(300 / demoPace());
    const asks = /\?\s*(>>>)?\s*$/.test(req.prompt);
    return {
      structured: asks
        ? { route: 2, ask: 'The lead asks you to pick, and recommends one: go with it?', why: 'The lead is asking you to choose, and it has said which way it would go, so this can wait in your queue.', message: 'The lead has a question for you and recommends the option it describes. Shall it go ahead with that?' }
        : { route: 1, ask: 'Carry on with the next step it described', why: 'The lead is making progress within the slice and has said what it will do next.', message: 'Thanks, that all sounds right. Carry on with the next step you described.' },
      costUsd: 0,
    };
  }
}
