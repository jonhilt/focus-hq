import { describe, expect, it } from 'vitest';
import { faults, grow, NO_FAULTS, segmentHitsBox, segmentsCross } from './legibility';

describe('the rules a chart is held to', () => {
  it('tells segments that cross from ones that only meet at an end, or miss', () => {
    expect(segmentsCross([{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 0, y: 10 }, { x: 10, y: 0 }])).toBe(true);
    expect(segmentsCross([{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
    expect(segmentsCross([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 5 }, { x: 10, y: 5 }])).toBe(false);
  });

  it('finds a segment through a box, into it, or wholly inside it, and not one passing by', () => {
    const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(segmentHitsBox([{ x: -5, y: 5 }, { x: 15, y: 5 }], box)).toBe(true);
    expect(segmentHitsBox([{ x: -5, y: 5 }, { x: 5, y: 5 }], box)).toBe(true);
    expect(segmentHitsBox([{ x: 2, y: 2 }, { x: 8, y: 8 }], box)).toBe(true);
    expect(segmentHitsBox([{ x: -5, y: -5 }, { x: 15, y: -1 }], box)).toBe(false);
  });

  it('counts each rule broken', () => {
    const a = { x0: 0, y0: 0, x1: 20, y1: 10 };
    expect(faults({ labels: [a, { x0: 10, y0: 5, x1: 30, y1: 15 }], marks: [], lines: [], leaders: [] }, 4).overlapping).toBe(1);
    expect(faults({ labels: [a, { x0: 0, y0: 12, x1: 20, y1: 22 }], marks: [], lines: [], leaders: [] }, 4).crowded).toBe(1);
    expect(faults({ labels: [a, { x0: 0, y0: 16, x1: 20, y1: 26 }], marks: [], lines: [], leaders: [] }, 4)).toEqual(NO_FAULTS);
    expect(faults({ labels: [a], marks: [grow({ x0: 5, y0: 5, x1: 5, y1: 5 }, 2)], lines: [], leaders: [] }, 4).onMarks).toBe(1);
    expect(faults({ labels: [a], marks: [], lines: [[{ x: 10, y: -5 }, { x: 10, y: 20 }]], leaders: [] }, 4).onLines).toBe(1);
    expect(faults({ labels: [], marks: [], lines: [[{ x: 0, y: 10 }, { x: 10, y: 0 }]], leaders: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]] }, 4).crossing).toBe(1);
  });
});
