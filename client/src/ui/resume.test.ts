import { describe, expect, it } from 'vitest';
import { resumeQuestion } from './resume';

describe('resumeQuestion', () => {
  it('says how long the conversation is, what re-reading it costs, and when the plan comes back', () => {
    const now = new Date(2026, 9, 8, 10, 0).getTime();
    const text = resumeQuestion('Ensign Ro', { usd: 2.6, tokens: 412_345, resetsAt: new Date(2026, 9, 8, 15, 0).getTime() }, now);
    expect(text).toContain('412k tokens');
    expect(text).toContain('about $2.60');
    expect(text).toContain(new Date(2026, 9, 8, 15, 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    expect(text).toContain('Ensign Ro reads it when');
  });
});
