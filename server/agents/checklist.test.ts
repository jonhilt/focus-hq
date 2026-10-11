import { describe, expect, it } from 'vitest';
import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { type ChecklistItem, checklistHooks, checklistReminder, checklistStopReason } from './checklist';

const items = (...done: boolean[]): ChecklistItem[] => done.map((d, i) => ({ text: `item ${i + 1}`, done: d }));
const base = { session_id: 's', transcript_path: '/t', cwd: '/w' };
const post = (tool_name: string, tool_input: unknown, agent_id?: string) =>
  ({ ...base, hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response: {}, tool_use_id: 'u', ...(agent_id && { agent_id }) }) as HookInput;
const stop = (stop_hook_active = false) => ({ ...base, hook_event_name: 'Stop', stop_hook_active }) as HookInput;

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

describe('checklistStopReason', () => {
  it('blocks when commits landed since the checklist changed and items are open', () => {
    expect(checklistStopReason(items(true, false), 2, false)).toMatch(/^2 commits have landed.*1 unticked:\n- item 2/s);
    expect(checklistStopReason(items(false), 1, false)).toMatch(/^1 commit has landed/);
  });

  it('lets the lead stop with no commits since, nothing open, or once it has blocked', () => {
    expect(checklistStopReason(items(false), 0, false)).toBeUndefined();
    expect(checklistStopReason(items(true), 3, false)).toBeUndefined();
    expect(checklistStopReason([], 3, false)).toBeUndefined();
    expect(checklistStopReason(items(false), 3, true)).toBeUndefined();
  });
});

describe('checklistHooks', () => {
  it('reminds the lead after a commit that worked, and not after other commands', async () => {
    const hooks = checklistHooks(() => items(false));
    expect((await fire(hooks, post('Bash', { command: 'git add -A && git commit -m "Do it"' }))).hookSpecificOutput?.additionalContext).toContain('That commit landed');
    expect(await fire(hooks, post('Bash', { command: 'git status' }))).toEqual({});
    expect(await fire(hooks, post('Bash', { command: 'git commit --amend --no-edit' }))).toEqual({});
  });

  it('reminds after a ship', async () => {
    const hooks = checklistHooks(() => items(false));
    expect((await fire(hooks, post('mcp__office__ship', { title: 't', summary: 's' }))).hookSpecificOutput?.additionalContext).toMatch(/^You shipped/);
  });

  it("counts a helper's commit but only reminds the lead", async () => {
    const hooks = checklistHooks(() => items(false));
    expect(await fire(hooks, post('Bash', { command: 'git commit -m x' }, 'helper-1'))).toEqual({});
    expect(await fire(hooks, post('mcp__office__ship', {}, 'helper-1'))).toEqual({});
    expect((await fire(hooks, stop())).decision).toBe('block');
  });

  it('blocks the stop once after a commit, then lets it go', async () => {
    const hooks = checklistHooks(() => items(true, false));
    expect(await fire(hooks, stop())).toEqual({});
    await fire(hooks, post('Bash', { command: 'git -C focus commit -m "Step"' }));
    const blocked = await fire(hooks, stop());
    expect(blocked.decision).toBe('block');
    expect(blocked.reason).toContain('1 commit has landed');
    expect(await fire(hooks, stop())).toEqual({});
  });

  it("doesn't block while Claude Code says a stop hook already made it carry on", async () => {
    const hooks = checklistHooks(() => items(false));
    await fire(hooks, post('Bash', { command: 'git commit -m x' }));
    expect(await fire(hooks, stop(true))).toEqual({});
  });

  it('starts counting again once the note sends the checklist', async () => {
    let list = items(false, false);
    const hooks = checklistHooks(() => list);
    await fire(hooks, post('Bash', { command: 'git commit -m x' }));
    list = items(true, false);
    await fire(hooks, post('mcp__office__note', { slice: list }));
    expect(await fire(hooks, stop())).toEqual({});
    // a note without the checklist doesn't count as changing it
    await fire(hooks, post('Bash', { command: 'git commit -m y' }));
    await fire(hooks, post('mcp__office__note', { learned: 'a lesson' }));
    expect((await fire(hooks, stop())).decision).toBe('block');
  });
});
