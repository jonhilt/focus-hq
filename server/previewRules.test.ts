import { describe, expect, it } from 'vitest';
import type { PreviewLink } from '../shared/types';
import { type CommandExit, exitVerdict, linksVerdict, MISSES_TO_FAIL, stackVerdict } from './previewRules';

const up: PreviewLink = { url: 'http://localhost:3000', health: 'up' };
const erroring: PreviewLink = { url: 'http://localhost:3001', health: 'error' };
const down: PreviewLink = { url: 'http://localhost:3002', health: 'down' };

describe('linksVerdict', () => {
  it('starts counting again once any site answers, even with an error', () => {
    expect(linksVerdict([down, up], 2, true)).toEqual({ misses: 0 });
    expect(linksVerdict([down, erroring], 2, true)).toEqual({ misses: 0 });
  });

  it('counts a check where every site is down', () => {
    expect(linksVerdict([down], 0, true)).toEqual({ misses: 1 });
    expect(linksVerdict([down, down], 1, false)).toEqual({ misses: 2 });
  });

  it('fails a detached preview on the third check in a row with no answer', () => {
    expect(linksVerdict([down], MISSES_TO_FAIL - 2, true)).toEqual({ misses: MISSES_TO_FAIL - 1 });
    expect(linksVerdict([down], MISSES_TO_FAIL - 1, true)).toEqual({ misses: MISSES_TO_FAIL, fail: 'The site stopped answering' });
  });

  it('leaves a preview whose command still runs to that command’s exit', () => {
    expect(linksVerdict([down], 10, false)).toEqual({ misses: 11 });
  });
});

describe('stackVerdict', () => {
  it('fails the preview when the stack left the progress command’s list', () => {
    expect(stackVerdict('gone')).toEqual({ fail: 'The stack went away: it is no longer in the progress command’s list' });
  });

  it('warns about a troubled status, with its error when it gave one', () => {
    expect(stackVerdict({ status: 'unhealthy', error: 'db not ready' })).toEqual({ warning: 'The stack reports itself as unhealthy: db not ready' });
    expect(stackVerdict({ status: 'Degraded', error: '' })).toEqual({ warning: 'The stack reports itself as Degraded' });
  });

  it('clears the warning on a happy status', () => {
    expect(stackVerdict({ status: 'ready' })).toEqual({ warning: undefined });
    expect(stackVerdict({ status: 'ok', error: 'ignored' })).toEqual({ warning: undefined });
  });

  it('leaves the warning alone when there is nothing to read', () => {
    expect(stackVerdict(undefined)).toBeNull();
    expect(stackVerdict({ phase: 'building' })).toBeNull();
    expect(stackVerdict({ status: 3 })).toBeNull();
  });
});

describe('exitVerdict', () => {
  const exit = (over: Partial<CommandExit>): CommandExit => ({ code: 0, signal: null, result: null, hasLinks: false, offered: false, namedLinks: false, ...over });

  it('keeps the preview when the command finished cleanly with a site to check', () => {
    expect(exitVerdict(exit({ hasLinks: true }))).toEqual({ kind: 'detached' });
    expect(exitVerdict(exit({ offered: true, result: { status: 'ready' } }))).toEqual({ kind: 'detached' });
  });

  it('fails a clean exit that reported no site', () => {
    expect(exitVerdict(exit({}))).toEqual({ kind: 'failed', message: 'The command finished without reporting a site' });
  });

  it('fails a clean exit whose result says it gave up, with the error it reported', () => {
    expect(exitVerdict(exit({ hasLinks: true, result: { status: 'failed', error: 'port taken' } }))).toEqual({ kind: 'failed', message: 'port taken' });
    expect(exitVerdict(exit({ hasLinks: true, result: { status: 'stopped' } }))).toEqual({
      kind: 'failed',
      message: 'The command finished without reporting a site (status "stopped")',
    });
  });

  it('gives a stack that named its links and exited unhappily the benefit of the doubt', () => {
    expect(exitVerdict(exit({ code: 1, namedLinks: true }))).toEqual({ kind: 'complained', complaint: 'The command exited with code 1' });
    expect(exitVerdict(exit({ code: 1, namedLinks: true, result: { status: 'unhealthy', error: 'api down' } }))).toEqual({
      kind: 'complained',
      complaint: 'The command exited with code 1 and reported the stack as unhealthy: api down',
    });
  });

  it('fails an unhappy exit that never named its links, or gave up', () => {
    expect(exitVerdict(exit({ code: 2, hasLinks: true }))).toEqual({ kind: 'failed', message: 'The command exited with code 2' });
    expect(exitVerdict(exit({ code: 1, namedLinks: true, result: { status: 'error' } }))).toEqual({
      kind: 'failed',
      message: 'The command exited with code 1 (status "error")',
    });
  });

  it('fails a killed command, whatever it had named', () => {
    expect(exitVerdict(exit({ code: null, signal: 'SIGTERM', namedLinks: true, hasLinks: true }))).toEqual({
      kind: 'failed',
      message: 'The command was killed (SIGTERM)',
    });
  });
});
