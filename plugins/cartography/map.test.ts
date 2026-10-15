// Focus's own map, as an architecture test: its model (.focus/cartography.yaml) has to keep up with its code.
import { describe, expect, it } from 'vitest';
import { OFFICE_DIR } from '../../plugin-api/testing';
import { mapRepo } from './map';

describe("the office's own map", () => {
  it('reads, every source file has a part, and every part still names code', async () => {
    const map = await mapRepo('jonhilt/focus', OFFICE_DIR);
    expect(map.error).toBeUndefined();
    expect(map.problems).toEqual([]);
    expect(map.mapped).toBe(map.files);
    expect(map.connections.length).toBeGreaterThan(0);
    // it reads every source file and the repo's whole git log: seconds, longer while the rest of the suite runs beside it
  }, 30_000);
});
