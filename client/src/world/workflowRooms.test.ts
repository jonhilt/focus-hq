import { describe, expect, it } from 'vitest';
import type { WorkflowPhase } from '../../../shared/types';
import {
  assignRooms, barSegments, bufferGlow, bufferLine, elapsed, feedCaption, PAD_COUNT, type PadAgent, type PadOccupant, phaseColour,
  plannedPhases, runningLines, scriptWindow, shortCount, standOnPads, tacticalSummary, usageLine, waitingLine,
} from './workflowRooms';

const wf = (id: string, startedAt: number) => ({ id, startedAt });

describe('assignRooms', () => {
  it('gives each workflow a room, the longest running first', () => {
    expect(assignRooms([undefined, undefined, undefined], [wf('b', 2), wf('a', 1)])).toEqual({ rooms: ['a', 'b', undefined], waiting: [] });
  });

  it('keeps each workflow in its room, and a newcomer takes the first one free', () => {
    expect(assignRooms(['a', 'b', 'c'], [wf('c', 3), wf('d', 4), wf('a', 1)])).toEqual({ rooms: ['a', 'd', 'c'], waiting: [] });
  });

  it('has a fourth wait for a room, and gives it the next one to come free', () => {
    const first = assignRooms([undefined, undefined, undefined], [wf('a', 1), wf('b', 2), wf('c', 3), wf('d', 4), wf('e', 5)]);
    expect(first).toEqual({ rooms: ['a', 'b', 'c'], waiting: ['d', 'e'] });
    expect(assignRooms(first.rooms, [wf('a', 1), wf('c', 3), wf('d', 4), wf('e', 5)])).toEqual({ rooms: ['a', 'd', 'c'], waiting: ['e'] });
  });
});

const empty = (): (PadOccupant | undefined)[] => Array.from({ length: PAD_COUNT }, () => undefined);
const agent = (key: string, phase: number, status: PadAgent['status'] = 'working'): PadAgent => ({ key, phase, status });
const where = (pads: (PadOccupant | undefined)[], key: string) => pads.findIndex((o) => o?.key === key);

describe('standOnPads', () => {
  it('puts those at work on pads, the front tier from the middle first, and leaves the queued in the buffer', () => {
    const pads = standOnPads(empty(), [agent('w:1', 1), agent('w:2', 1, 'queued')], 0);
    expect(where(pads, 'w:1')).toBe(2);
    expect(where(pads, 'w:2')).toBe(-1);
  });

  it('keeps everyone on the pad they took', () => {
    const first = standOnPads(empty(), [agent('w:1', 1), agent('w:2', 1)], 0);
    const next = standOnPads(first, [agent('w:3', 1), agent('w:2', 1)], 1000);
    expect(where(next, 'w:2')).toBe(where(first, 'w:2'));
    expect(where(next, 'w:1')).toBe(-1);
  });

  it('stands an agent beside the others of its phase, and a new phase apart from them', () => {
    let pads = standOnPads(empty(), [agent('w:1', 1), agent('w:2', 1)], 0);
    pads = standOnPads(pads, [agent('w:1', 1), agent('w:2', 1), agent('w:3', 2), agent('w:4', 2), agent('w:5', 1)], 0);
    const slot = (k: string) => ({ tier: Math.floor(where(pads, k) / 6), slot: where(pads, k) % 6 });
    // phase 1 together on the front tier, phase 2 off at the back
    expect(slot('w:5').tier).toBe(0);
    expect(slot('w:3').tier).toBe(2);
    expect(Math.abs(slot('w:4').slot - slot('w:3').slot) + Math.abs(slot('w:4').tier - slot('w:3').tier)).toBe(1);
  });

  it('lets the finished linger in their pose, then beam out', () => {
    const at0 = standOnPads(empty(), [agent('w:1', 1)], 0);
    const done = standOnPads(at0, [agent('w:1', 1, 'done')], 500);
    expect(done[where(at0, 'w:1')]).toEqual({ key: 'w:1', phase: 1, status: 'done', finishedAt: 500 });
    expect(standOnPads(done, [agent('w:1', 1, 'done')], 2000)[where(at0, 'w:1')]?.status).toBe('done');
    expect(where(standOnPads(done, [agent('w:1', 1, 'done')], 2500), 'w:1')).toBe(-1);
  });

  it('never gives a pad to one that started and finished between looks', () => {
    expect(where(standOnPads(empty(), [agent('w:1', 1, 'failed')], 0), 'w:1')).toBe(-1);
  });

  it('keeps off closed pads', () => {
    const closed = [true, true, true];
    expect(where(standOnPads(empty(), [agent('w:1', 1)], 0, closed), 'w:1')).toBe(3);
  });

  it('never stands more than 18, and the finished make way for those at work', () => {
    const many = Array.from({ length: 20 }, (_, i) => agent(`w:${i}`, 1));
    const full = standOnPads(empty(), many, 0);
    expect(full.filter(Boolean)).toHaveLength(PAD_COUNT);
    expect(full).toHaveLength(PAD_COUNT);
    // one finishes; the two still waiting want its pad: it goes at once, and its pad's free once it's beamed out
    const finished = many.map((a, i) => (i === 0 ? { ...a, status: 'done' as const } : a));
    const pad = where(full, 'w:0');
    const making = standOnPads(full, finished, 100);
    expect(where(making, 'w:0')).toBe(-1);
    expect(where(making, 'w:18')).toBe(-1);
    const closed = making.map((_, i) => i === pad);
    expect(where(standOnPads(making, finished, 1000, closed), 'w:18')).toBe(-1);
    expect(where(standOnPads(making, finished, 3000), 'w:18')).toBe(pad);
  });
});

describe('phaseColour', () => {
  it('goes through the LCARS palette by phase, a child workflow in lilac', () => {
    expect(phaseColour({ index: 1 })).toBe('sky');
    expect(phaseColour({ index: 2 })).toBe('orange');
    expect(phaseColour({ index: 0 })).toBe('sky');
    expect(phaseColour({ index: 6 })).toBe('sky');
    expect(phaseColour({ index: 4, child: true })).toBe('lilac');
  });
});

const phase = (index: number, title: string, c: Partial<WorkflowPhase> = {}): WorkflowPhase => ({ index, title, queued: 0, working: 0, done: 0, failed: 0, ...c });

describe('tacticalSummary', () => {
  const run = {
    name: 'review-slice',
    status: 'running' as const,
    startedAt: 1000,
    phases: [phase(1, 'Scan', { done: 5, failed: 1 }), phase(2, 'Check', { working: 2, done: 4 }), phase(3, 'Fan', { queued: 18, working: 6 }), phase(4, '▸ summarise', { child: true })],
  };

  it('has a row per phase in its colour, and the totals', () => {
    const s = tacticalSummary(run, 126_000);
    expect(s.elapsed).toBe('2:05');
    expect(s.rows.map((r) => [r.title, r.colour, r.total])).toEqual([['Scan', 'sky', 6], ['Check', 'orange', 6], ['Fan', 'gold', 24], ['▸ summarise', 'lilac', 0]]);
    expect(s.totals).toEqual({ queued: 18, working: 8, done: 9, failed: 1, total: 36 });
  });

  it('stops the clock once the workflow ends', () => {
    expect(tacticalSummary(run, 900_000, 61_000).elapsed).toBe('1:00');
  });

  it('adds the phases the script plans but hasn’t reached, with their details', () => {
    const s = tacticalSummary({ ...run, phases: run.phases.slice(0, 1), plan: [{ title: 'Scan', detail: 'one per area' }, { title: 'Check', detail: 'confirm it' }] }, 2000);
    expect(s.rows.map((r) => [r.index, r.title, r.detail, r.total])).toEqual([[1, 'Scan', 'one per area', 6], [2, 'Check', 'confirm it', 0]]);
  });
});

describe('plannedPhases', () => {
  it('numbers a planned phase by its place in the plan, or after the rest when that’s taken', () => {
    const phases = [phase(1, 'Review'), phase(2, 'Extra')];
    expect(plannedPhases({ phases, plan: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Write' }] }).map((p) => [p.index, p.title])).toEqual([[1, 'Review'], [2, 'Extra'], [3, 'Write'], [4, 'Verify']]);
  });

  it('is the phases as they are without a plan', () => {
    const phases = [phase(1, 'Review')];
    expect(plannedPhases({ phases })).toEqual(phases);
  });
});

describe('runningLines', () => {
  const script = [
    "export const meta = { name: 'r', phases: [{ title: 'Review' }, { title: 'Verify' }] }",
    "phase('Review')",
    'const out = await pipeline(DIMS,',
    '  d => agent(d.prompt, { label: `review:${d.key}` }),',
    "  r => agent(check(r), { label: 'verify', phase: 'Verify' }))",
    "phase('Write')",
  ].join('\n');
  const agent = (label: string, phase: number, status: 'working' | 'done' = 'working') => ({ index: 1, label, phase, status, activity: '' });

  it('lights where the script named a phase at work, and where it labels an agent at work, with its phase', () => {
    const lit = runningLines(script, { phases: [phase(1, 'Review', { working: 1 }), phase(2, 'Verify', { working: 1 })], agents: [agent('review:bugs', 1), agent('verify', 2)] });
    expect([...lit]).toEqual([[1, 1], [3, 1], [4, 2]]);
  });

  it('lights nothing when nobody’s at work, or a label only something else starts with', () => {
    expect(runningLines(script, { phases: [phase(1, 'Review', { done: 1 })], agents: [agent('review:bugs', 1, 'done')] }).size).toBe(0);
    expect([...runningLines(script, { phases: [phase(1, 'Other', { working: 1 })], agents: [agent('verify:x', 1)] })]).toEqual([]);
  });
});

describe('scriptWindow', () => {
  it('starts at the top with nothing running, and puts the first running line a third of the way down otherwise', () => {
    expect(scriptWindow(100, [], 12)).toBe(0);
    expect(scriptWindow(100, [40, 41], 12)).toBe(36);
    expect(scriptWindow(100, [2], 12)).toBe(0);
    expect(scriptWindow(100, [98], 12)).toBe(88);
    expect(scriptWindow(5, [4], 12)).toBe(0);
  });
});

describe('usageLine', () => {
  it('counts tokens short, and says nothing before there’s any', () => {
    expect([412, 4120, 41_200, 4_120_000].map(shortCount)).toEqual(['412', '4.1K', '41K', '4.1M']);
    expect(usageLine({ tokens: 783_805, toolUses: 328 })).toBe('784K tokens · 328 tool calls');
    expect(usageLine(undefined)).toBe('');
  });
});

describe('elapsed', () => {
  it('reads m:ss, and h:mm:ss past the hour', () => {
    expect(elapsed(0)).toBe('0:00');
    expect(elapsed(59_999)).toBe('0:59');
    expect(elapsed(3_723_000)).toBe('1:02:03');
  });
});

describe('barSegments', () => {
  it('lays done, failed, working and queued from the left, against the biggest phase', () => {
    expect(barSegments({ done: 2, failed: 1, working: 1, queued: 0 }, 8)).toEqual([
      { kind: 'done', from: 0, to: 0.25 },
      { kind: 'failed', from: 0.25, to: 0.375 },
      { kind: 'working', from: 0.375, to: 0.5 },
    ]);
    expect(barSegments({ done: 0, failed: 0, working: 0, queued: 0 }, 0)).toEqual([]);
  });
});

describe('feeds and the buffer', () => {
  it('captions a feed with its workflow and how it stands, or standing by', () => {
    expect(feedCaption(0, undefined)).toEqual({ title: 'Transporter room 1', line: 'Standing by' });
    const phases = [phase(1, 'Map', { working: 2, done: 1 }), phase(2, 'Fan', { queued: 3, failed: 1 })];
    expect(feedCaption(1, { name: 'map-repos', status: 'running', phases }).line).toBe('map-repos · 2 running · 3 queued · 1 done · 1 failed');
    expect(feedCaption(2, { name: 'map-repos', status: 'done', phases: [phase(1, 'Map', { done: 3 })] }).line).toBe('map-repos · Complete · 3 done');
  });

  it('says how many workflows wait for a room', () => {
    expect(waitingLine(0)).toBe('');
    expect(waitingLine(2)).toBe('2 more waiting for a transporter room');
  });

  it('counts the patterns held, and glows brighter the more it holds', () => {
    expect(bufferLine(24)).toBe('Pattern buffer · 24 held');
    expect(bufferLine(0)).toBe('Pattern buffer · clear');
    expect(bufferGlow(0, 1)).toBeLessThan(bufferGlow(2, 0));
    expect(bufferGlow(2, 0)).toBeLessThan(bufferGlow(24, 0));
    expect(bufferGlow(100, 0.3)).toBeLessThanOrEqual(1);
  });
});
