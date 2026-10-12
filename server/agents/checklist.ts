import type { HookCallback, HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import type { LeadWork } from '../../shared/types';
import { gitCommit } from './commits';

/**
 * Keeps a lead's slice checklist (the `slice` on its goal's note) current, through Claude Code hooks: after a commit
 * or a ship it reminds the lead which items are still open, and it won't let the lead stop while commits have landed
 * since the checklist last changed and items are still unticked: once for those commits, in whichever turn. The hooks only prompt: the lead ticks
 * items itself, with the note tool, since only it knows what's done.
 */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

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

/**
 * Where the lead's checklist stands, as the office keeps it on the slice's waypoint: its items, the commits made during
 * the slice, and how many there were when the lead last sent the checklist and when the office last held its turn up.
 */
export interface ChecklistState {
  items: ChecklistItem[];
  commits: number;
  checklistAt: number;
  nudgedAt: number;
}

/** Where a lead's checklist stands: the note's items, and the commits counted on the slice under way's waypoint. */
export function checklistState(work: Pick<LeadWork, 'note' | 'slice' | 'waypoints'> | undefined): ChecklistState {
  const w = work?.waypoints?.find((p) => p.slice === work.slice);
  return { items: work?.note?.slice ?? [], commits: w?.commits ?? 0, checklistAt: w?.checklistAt ?? 0, nudgedAt: w?.nudgedAt ?? 0 };
}

/** What a lead's session reads its checklist from, and tells when it has held the lead's turn up over it. */
export interface ChecklistSource {
  read(): ChecklistState;
  nudged(): void;
}

/**
 * Why the lead can't stop yet, or undefined when it can: commits have landed since the checklist last changed, and
 * since the office last held the lead up over it (once per batch of commits, across turns), and items are still open.
 */
export function checklistStopReason(state: ChecklistState): string | undefined {
  const left = open(state.items);
  const since = state.commits - state.checklistAt;
  if (state.commits <= Math.max(state.checklistAt, state.nudgedAt) || !left.length) return undefined;
  const commits = since === 1 ? '1 commit has' : `${since} commits have`;
  return `${commits} landed since your slice checklist last changed, and it still has ${left.length} unticked:\n${listed(left)}\nBefore you finish, tick off what's done with the note tool (mcp__office__note, the whole slice with done set), or leave them unticked if they really aren't done yet, and then finish.`;
}

const bashCommand = (input: unknown) => {
  const command = (input as { command?: unknown } | undefined)?.command;
  return typeof command === 'string' ? command : undefined;
};

/**
 * The checklist hooks for a lead's session. The office counts the slice's commits on its waypoint as their results come
 * in, and notes when the lead sends the checklist (`checklistWaypoint`), so the count lasts across turns; a Bash call
 * here only decides whether to remind the lead. PostToolUse fires only when a tool worked (a failed one fires
 * PostToolUseFailure), so a commit seen here landed. Only the lead itself (no `agent_id`) hears the reminders, not its
 * helpers.
 */
export function checklistHooks(source: ChecklistSource): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const remind = (text: string | undefined) =>
    text ? { hookSpecificOutput: { hookEventName: 'PostToolUse' as const, additionalContext: text } } : {};

  const afterBash: HookCallback = (input) => {
    if (input.hook_event_name !== 'PostToolUse' || input.agent_id) return Promise.resolve({});
    const command = bashCommand(input.tool_input);
    return Promise.resolve(command && gitCommit(command) ? remind(checklistReminder(source.read().items, 'commit')) : {});
  };
  const afterShip: HookCallback = (input) =>
    Promise.resolve(input.hook_event_name === 'PostToolUse' && !input.agent_id ? remind(checklistReminder(source.read().items, 'ship')) : {});
  const onStop: HookCallback = (input) => {
    if (input.hook_event_name !== 'Stop' || input.stop_hook_active) return Promise.resolve({});
    const reason = checklistStopReason(source.read());
    if (!reason) return Promise.resolve({});
    source.nudged();
    return Promise.resolve({ decision: 'block' as const, reason });
  };

  return {
    PostToolUse: [
      { matcher: 'Bash', hooks: [afterBash] },
      { matcher: SHIP_TOOL, hooks: [afterShip] },
    ],
    Stop: [{ hooks: [onStop] }],
  };
}

/**
 * The hooks a local session runs with: the scratch dir's guard on Bash before it runs, and for a goal's lead the ones
 * that keep its checklist current.
 */
export function sessionHooks(scratchHook: HookCallback | undefined, checklist: ChecklistSource | undefined): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    ...(scratchHook && { PreToolUse: [{ matcher: 'Bash', hooks: [scratchHook] }] }),
    ...(checklist && checklistHooks(checklist)),
  };
}
