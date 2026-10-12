import { describe, expect, it } from 'vitest';
import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import type { LeadWork } from '../../shared/types';
import { type ChecklistItem, type ChecklistSource, checklistHooks, checklistReminder, checklistState, checklistStopReason, sessionHooks } from './checklist';
import { checklistWaypoint, committedWaypoint, nudgedWaypoint } from './waypoints';

const items = (...done: boolean[]): ChecklistItem[] => done.map((d, i) => ({ text: `item ${i + 1}`, done: d }));
const base = { session_id: 's', transcript_path: '/t', cwd: '/w' };
const post = (tool_name: string, tool_input: unknown, agent_id?: string) =>
  ({ ...base, hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response: {}, tool_use_id: 'u', ...(agent_id && { agent_id }) }) as HookInput;
const stop = (stop_hook_active = false) => ({ ...base, hook_event_name: 'Stop', stop_hook_active }) as HookInput;

/**
 * A lead as the office keeps it: commits counted on the slice's waypoint as their results come in, the checklist sent
 * with the note tool, and a nudge recorded when the Stop hook holds the lead up. Each `checklistHooks` is one turn.
 */
function office(list: ChecklistItem[]) {
  let work: Pick<LeadWork, 'note' | 'slice' | 'waypoints'> = { slice: 1, note: { done: '', slice: list, learned: [], next: [] } };
  const source: ChecklistSource = {
    read: () => checklistState(work),
    nudged: () => (work = { ...work, waypoints: nudgedWaypoint(work, 0) }),
  };
  return {
    source,
    commit: () => (work = { ...work, waypoints: committedWaypoint(work, 'x', 0) }),
    note: (slice: ChecklistItem[]) => (work = { ...work, note: { ...work.note!, slice }, waypoints: checklistWaypoint(work, 0) }),
    nextSlice: () => (work = { ...work, slice: work.slice + 1 }),
  };
}

/** Runs `input` through every hook the matcher for its tool (or the Stop hook) has, as Claude Code would. */
async function fire(hooks: ReturnType<typeof checklistHooks>, input: HookInput) {
  const matchers = input.hook_event_name === 'Stop' ? hooks.Stop! : hooks.PostToolUse!.filter((m) => m.matcher === (input as { tool_name: string }).tool_name);
  const signal = new AbortController().signal;
  const out = await Promise.all(matchers.flatMap((m) => m.hooks.map((h: HookCallback) => h(input, undefined, { signal }))));
  return Object.assign({}, ...out) as { decision?: string; reason?: string; hookSpecificOutput?: { additionalContext?: string } };
}

describe('checklistReminder', () => {
  it('lists only the unticked items', () => {
    const text = checklistReminder(items(true, false, false), 'commit')!;
    expect(text).toContain('That commit landed');
    expect(text).toContain('2 unticked');
    expect(text).toContain('- item 2\n- item 3');
    expect(text).not.toContain('item 1');
    expect(text).toContain('mcp__office__note');
  });

  it('says the slice shipped after a ship', () => {
    expect(checklistReminder(items(false), 'ship')).toMatch(/^You shipped the slice/);
  });

  it('stays quiet with nothing to tick: all done, or no checklist', () => {
    expect(checklistReminder(items(true, true), 'commit')).toBeUndefined();
    expect(checklistReminder([], 'ship')).toBeUndefined();
  });
});

const state = (done: boolean[], commits: number, checklistAt = 0, nudgedAt = 0) => ({ items: items(...done), commits, checklistAt, nudgedAt });

describe('checklistStopReason', () => {
  it('blocks when commits landed since the checklist changed and items are open', () => {
    expect(checklistStopReason(state([true, false], 2))).toMatch(/^2 commits have landed.*1 unticked:\n- item 2/s);
    expect(checklistStopReason(state([false], 3, 2))).toMatch(/^1 commit has landed/);
  });

  it('lets the lead stop with no commits since the checklist changed, or nothing open', () => {
    expect(checklistStopReason(state([false], 0))).toBeUndefined();
    expect(checklistStopReason(state([false], 2, 2))).toBeUndefined();
    expect(checklistStopReason(state([true], 3))).toBeUndefined();
    expect(checklistStopReason(state([], 3))).toBeUndefined();
  });

  it('holds the lead up once for the same commits, and again after new ones, counting from the checklist', () => {
    expect(checklistStopReason(state([false], 2, 0, 2))).toBeUndefined();
    expect(checklistStopReason(state([false], 3, 0, 2))).toMatch(/^3 commits have landed/);
  });
});

describe('checklistState', () => {
  it("reads the slice under way's waypoint, not an earlier one", () => {
    const work = { slice: 2, note: { done: '', slice: items(false), learned: [], next: [] }, waypoints: [{ slice: 1, startedAt: 0, commits: 5 }, { slice: 2, startedAt: 0, commits: 2, checklistAt: 1, nudgedAt: 2 }] };
    expect(checklistState(work)).toEqual({ items: items(false), commits: 2, checklistAt: 1, nudgedAt: 2 });
  });

  it('starts from nothing without a note or waypoints', () => {
    expect(checklistState(undefined)).toEqual({ items: [], commits: 0, checklistAt: 0, nudgedAt: 0 });
    expect(checklistState({ slice: 1 })).toEqual({ items: [], commits: 0, checklistAt: 0, nudgedAt: 0 });
  });
});

describe('checklistHooks', () => {
  it('reminds the lead after a commit, and not after other commands', async () => {
    const hooks = checklistHooks(office(items(false)).source);
    expect((await fire(hooks, post('Bash', { command: 'git add -A && git commit -m "Do it"' }))).hookSpecificOutput?.additionalContext).toContain('That commit landed');
    expect(await fire(hooks, post('Bash', { command: 'git status' }))).toEqual({});
    expect(await fire(hooks, post('Bash', { command: 'git commit --amend --no-edit' }))).toEqual({});
  });

  it('reminds after a ship', async () => {
    const hooks = checklistHooks(office(items(false)).source);
    expect((await fire(hooks, post('mcp__office__ship', { title: 't', summary: 's' }))).hookSpecificOutput?.additionalContext).toMatch(/^You shipped/);
  });

  it("doesn't remind a helper", async () => {
    const hooks = checklistHooks(office(items(false)).source);
    expect(await fire(hooks, post('Bash', { command: 'git commit -m x' }, 'helper-1'))).toEqual({});
    expect(await fire(hooks, post('mcp__office__ship', {}, 'helper-1'))).toEqual({});
  });

  it('blocks the stop once for the commits, then lets it go', async () => {
    const lead = office(items(true, false));
    const hooks = checklistHooks(lead.source);
    expect(await fire(hooks, stop())).toEqual({});
    lead.commit();
    const blocked = await fire(hooks, stop());
    expect(blocked.decision).toBe('block');
    expect(blocked.reason).toContain('1 commit has landed');
    expect(await fire(hooks, stop())).toEqual({});
  });

  it('sees commits from an earlier turn, and holds up a later turn only for new ones', async () => {
    const lead = office(items(false));
    lead.commit();
    expect(await fire(checklistHooks(lead.source), stop(true))).toEqual({}); // turn 1: Claude Code already carried on
    expect((await fire(checklistHooks(lead.source), stop())).decision).toBe('block'); // turn 2 sees turn 1's commit
    expect(await fire(checklistHooks(lead.source), stop())).toEqual({}); // turn 3: nothing new
    lead.commit();
    expect((await fire(checklistHooks(lead.source), stop())).reason).toContain('2 commits have landed');
  });

  it('lets the lead stop once it sends the checklist, and starts again on a new slice', async () => {
    const lead = office(items(false, false));
    lead.commit();
    lead.note(items(true, false));
    const hooks = checklistHooks(lead.source);
    expect(await fire(hooks, stop())).toEqual({});
    lead.commit();
    expect((await fire(hooks, stop())).decision).toBe('block');
    lead.nextSlice();
    expect(await fire(hooks, stop())).toEqual({});
  });
});

describe('sessionHooks', () => {
  const guard: HookCallback = () => Promise.resolve({});

  it("gives a lead the scratch guard and the checklist's hooks", () => {
    const hooks = sessionHooks(guard, office([]).source);
    expect(hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [guard] }]);
    expect(hooks.PostToolUse?.map((m) => m.matcher)).toEqual(['Bash', 'mcp__office__ship']);
    expect(hooks.Stop).toHaveLength(1);
  });

  it('gives anyone else only the scratch guard', () => {
    expect(sessionHooks(guard, undefined)).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [guard] }] });
    expect(sessionHooks(undefined, undefined)).toEqual({});
  });
});
