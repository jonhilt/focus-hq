import { describe, expect, it } from 'vitest';
import { newestFirst } from './blender';

describe('newestFirst', () => {
  it("puts Blender's install folders newest version first, by number not by name", () => {
    expect(newestFirst(['Blender 4.5', 'Blender 5.2', 'Blender 4.10', 'Blender'])).toEqual(['Blender 5.2', 'Blender 4.10', 'Blender 4.5', 'Blender']);
  });

  it('leaves out folders that are not Blender', () => {
    expect(newestFirst(['Blender 5.2', 'Benchmark', 'Assets'])).toEqual(['Blender 5.2']);
  });
});
