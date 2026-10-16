// Focus's own map, as an architecture test: its model (.focus/cartography.yaml) has to keep up with its code.
import { describe, expect, it } from 'vitest';
import { OFFICE_DIR } from '../../plugin-api/testing';
import { mapRepo } from './map';

describe("the office's own map", () => {
  // it reads every file in the repo and its git history: on a busy machine that's more than the usual 5 s
  it('reads, every source file has a part, and every part still names code', async () => {
    const map = await mapRepo('jonhilt/focus', OFFICE_DIR);
    expect(map.error).toBeUndefined();
    expect(map.problems).toEqual([]);
    expect(map.mapped).toBe(map.files);
    expect(map.connections.length).toBeGreaterThan(0);
  }, 30_000);
});
