import { describe, expect, it } from 'vitest';
import { type NavItem, shownView } from './panels';

type View = 'browser' | 'goal' | 'tasks';
const items = (standby: View[]): NavItem<View>[] =>
  (['browser', 'goal', 'tasks'] as const).map((key) => ({ key, label: key, standby: standby.includes(key) }));

describe('shownView', () => {
  it('shows the first view with something in it until one is picked', () => {
    expect(shownView(items([]), undefined)).toBe('browser');
    expect(shownView(items(['browser']), undefined)).toBe('goal');
  });

  it('keeps the picked view when another one comes to life', () => {
    expect(shownView(items([]), 'tasks')).toBe('tasks');
  });

  it('falls back to the first live view when the picked one goes on standby', () => {
    expect(shownView(items(['tasks']), 'tasks')).toBe('browser');
  });

  it('shows nothing when every view is on standby', () => {
    expect(shownView(items(['browser', 'goal', 'tasks']), 'goal')).toBeUndefined();
  });
});
