import { describe, expect, it } from 'vitest';
import { botGuard, tokenOk } from './bot';

describe('the bot token', () => {
  it('lets through only the token, as a bearer', () => {
    expect(tokenOk('Bearer s3cret', 's3cret')).toBe(true);
    expect(tokenOk('Bearer s3cre', 's3cret')).toBe(false);
    expect(tokenOk('s3cret', 's3cret')).toBe(false);
    expect(tokenOk(undefined, 's3cret')).toBe(false);
  });

  it('guards the bot routes: none without a token set, refused without the token', () => {
    const run = (token: string | undefined, authorization?: string) => {
      const out: { code?: number; next?: boolean } = {};
      botGuard(token)({ headers: { authorization } }, { status: (code) => ((out.code = code), { json: () => undefined }) }, () => (out.next = true));
      return out;
    };
    expect(run(undefined, 'Bearer x')).toEqual({ code: 404 });
    expect(run('x')).toEqual({ code: 401 });
    expect(run('x', 'Bearer x')).toEqual({ next: true });
  });
});
