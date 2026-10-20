import { demoPace, sleep } from '../../plugin-api/server';
import type { Judge } from './chief';

/** The demo's judge: takes a moment, then sends a turn that asks something to the captain's queue, and carries on otherwise. */
export class DemoJudge implements Judge {
  readonly model = 'demo';

  async judge(req: { prompt: string }): Promise<{ structured: unknown; costUsd?: number }> {
    await sleep(300 / demoPace());
    const asks = /\?\s*(>>>)?\s*$/.test(req.prompt);
    return { structured: asks ? { route: 2, why: 'The lead asks a question with its pick: a card.', message: '' } : { route: 1, why: 'Progress within the slice, with its next step.', message: '' }, costUsd: 0 };
  }
}
