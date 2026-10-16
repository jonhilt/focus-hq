import { describe, expect, it } from 'vitest';
import { answeredReadout, answerMessage, artifactUrl, briefingQuestion, firstChangedBeat, latestArtifact, openQuestion, optionUrl } from './artifacts';

describe('artifacts', () => {
  it('shows the one shown last, wherever it stands in the list', () => {
    const artifacts = [{ id: 'data-flow', title: 'Data flow', at: 3 }, { id: 'mockup', title: 'Mockup', at: 2 }];
    expect(latestArtifact(artifacts)?.id).toBe('data-flow');
    expect(latestArtifact([])).toBeUndefined();
    expect(latestArtifact(undefined)).toBeUndefined();
  });

  it('gives each version of an artifact a URL of its own', () => {
    expect(artifactUrl('lead_p_1', { id: 'mockup', title: 'Mockup', at: 7 }, 'jpg')).toBe('/api/artifacts/lead_p_1/mockup.jpg?v=7');
  });
});

describe('questions', () => {
  const question = { id: 'q2', question: 'Which layout?', options: [{ id: 'a', label: 'Cards' }, { id: 'b', label: 'Plain list' }], at: 9 };

  it('is open until the captain answers the last one', () => {
    expect(openQuestion({ lead: { questions: [question] } as never })).toBe(question);
    expect(openQuestion({ lead: { questions: [{ ...question, answer: { option: 'a', at: 10 } }] } as never })).toBeUndefined();
    expect(openQuestion({ lead: { questions: [{ ...question, answer: { note: 'B please', at: 10 } }] } as never })).toBeUndefined();
    expect(openQuestion(undefined)).toBeUndefined();
  });

  it('sums up a settled question by the option picked, or as answered in chat', () => {
    expect(answeredReadout({ ...question, answer: { option: 'b', at: 10 } })).toBe('PICKED B');
    expect(answeredReadout({ ...question, answer: { note: 'B please', at: 10 } })).toBe('ANSWERED IN CHAT');
    expect(answeredReadout(question)).toBe('NOT ANSWERED');
  });

  it('serves each option beside the artifacts, under a name no artifact can have', () => {
    expect(optionUrl('lead_p_1', question, 'b', 'html')).toBe('/api/artifacts/lead_p_1/q2.b.html?v=9');
  });

  it('tells the lead which option the captain picked, and anything they added', () => {
    expect(answerMessage(question, 'b')).toBe('I picked B, “Plain list”, for your question “Which layout?”.');
    expect(answerMessage(question, 'a', ' Keep the header ')).toBe('I picked A, “Cards”, for your question “Which layout?”.\n\nKeep the header');
  });
});

describe('briefingQuestion', () => {
  const briefing = { id: 'ledger-crash', title: 'When the ledger crashes' };

  it('names the briefing and the beat the captain was on, counted from 1', () => {
    const message = briefingQuestion(briefing, { beat: 2, title: 'The retry' }, '  Why twice? ');
    expect(message.split('\n\n')[0]).toBe('A question about your briefing “When the ledger crashes” (`ledger-crash`, at beat 3, “The retry”): Why twice?');
  });

  it('leaves the beat out when the player never said which one it was on', () => {
    expect(briefingQuestion(briefing, undefined, 'Why?')).toMatch(/^A question about your briefing “When the ledger crashes” \(`ledger-crash`\): Why\?/);
  });

  it('asks for an answer that reads well aloud', () => {
    expect(briefingQuestion(briefing, undefined, 'Why?')).toContain('read out to me in your voice');
  });
});

describe('firstChangedBeat', () => {
  const v1 = { lines: ['Save.', 'Pass it on.', 'It waits.'], titles: ['Save', 'Pass', 'Outage'] };

  it('finds the first beat whose line changed', () => {
    expect(firstChangedBeat(v1, { ...v1, lines: ['Save.', 'Pass it on.', 'It retries three times, then says so.'] })).toBe(2);
  });

  it('counts a changed title, or a beat added on the end', () => {
    expect(firstChangedBeat(v1, { ...v1, titles: ['Save', 'Hand over', 'Outage'] })).toBe(1);
    expect(firstChangedBeat(v1, { lines: [...v1.lines, 'And then?'], titles: [...v1.titles, 'After'] })).toBe(3);
  });

  it('has none when every beat reads the same, or there was no earlier version', () => {
    expect(firstChangedBeat(v1, { ...v1 })).toBe(-1);
    expect(firstChangedBeat(undefined, v1)).toBe(-1);
  });
});
