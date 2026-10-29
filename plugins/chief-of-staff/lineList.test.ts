import { describe, expect, it } from 'vitest';
import { lineEntries } from './lineList';
import { freshLine, type LineStart } from './shared';

const start = (at: number): LineStart => ({ key: `p|g${at}`, leadId: `lead-${at}`, projectId: 'p', project: 'Web shop', text: `goal ${at}`, why: 'You asked', at });

describe('the direct line as Comms draws it', () => {
  it('puts what it started and told where it happened, between the user’s words and its reply', () => {
    const line = {
      ...freshLine(),
      messages: [{ from: 'user' as const, text: 'Add dark mode', at: 1 }, { from: 'cos' as const, text: 'Started it', at: 4 }],
      started: [start(2)],
      told: [{ leadId: 'lead-9', goal: 'Saved items', text: 'Mind the footer', at: 3 }],
    };
    expect(lineEntries(line).map((e) => e.kind)).toEqual(['message', 'started', 'told', 'message']);
  });

  it('leaves out what it started before the conversation began afresh', () => {
    const line = { ...freshLine(), started: [start(2), start(8)], since: 5 };
    expect(lineEntries(line).map((e) => (e.kind === 'started' ? e.start.at : 0))).toEqual([8]);
  });
});
