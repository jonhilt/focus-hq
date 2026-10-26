import { describe, expect, it } from 'vitest';
import { pluginChoice, restartPending, switchShipPlugin } from './shipPluginRules';

describe('the plugins Focus starts with', () => {
  it('are FOCUS_PLUGINS’s when it’s set, even empty, whatever the captain saved', () => {
    expect(pluginChoice(' flow, usage ,', false, ['retro'])).toEqual({ names: ['flow', 'usage'], pinnedBy: 'FOCUS_PLUGINS' });
    expect(pluginChoice('', true, ['retro'])).toEqual({ names: [], pinnedBy: 'FOCUS_PLUGINS' });
  });

  it('are all of them in a demo ship, which saves no choice', () => {
    expect(pluginChoice(undefined, true, ['retro'])).toEqual({ names: ['all'], pinnedBy: 'demo' });
  });

  it('are the captain’s saved choice otherwise, none until they make one', () => {
    expect(pluginChoice(undefined, false, ['retro'])).toEqual({ names: ['retro'], pinnedBy: null });
    expect(pluginChoice(undefined, false, [])).toEqual({ names: [], pinnedBy: null });
    expect(pluginChoice(undefined, false, undefined)).toEqual({ names: [], pinnedBy: null });
  });
});

describe('a restart to apply the captain’s choice', () => {
  it('is pending only while the choice differs from what Focus started with, in any order', () => {
    const available = ['a', 'b', 'c'].map((id) => ({ id, requires: [] }));
    expect(restartPending(['a', 'b'], ['b', 'a'], available)).toBe(false);
    expect(restartPending(['a', 'b'], ['a'], available)).toBe(true);
    expect(restartPending(['a'], ['a', 'c'], available)).toBe(true);
    expect(restartPending(['a'], undefined, available)).toBe(false);
  });

  it('isn’t pending for a plugin chosen that can’t start, gone or failing to load', () => {
    expect(restartPending(['a'], ['a', 'gone'], [{ id: 'a', requires: [] }])).toBe(false);
  });
});

describe('switching a plugin on or off for the ship', () => {
  const available = [{ id: 'scorecard', requires: [] }, { id: 'climber', requires: ['scorecard'] }, { id: 'summit', requires: ['climber'] }, { id: 'flow', requires: [] }];

  it('switches on what it requires with it, all the way down', () => {
    expect(switchShipPlugin(['flow'], 'summit', true, available).sort()).toEqual(['climber', 'flow', 'scorecard', 'summit']);
  });

  it('switches off what requires it with it, all the way up', () => {
    expect(switchShipPlugin(['flow', 'scorecard', 'climber', 'summit'], 'scorecard', false, available)).toEqual(['flow']);
  });

  it('leaves the rest as they were', () => {
    expect(switchShipPlugin(['flow', 'scorecard'], 'climber', false, available)).toEqual(['flow', 'scorecard']);
    expect(switchShipPlugin(['flow'], 'flow', true, available)).toEqual(['flow']);
  });
});
