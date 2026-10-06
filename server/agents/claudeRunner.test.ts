import { describe, expect, it } from 'vitest';
import { claudeConfig } from './claudeRunner';

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
