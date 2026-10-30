import { join } from 'node:path';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { withoutSecrets } from '../secrets';
import { keyFallback } from './apiKey';
import { editsBrief, EDIT_TOOLS } from './briefFile';
import type { RunRequest } from './types';

// What every Claude Code session Focus starts shares, on agent-host (hostRunner.ts) or in a one-off read-only call
// (claudeCrew.ts): its environment, the settings it loads, its hooks, and what it hears when a request is turned down.

/** What an agent hears when the captain declines its tool call. */
export const DECLINED = 'The manager declined this action. Find another approach, or explain in your final summary why it is needed.';

/** What a lead hears when their question went unanswered (their turn ended, or they were stopped). */
export const UNANSWERED = 'The captain didn’t answer before your turn ended, so your question has come down from your station’s screen: ask again if it still matters.';

/**
 * The environment every Claude Code session gets. Agents run on your Claude login, not on an API key that happens to
 * be in the environment, unless Focus says the key's in use (`keyFallback`): always, or while your plan's usage
 * limit is reached. Focus's own secrets (the bot's token, say) are left out (`withoutSecrets`).
 */
export function agentEnv(onKey = keyFallback.onKey()): Record<string, string | undefined> {
  // Claude Code's task tools (TaskCreate, TaskUpdate, TaskList): on newer models a session only has them when asked
  // for, which the SDK's docs advise when the app reads them, as Focus does: it follows each agent's task list
  // (`tasks.ts`), and draws a lead's on its goal's chart
  const env: Record<string, string | undefined> = { ...withoutSecrets(), CLAUDE_AGENT_SDK_CLIENT_APP: 'focus/0.1.0', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' };
  if (!onKey) delete env.ANTHROPIC_API_KEY;
  return env;
}

/**
 * The settings files and CLAUDE.md files a session loads. Without your own CLAUDE.md, only it and your rules are
 * excluded, so your ~/.claude/settings.json (permissions, env, plugins) still applies; anything they import goes too.
 */
export function claudeConfig(userClaudeMd: boolean, configDir: string): Pick<Options, 'settingSources' | 'settings'> {
  const settingSources: Options['settingSources'] = ['user', 'project', 'local'];
  if (userClaudeMd) return { settingSources };
  return { settingSources, settings: { claudeMdExcludes: [join(configDir, 'CLAUDE.md'), join(configDir, 'rules', '**')] } };
}

/**
 * A local session's hooks: the scratch dir's guard on Bash (and the push guard's), before it runs; and for a goal's lead,
 * their brief read again as an edit of it finishes, and given back to them once their conversation's compacted (by
 * Claude Code itself or by Ops), which a message wouldn't reach until their next one.
 */
export function sessionHooks(req: Pick<RunRequest, 'cwd' | 'brief'>, scratch?: HookCallback): Options['hooks'] {
  const brief = req.brief;
  const edited: HookCallback = (input) => {
    if (brief && input.hook_event_name === 'PostToolUse' && editsBrief(req.cwd, input.tool_input)) brief.edited();
    return Promise.resolve({});
  };
  const compacted: HookCallback = (input) =>
    Promise.resolve(brief && input.hook_event_name === 'SessionStart' ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief.afterCompact() } } : {});
  if (!scratch && !brief) return undefined;
  return {
    ...(scratch && { PreToolUse: [{ matcher: 'Bash', hooks: [scratch] }] }),
    ...(brief && { PostToolUse: [{ matcher: EDIT_TOOLS, hooks: [edited] }], SessionStart: [{ matcher: 'compact', hooks: [compacted] }] }),
  };
}
