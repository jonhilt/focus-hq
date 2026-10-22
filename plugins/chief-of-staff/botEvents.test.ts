import { describe, expect, it } from 'vitest';
import { botEvents, heard, shownBy } from './botEvents';
import type { Agent } from '../../plugin-api/shared';
import type { DecisionEvent, InboxItem } from './inbox';

const item = (id: string, lane: InboxItem['lane'] = 'needs-you'): InboxItem => ({ id, kind: 'turn', projectId: 'p', agentId: 'a', who: 'Lt. Reyes', goal: 'Saved items', what: 'Slice 2?', lane });
const lead = (artifacts: { id: string; at: number; image?: boolean }[]) =>
  ({ id: 'a', name: 'Lt. Reyes', projectId: 'p', task: 'lead', issue: { title: 'Saved items' }, lead: { title: 'Saved items', artifacts: artifacts.map((a) => ({ title: `The ${a.id}`, ...a })) } }) as unknown as Agent;
const seen = (items: InboxItem[], leads: Agent[] = []) => ({ items: heard(items), shown: shownBy(leads) });
const decision = (id: string) => ({ kind: 'captain-decision', at: 1, agent: 'Lt. Reyes', item: { id, kind: 'turn', what: 'Slice 2?' }, answer: 'Yes', via: 'office' }) as DecisionEvent;

describe('botEvents', () => {
  it('tells of an item once it needs the captain, or has words ready, but not while the chief of staff reads it', () => {
    expect(botEvents(seen([]), seen([item('t1', 'judging')]), [], [])).toEqual([]);
    expect(botEvents(seen([item('t1', 'judging')]), seen([item('t1', 'needs-you')]), [], [])).toEqual([{ event: 'item-opened', item: item('t1') }]);
    expect(botEvents(seen([]), seen([item('t2', 'ready')]), [], [])).toEqual([{ event: 'item-opened', item: item('t2', 'ready') }]);
    expect(botEvents(seen([item('t1')]), seen([item('t1')]), [], [])).toEqual([]);
  });

  it('tells an item decided, with the decision, from one withdrawn', () => {
    expect(botEvents(seen([item('t1'), item('t2')]), seen([]), [decision('t1')], [])).toEqual([
      { event: 'item-closed', id: 't1', how: 'decided', decision: decision('t1') },
      { event: 'item-closed', id: 't2', how: 'withdrawn' },
    ]);
  });

  it('tells of what a lead shows, again when it’s shown again, with its page and picture', () => {
    const before = [lead([{ id: 'flow', at: 1 }])];
    const after = [lead([{ id: 'flow', at: 1 }, { id: 'mockup', at: 5, image: true }])];
    expect(botEvents(seen([], before), seen([], after), [], after)).toEqual([
      { event: 'shown', projectId: 'p', agentId: 'a', who: 'Lt. Reyes', goal: 'Saved items', title: 'The mockup', html: '/api/artifacts/a/mockup.html?v=5', image: '/api/artifacts/a/mockup.jpg?v=5' },
    ]);
    const again = [lead([{ id: 'flow', at: 9 }, { id: 'mockup', at: 5, image: true }])];
    expect(botEvents(seen([], after), seen([], again), [], again).map((e) => e.event === 'shown' && e.title)).toEqual(['The flow']);
  });
});
