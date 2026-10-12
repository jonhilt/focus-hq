import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compilePlan, moveTarget, readPlan, resolveAnchor, trackAt, type Beat, type Plan } from './stagePlan';

const beats: Beat[] = [
  { id: 'r1', at: 10, text: 'One session does it all', marks: { all: 12.5 } },
  { id: 'r2', at: 20, end: 26, text: 'Rung two' },
];
const plan = (shots: Plan['shots']): Plan => ({ plan: 1, episode: 'test', beats, cast: { lead: { kind: 'crew', at: [0, 0, 0] } }, shots });

describe('resolveAnchor', () => {
  it('reads beats, marks, ends and offsets', () => {
    expect(resolveAnchor(3.5, beats)).toBe(3.5);
    expect(resolveAnchor('r1', beats)).toBe(10);
    expect(resolveAnchor('r1.all', beats)).toBe(12.5);
    expect(resolveAnchor('r1.all-0.2', beats)).toBeCloseTo(12.3);
    expect(resolveAnchor('r1+2.8', beats)).toBeCloseTo(12.8);
    expect(resolveAnchor('r1.end', beats)).toBe(20);
    expect(resolveAnchor('r2.end+2', beats)).toBe(28);
  });

  it('names what it can’t find', () => {
    expect(() => resolveAnchor('r9', beats)).toThrow(/no beat called r9/);
    expect(() => resolveAnchor('r1.gone', beats)).toThrow(/no mark called gone/);
    expect(() => resolveAnchor('r1 then', beats)).toThrow(/isn't an anchor/);
  });
});

describe('compilePlan', () => {
  it('lays shots back to back and spreads a list of targets by its gap', () => {
    const t = compilePlan(
      plan([
        { id: 'a', span: ['r1', 'r2'], camera: { size: 'MS' }, do: [{ at: 'r1.all', act: 'beam-in', who: ['x', 'y', 'z'], gap: 0.5 }, { after: 1, act: 'say', who: 'x', line: 'hi' }] },
        { id: 'b', span: ['r2', 'r2.end'], camera: { size: 'LS' } },
      ]),
    );
    expect(t.duration).toBe(26);
    expect(t.shots.map((s) => [s.start, s.end])).toEqual([[10, 20], [20, 26]]);
    expect(t.acts.map((a) => [a.act, a.target, a.at])).toEqual([
      ['beam-in', 'x', 12.5],
      ['beam-in', 'y', 13],
      ['beam-in', 'z', 13.5],
      ['say', 'x', 13.5],
    ]);
    expect(t.acts[3].params).toEqual({ line: 'hi' });
    expect(t.acts[0].params).toEqual({ gap: 0.5 });
  });

  it('pairs a list of times with a list of targets', () => {
    const t = compilePlan(plan([{ id: 'a', span: ['r1', 'r2'], camera: {}, do: [{ at: ['r1', 'r1.all'], act: 'glow', what: ['p1', 'p2'] }] }]));
    expect(t.acts.map((a) => [a.target, a.at])).toEqual([['p1', 10], ['p2', 12.5]]);
  });

  it('refuses shots that leave gaps or end before they start', () => {
    expect(() => compilePlan(plan([{ id: 'a', span: ['r1', 'r1.all'], camera: {} }, { id: 'b', span: ['r2', 'r2.end'], camera: {} }]))).toThrow(/uncovered/);
    expect(() => compilePlan(plan([{ id: 'a', span: ['r2', 'r1'], camera: {} }]))).toThrow(/ends .* before it starts/);
  });

  it('puts a move on the camera track, from its start to where it ends', () => {
    const t = compilePlan(plan([{ id: 'a', span: ['r1', 'r2'], camera: { size: 'MS', angle: [20, -6], move: { kind: 'push-in', to: 'MCU', at: 'r1.all', over: 3 } } }]));
    const keys = t.shots[0].keys;
    expect(keys.map((k) => [k.at, k.framing.size])).toEqual([[10, 'MS'], [12.5, 'MS'], [15.5, 'MCU']]);
    expect(trackAt(keys, 11)).toMatchObject({ from: { size: 'MS' }, to: { size: 'MS' } });
    expect(trackAt(keys, 14).to.size).toBe('MCU');
    expect(trackAt(keys, 14.5).k).toBeGreaterThan(0.5);
  });

  it('reads the episode’s plan', () => {
    const raw = parse(readFileSync(path.join(import.meta.dirname, '../scenes/delegation.plan.yaml'), 'utf8')) as unknown;
    const t = compilePlan(readPlan(raw));
    expect(t.duration).toBeGreaterThan(120);
    expect(t.shots.length).toBeGreaterThan(15);
    expect(t.acts.length).toBeGreaterThan(40);
  });
});

describe('moveTarget', () => {
  it('changes only what the move changes', () => {
    const from = { size: 'MS', angle: [20, -6] as [number, number], fov: 35, on: { lead: [0.3, 0.6] as [number, number] } };
    expect(moveTarget(from, { kind: 'orbit', by: 30 }).angle).toEqual([50, -6]);
    expect(moveTarget(from, { kind: 'push-in', to: 'MCU' })).toMatchObject({ size: 'MCU', fov: 35 });
    expect(moveTarget(from, { kind: 'crane', to: { angle: [0, -38], size: 'LS' } })).toMatchObject({ size: 'LS', angle: [0, -38], fov: 35 });
    expect(() => moveTarget(from, { kind: 'push-in', to: 'HUGE' })).toThrow(/sizes are/);
  });
});
