import { describe, expect, it, vi } from 'vitest';
import { claudeConfig, sessionHooks } from './claudeSession';

describe('claudeConfig', () => {
  it('loads every settings source, and nothing else, with your own CLAUDE.md on', () => {
    expect(claudeConfig(true, '/home/me/.claude')).toEqual({ settingSources: ['user', 'project', 'local'] });
  });

  it('keeps every settings source but leaves out your own CLAUDE.md and rules with it off', () => {
    expect(claudeConfig(false, '/home/me/.claude')).toEqual({
      settingSources: ['user', 'project', 'local'],
      settings: { claudeMdExcludes: ['/home/me/.claude/CLAUDE.md', '/home/me/.claude/rules/**'] },
    });
  });
});

describe('a session’s hooks', () => {
  const signal = new AbortController().signal;
  const post = (file: string) => ({ hook_event_name: 'PostToolUse' as const, tool_name: 'Edit', tool_input: { file_path: file }, tool_response: {}, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: '/ws/l1' });

  it('reads a lead’s brief again as an edit of it finishes, and gives it back once the conversation’s compacted', async () => {
    const edited = vi.fn();
    const hooks = sessionHooks({ cwd: '/ws/l1', brief: { edited, afterCompact: () => 'The goal: Saved items' } });
    const [onEdit] = hooks?.PostToolUse ?? [];
    expect(onEdit.matcher).toBe('Write|Edit|MultiEdit');
    await onEdit.hooks[0](post('/ws/l1/web/src/app.ts'), 't1', { signal });
    expect(edited).not.toHaveBeenCalled();
    await onEdit.hooks[0](post('/ws/l1/brief.md'), 't1', { signal });
    expect(edited).toHaveBeenCalledOnce();
    const [onStart] = hooks?.SessionStart ?? [];
    expect(onStart.matcher).toBe('compact');
    expect(await onStart.hooks[0]({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's', transcript_path: '', cwd: '/ws/l1' }, undefined, { signal })).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'The goal: Saved items' },
    });
  });

  it('keeps the scratch dir’s guard on Bash, and has none for a session with neither', () => {
    const guard = () => Promise.resolve({});
    expect(sessionHooks({ cwd: '/ws/a1' }, guard)).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [guard] }] });
    expect(sessionHooks({ cwd: '/ws/a1' })).toBeUndefined();
  });
});
