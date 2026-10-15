// Focus's own map, as an architecture test: its model (.focus/cartography.yaml) has to keep up with its code.
import { describe, expect, it } from 'vitest';
import { config } from '../../server/config';
import { mapRepo } from './map';

describe("the office's own map", () => {
  it('reads, every source file has a part, and every part still names code', async () => {
    const map = await mapRepo('jonhilt/focus', config.root);
    expect(map.error).toBeUndefined();
    expect(map.problems).toEqual([]);
    expect(map.mapped).toBe(map.files);
    expect(map.connections.length).toBeGreaterThan(0);
  });
});
