import { describe, expect, it } from 'vitest';
import { extraTools } from './opsTool';

describe('the plugins\' tools', () => {
  const t = (name: string) => ({ name, description: name, input: {}, run: () => Promise.resolve(name) });

  it('takes those well named and clear of Ops\' own and of each other\'s, the first of a name winning', () => {
    const first = t('map');
    const kept = extraTools([first, t('show'), t('Map Tool'), t('map'), t('trace_view')]);
    expect(kept.map((x) => x.name)).toEqual(['map', 'trace_view']);
    expect(kept[0]).toBe(first);
  });
});
