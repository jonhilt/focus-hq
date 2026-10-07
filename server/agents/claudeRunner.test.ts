import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TermLine } from '../../shared/types';
import type { BrowserPool } from './browserTool';
import { ClaudeRunner, claudeConfig } from './claudeRunner';
import type { RunHooks } from './types';

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

describe('a subagent’s messages', () => {
  type Line = Omit<TermLine, 't'>;
  const messages = [
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Map the cart', prompt: 'Find the cart store' } }] } },
    { type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 't1', tool_use_id: 'toolu_1', description: 'Map the cart', subagent_type: 'Explore' },
    { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/w/cart.ts' } }] } },
    { type: 'user', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'export const cart = []' }] } },
    { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'The store holds a list' },
  ] as unknown as SDKMessage[];

  const run = (withTranscripts: boolean) => {
    const own: Line[] = [];
    const theirs = new Map<string, Line[]>();
    const hooks = {
      lines: (l: Line[]) => own.push(...l),
      activity: () => undefined,
      helper: () => undefined,
      ...(withTranscripts && { helperLines: (id: string, l: Line[]) => theirs.set(id, [...(theirs.get(id) ?? []), ...l]) }),
    } as unknown as RunHooks;
    const runner = new ClaudeRunner(null as unknown as BrowserPool) as unknown as { handle(m: SDKMessage, ctx: unknown, h: RunHooks): unknown };
    const ctx = { cwd: '/w', cloud: false, calls: new Map(), helpers: new Map() };
    for (const m of messages) runner.handle(m, ctx, hooks);
    return { own: own.map((l) => l.text), theirs: (theirs.get('toolu_1') ?? []).map((l) => l.text) };
  };

  it('go in a transcript of the helper’s own, starting with what it was asked, and stay out of the session’s', () => {
    const { own, theirs } = run(true);
    expect(own.join('\n')).not.toMatch(/Looking|cart\.ts|export const cart/);
    expect(theirs[0]).toBe('✻ Map the cart');
    expect(theirs[1]).toBe('▶ Find the cart store');
    expect(theirs.join('\n')).toMatch(/Looking[\s\S]*cart\.ts[\s\S]*export const cart/);
    expect(theirs.at(-1)).toBe('✔ Done');
  });

  it('go, indented, in the session’s own lines when nobody keeps helpers’ transcripts', () => {
    const { own } = run(false);
    expect(own).toContain('    ⏺ Looking');
    expect(own.join('\n')).not.toMatch(/export const cart/);
  });
});
