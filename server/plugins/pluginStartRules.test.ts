import { describe, expect, it } from 'vitest';
import type { FocusPlugin } from './contract';
import { startOrder } from './pluginStartRules';

describe('startOrder', () => {
  const needs = (id: string, ...requires: string[]): FocusPlugin => ({ id, requires, start: () => ({}) });
  const ids = (r: ReturnType<typeof startOrder>) => r.order.map((p) => p.id);

  it('starts each plugin after the ones it requires, whatever order FOCUS_PLUGINS names them in', () => {
    expect(ids(startOrder([needs('climber', 'scorecard'), needs('scorecard')]))).toEqual(['scorecard', 'climber']);
    expect(ids(startOrder([needs('a', 'b'), needs('b', 'c'), needs('c')]))).toEqual(['c', 'b', 'a']);
  });

  it('leaves out a plugin whose requirement isn’t switched on, and the plugins that require it in turn', () => {
    const r = startOrder([needs('climber', 'scorecard'), needs('auditor', 'climber'), needs('voice')]);
    expect(ids(r)).toEqual(['voice']);
    expect(r.leftOut).toEqual([
      { id: 'climber', why: 'it requires scorecard, which isn\'t switched on (add it to FOCUS_PLUGINS)' },
      { id: 'auditor', why: 'it requires climber, which is left out' },
    ]);
  });

  it('leaves out plugins that require each other round a loop', () => {
    const r = startOrder([needs('a', 'b'), needs('b', 'a'), needs('c')]);
    expect(ids(r)).toEqual(['c']);
    expect(r.leftOut.map((o) => o.id).sort()).toEqual(['a', 'b']);
    expect(r.leftOut[0].why).toMatch(/requires it back/);
  });

  it('won’t start two plugins with the same id', () => {
    expect(() => startOrder([needs('climber'), needs('climber')])).toThrow(/Two plugins are called climber/);
  });
});
