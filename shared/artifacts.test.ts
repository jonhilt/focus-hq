import { describe, expect, it } from 'vitest';
import { answeredReadout, answerMessage, artifactUrl, latestArtifact, openQuestion, optionUrl } from './artifacts';

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
