import { Clock, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { GitFailed, retryServerErrors } from './services';

describe('retryServerErrors', () => {
  it('tries again after 4, 8 and 16 seconds while GitHub answers 5xx, then gives up', async () => {
    const tries: number[] = [];
    const retries: string[] = [];
    const push = Effect.gen(function* () {
      tries.push(yield* Clock.currentTimeMillis);
      return yield* new GitFailed({ what: 'push', reason: 'The requested URL returned error: 502', serverError: 'HTTP 502' });
    });
    const result = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(retryServerErrors(push, (status, attempt) => retries.push(`${status} ${attempt}`))));
      yield* TestClock.adjust('1 minute');
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(result._tag).toBe('Failure');
    expect(tries.map((t) => t - tries[0])).toEqual([0, 4000, 12_000, 28_000]);
    expect(retries).toEqual(['HTTP 502 1', 'HTTP 502 2', 'HTTP 502 3']);
  });

  it('leaves any other failure alone', async () => {
    let tries = 0;
    const push = Effect.suspend(() => (tries++, Effect.fail(new GitFailed({ what: 'push', reason: 'stale info' }))));
    await Effect.runPromise(Effect.result(retryServerErrors(push, () => undefined)));
    expect(tries).toBe(1);
  });
});
