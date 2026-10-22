import { describe, expect, it } from 'vitest';
import { openLines } from './startup';

const live = { host: '127.0.0.1', port: 4477, demo: false, keyMode: 'login', budgetUsd: 5, apiKeySet: false } as const;

describe('openLines', () => {
  it('says where to open Focus and which mode it runs in, then a blank line', () => {
    expect(openLines(live)).toEqual(['\n  🖖  Focus is open: http://127.0.0.1:4477', '      mode: live (gh CLI + Claude Agent SDK)', '']);
    expect(openLines({ ...live, demo: true, host: '0.0.0.0' }).slice(0, 2)).toEqual(['\n  🖖  Focus is open: http://localhost:4477', '      mode: demo (fake GitHub, pretend agents)']);
  });

  it('says how live agents sign in when the key is a fallback, or set and ignored', () => {
    expect(openLines({ ...live, keyMode: 'fallback' }).join('\n')).toContain('ANTHROPIC_API_KEY while your plan\'s usage limit is reached (up to $5 each time)');
    expect(openLines({ ...live, apiKeySet: true }).join('\n')).toContain('ANTHROPIC_API_KEY is set but agents ignore it');
    expect(openLines({ ...live, keyMode: 'key', apiKeySet: true })).toHaveLength(3);
  });

  it('says nothing of the key in the demo', () => {
    expect(openLines({ ...live, demo: true, keyMode: 'fallback', apiKeySet: true })).toHaveLength(3);
  });

  it('warns when anyone who can reach the port can drive the agents', () => {
    expect(openLines({ ...live, host: '0.0.0.0' }).join('\n')).toContain('⚠ HOST=0.0.0.0: anyone who can reach this port');
    expect(openLines(live).join('\n')).not.toContain('⚠');
  });
});
