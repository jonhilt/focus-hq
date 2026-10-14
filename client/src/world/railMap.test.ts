import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowRollEntry } from '../../../shared/types';
import { BUNDLE, itemOf, railMap, stopState } from './railMap';

const phase = (index: number, title: string) => ({ index, title, queued: 0, working: 0, done: 0, failed: 0 });
const run = (roll: WorkflowRollEntry[], extra: Partial<Workflow> = {}): Pick<Workflow, 'phases' | 'plan' | 'roll' | 'status'> =>
  ({ status: 'running', phases: [phase(1, 'Review'), phase(2, 'Verify')], roll, ...extra });
const agent = (label: string, p: number, status: WorkflowRollEntry['status'] = 'done'): WorkflowRollEntry => ({ label, phase: p, status });

describe('itemOf', () => {
  it('is the label after its first colon, or the whole label', () => {
    expect(itemOf('verify:server/store.ts')).toBe('server/store.ts');
    expect(itemOf('scan:a:b')).toBe('a:b');
    expect(itemOf('summary')).toBe('summary');
  });
});

describe('stopState', () => {
  it('is failed if any failed, at work while any are, done once all are, and queued otherwise', () => {
    expect(stopState([])).toBe('none');
    expect(stopState(['done', 'failed'])).toBe('failed');
    expect(stopState(['done', 'working'])).toBe('working');
    expect(stopState(['done', 'done'])).toBe('done');
    expect(stopState(['done', 'queued'])).toBe('queued');
  });
});

describe('railMap', () => {
  it('runs each item on a track of its own through the phases that share it', () => {
    const map = railMap(run([agent('review:perf', 1), agent('review:bugs', 1), agent('verify:perf', 2, 'working')]));
    expect(map.sections).toHaveLength(1);
    const [section] = map.sections;
    expect(section?.stations.map((s) => s.title)).toEqual(['Review', 'Verify']);
    expect(section?.tracks.map((t) => [t.item, t.stops.map((s) => s.state)])).toEqual([['perf', ['done', 'working']], ['bugs', ['done', 'none']]]);
  });

  it('stops an item’s track where it failed', () => {
    const [track] = railMap(run([agent('review:style', 1, 'failed')])).sections[0]?.tracks ?? [];
    expect(track).toMatchObject({ failedAt: 0, through: false });
  });

  it('brings a track through once every station has it done, or once the workflow is over, every one it reached', () => {
    const tracks = (wf: ReturnType<typeof run>) => railMap(wf).sections[0]?.tracks.map((t) => [t.item, t.through]);
    const roll = [agent('review:perf', 1), agent('verify:perf', 2), agent('review:bugs', 1)];
    expect(tracks(run(roll))).toEqual([['perf', true], ['bugs', false]]);
    expect(tracks(run(roll, { status: 'done' }))).toEqual([['perf', true], ['bugs', true]]);
  });

  it('starts a new section where a phase shares no items with the one before', () => {
    const map = railMap(run([agent('scan:views', 1), agent('fan:0', 2), agent('fan:1', 2)], { phases: [phase(1, 'Scan'), phase(2, 'Fan')] }));
    expect(map.sections.map((s) => [s.stations.map((x) => x.title), s.tracks.map((t) => t.item)])).toEqual([[['Scan'], ['views']], [['Fan'], ['0', '1']]]);
  });

  it('bundles a section of more than BUNDLE items into one line, carrying on past failures and counting each agent', () => {
    const roll = Array.from({ length: BUNDLE + 4 }, (_, i) => agent(`fan:${i}`, 1, i === 3 ? 'failed' : i < 6 ? 'done' : 'queued'));
    const [track, ...rest] = railMap(run(roll, { phases: [phase(1, 'Fan')] })).sections[0]?.tracks ?? [];
    expect(rest).toHaveLength(0);
    expect(track).toMatchObject({ item: String(BUNDLE + 4), bundle: true, failedAt: -1 });
    expect(track?.stops[0]?.agents).toHaveLength(BUNDLE + 4);
  });

  it('shows the phases the script plans but hasn’t reached, as empty stations', () => {
    const map = railMap(run([agent('scan:views', 1, 'working')], { phases: [phase(1, 'Scan')], plan: [{ title: 'Scan' }, { title: 'Summarise' }] }));
    expect(map.sections.map((s) => [s.stations.map((x) => x.title), s.tracks.length])).toEqual([[['Scan'], 1], [['Summarise'], 0]]);
  });

  it('names a child workflow’s station without its marker, in lilac', () => {
    const map = railMap(run([agent('child:1', 1)], { phases: [{ ...phase(1, '▸ summarise'), child: true }] }));
    expect(map.sections[0]?.stations[0]).toEqual({ index: 1, title: 'summarise', colour: 'lilac' });
  });
});
