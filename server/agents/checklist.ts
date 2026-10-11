import type { HookCallback, HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { gitCommit } from './commits';

/**
 * Keeps a lead's slice checklist (the `slice` on its goal's note) current, through Claude Code hooks: after a commit
 * or a ship it reminds the lead which items are still open, and once a turn it won't let the lead stop while commits
 * have landed since the checklist last changed and items are still unticked. The hooks only prompt: the lead ticks
 * items itself, with the note tool, since only it knows what's done.
 */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

const NOTE_TOOL = 'mcp__office__note';
const SHIP_TOOL = 'mcp__office__ship';

const open = (items: ChecklistItem[]) => items.filter((i) => !i.done);
const listed = (items: ChecklistItem[]) => items.map((i) => `- ${i.text}`).join('\n');

/** What the lead hears after a commit or a ship while items are unticked; undefined when there's nothing to tick. */
export function checklistReminder(items: ChecklistItem[], after: 'commit' | 'ship'): string | undefined {
  const left = open(items);
  if (!left.length) return undefined;
  const what = after === 'ship' ? 'You shipped the slice' : 'That commit landed';
  return `${what}. Your slice checklist still has ${left.length} unticked:\n${listed(left)}\nIf any of them are done now, tick them off: send the whole checklist again with the note tool (mcp__office__note, slice), done set on what's finished.`;
}

/** Why the lead can't stop yet, or undefined when it can: commits since the checklist changed, items still open, and not blocked already this turn. */
export function checklistStopReason(items: ChecklistItem[], commitsSince: number, blockedAlready: boolean): string | undefined {
  const left = open(items);
  if (blockedAlready || commitsSince === 0 || !left.length) return undefined;
  const commits = commitsSince === 1 ? '1 commit has' : `${commitsSince} commits have`;
  return `${commits} landed since your slice checklist last changed, and it still has ${left.length} unticked:\n${listed(left)}\nBefore you finish, tick off what's done with the note tool (mcp__office__note, the whole slice with done set), or leave them unticked if they really aren't done yet, and then finish.`;
}

/** Whether a note tool call changed the checklist: it sent `slice`. */
const sentSlice = (input: unknown) => Array.isArray((input as { slice?: unknown } | undefined)?.slice);

const bashCommand = (input: unknown) => {
  const command = (input as { command?: unknown } | undefined)?.command;
  return typeof command === 'string' ? command : undefined;
};

/**
 * The checklist hooks for one run of a lead's session, reading the note's checklist as it stands from `checklist`.
 * PostToolUse fires only when a tool worked (a failed one fires PostToolUseFailure), so a commit counted here landed.
 * A helper's commits count too, but only the lead itself (no `agent_id`) hears the reminders.
 */
export function checklistHooks(checklist: () => ChecklistItem[]): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  let commitsSince = 0;
  let blocked = false;
  const remind = (text: string | undefined) =>
    text ? { hookSpecificOutput: { hookEventName: 'PostToolUse' as const, additionalContext: text } } : {};

  const afterBash: HookCallback = (input) => {
    if (input.hook_event_name !== 'PostToolUse') return Promise.resolve({});
    const command = bashCommand(input.tool_input);
    if (!command || !gitCommit(command)) return Promise.resolve({});
    commitsSince++;
    return Promise.resolve(input.agent_id ? {} : remind(checklistReminder(checklist(), 'commit')));
  };
  const afterShip: HookCallback = (input) =>
    Promise.resolve(input.hook_event_name === 'PostToolUse' && !input.agent_id ? remind(checklistReminder(checklist(), 'ship')) : {});
  const afterNote: HookCallback = (input) => {
    if (input.hook_event_name === 'PostToolUse' && sentSlice(input.tool_input)) commitsSince = 0;
    return Promise.resolve({});
  };
  const onStop: HookCallback = (input) => {
    if (input.hook_event_name !== 'Stop') return Promise.resolve({});
    const reason = checklistStopReason(checklist(), commitsSince, blocked || input.stop_hook_active);
    if (!reason) return Promise.resolve({});
    blocked = true;
    return Promise.resolve({ decision: 'block' as const, reason });
  };

  return {
    PostToolUse: [
      { matcher: 'Bash', hooks: [afterBash] },
      { matcher: SHIP_TOOL, hooks: [afterShip] },
      { matcher: NOTE_TOOL, hooks: [afterNote] },
    ],
    Stop: [{ hooks: [onStop] }],
  };
}
