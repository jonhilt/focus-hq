import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { beatSheet, cueMet, helperTag, modelLabel, readScene, seededRandom, stamp } from './studio';
import type { Agent } from './types';
import { SCENARIOS } from './scenarios';

const lead = (over: Partial<Agent>): Agent => ({ status: 'working', helpers: [], lead: { prs: [] }, ...over }) as unknown as Agent;
const beat = { title: 'Open', caption: 'The bridge' };

describe('readScene', () => {
  it('reads the subagents episode', () => {
    const scene = readScene(parse(readFileSync(path.join(import.meta.dirname, '../scenes/subagents.yaml'), 'utf8')));
    expect(scene.beats.length).toBeGreaterThan(4);
    expect(scene.beats.some((b) => b.insert === 'explainer')).toBe(true);
    expect(scene.explainer?.beats.length).toBeGreaterThanOrEqual(2);
    expect(scene.scenario).toBe('subagents');
  });

  it('has a scene for every scenario the training console offers, and every scene reads', () => {
    const dir = path.join(import.meta.dirname, '../scenes');
    const scenes = readdirSync(dir).filter((f) => /^[^.]+\.yaml$/.test(f)).map((f) => readScene(parse(readFileSync(path.join(dir, f), 'utf8'))));
    expect(new Set(scenes.map((s) => s.scenario))).toEqual(new Set(SCENARIOS));
  });

  it('fills in a beat’s hold and the scene’s pacing', () => {
    const scene = readScene({ title: 'T', goal: 'G', beats: [beat] });
    expect(scene.beats[0].hold).toBe(4);
    expect(scene).toMatchObject({ speed: 1, seed: 1, project: 'Sock Shop', scenario: 'full' });
  });

  it('names what’s wrong', () => {
    expect(() => readScene({ title: 'T', goal: 'G', beats: [{ ...beat, shot: 'sky' }] })).toThrow(/Beat 1's shot is "sky"/);
    expect(() => readScene({ title: 'T', goal: 'G', beats: [{ ...beat, do: 'reply' }] })).toThrow(/needs what to say/);
    expect(() => readScene({ title: 'T', goal: 'G', beats: [{ ...beat, insert: 'explainer' }] })).toThrow(/has none/);
    expect(() => readScene({ title: 'T', goal: 'G', scenario: 'everything', beats: [beat] })).toThrow(/scenario is "everything"/);
  });

  it('starts the goal before anything waits on its lead', () => {
    expect(() => readScene({ title: 'T', goal: 'G', beats: [{ ...beat, until: 'lead-idle' }, { ...beat, do: 'start-goal' }] })).toThrow(/goal has to start/);
  });
});

describe('cueMet', () => {
  it('waits for a lead to exist', () => {
    expect(cueMet('lead-working', undefined)).toBe(false);
  });

  it('tells working from idle', () => {
    expect(cueMet('lead-working', lead({ status: 'working' }))).toBe(true);
    expect(cueMet('lead-idle', lead({ status: 'working' }))).toBe(false);
    expect(cueMet('lead-idle', lead({ status: 'done' }))).toBe(true);
    expect(cueMet('lead-idle', lead({ status: 'queued' }))).toBe(false);
  });

  it('follows the helpers', () => {
    const working = { id: 'h', description: '', status: 'working' as const, activity: '', startedAt: 0 };
    expect(cueMet('helpers-working', lead({ helpers: [working] }))).toBe(true);
    expect(cueMet('helpers-done', lead({ helpers: [] }))).toBe(false);
    expect(cueMet('helpers-done', lead({ helpers: [working, { ...working, status: 'done' }] }))).toBe(false);
    expect(cueMet('helpers-done', lead({ helpers: [{ ...working, status: 'done' }] }))).toBe(true);
  });

  it('follows the workflows', () => {
    const running = { id: 'w', name: 'review-slice', description: '', status: 'running' as const, phases: [], agents: [], startedAt: 0 };
    expect(cueMet('workflows-running', lead({ workflows: [running] }))).toBe(true);
    expect(cueMet('workflows-done', lead({ workflows: [] }))).toBe(false);
    expect(cueMet('workflows-done', lead({ workflows: [running, { ...running, status: 'done' }] }))).toBe(false);
    expect(cueMet('workflows-done', lead({ workflows: [{ ...running, status: 'done' }, { ...running, status: 'failed' }] }))).toBe(true);
  });

  it('knows when the slice has shipped', () => {
    expect(cueMet('shipped', lead({}))).toBe(false);
    expect(cueMet('shipped', lead({ lead: { prs: [{}] } as unknown as Agent['lead'] }))).toBe(true);
  });
});

describe('labels', () => {
  it('says models as people do', () => {
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4');
    expect(modelLabel(undefined)).toBeUndefined();
  });

  it('tags a helper with what it is', () => {
    expect(helperTag({ type: 'Explore', model: 'claude-haiku-4-5-20251001', effort: 'high' })).toBe('Explore subagent · Haiku 4.5 · high effort');
    expect(helperTag({})).toBe('general-purpose subagent');
  });
});

describe('beatSheet', () => {
  it('lists each beat at its time in the cut', () => {
    const scene = readScene({ title: 'Ep', goal: 'G', beats: [beat, { ...beat, title: 'Next', caption: 'a | b' }] });
    const sheet = beatSheet(scene, [{ start: 0, length: 6.2 }, { start: 66, length: 4 }]);
    expect(sheet).toContain('Rough cut: 1:10');
    expect(sheet).toContain('| 0:00 | 6s | Open | The bridge |');
    expect(sheet).toContain('| 1:06 | 4s | Next | a \\| b |');
  });

  it('stamps minutes and seconds', () => {
    expect(stamp(0)).toBe('0:00');
    expect(stamp(125.4)).toBe('2:05');
  });
});

describe('seededRandom', () => {
  it('rolls the same from the same seed, and differently from another', () => {
    const roll = (seed: number) => { const r = seededRandom(seed); return [r(), r(), r()]; };
    expect(roll(7)).toEqual(roll(7));
    expect(roll(7)).not.toEqual(roll(8));
    expect(roll(7).every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
