import { describe, expect, it } from 'vitest';
import type { TermLine } from '../../plugin-api/shared';
import { explainerPage } from './explainer';
import { briefingBeats, pageText, quickAnswerNote, quickAnswerPrompt, recentReplies, whoAnswers } from './quickAnswer';

const explainer = () => {
  const page = explainerPage({
    id: 'save-journey',
    title: 'How a save travels',
    beats: [
      { title: 'The save', text: 'The shopper taps save.', seconds: 3 },
      { title: 'If the database is down', text: 'It waits </script> and retries.', seconds: 3, narration: 'Watch the queue hold it.' },
    ],
    stage: { html: '<div id="a"></div>', script: 'function render(t) {}' },
  });
  if ('error' in page) throw new Error(page.error);
  return page.html;
};

describe('whoAnswers', () => {
  it('leaves it to the lead between turns, or when the question picks their session back up', () => {
    expect(whoAnswers('done')).toBe('lead');
    expect(whoAnswers('stopped')).toBe('lead');
    expect(whoAnswers('error')).toBe('lead');
  });

  it('answers quickly while the lead is in the middle of something', () => {
    for (const status of ['working', 'testing', 'waiting', 'pushing', 'setting-up', 'queued'] as const) expect(whoAnswers(status)).toBe('quick');
  });
});

describe('briefingBeats', () => {
  it('reads an explainer’s beats from its page, narration and all', () => {
    expect(briefingBeats(explainer())).toEqual([
      { title: 'The save', text: 'The shopper taps save.', say: expect.any(String) },
      { title: 'If the database is down', text: 'It waits </script> and retries.', say: 'Watch the queue hold it.' },
    ]);
  });

  it('finds none in a page that isn’t an explainer', () => {
    expect(briefingBeats('<html><body>A mockup</body></html>')).toBeUndefined();
  });
});

describe('pageText', () => {
  it('keeps the words on a page and drops its scripts, styles and tags', () => {
    expect(pageText('<style>p{}</style><h1>Cards</h1><script>x()</script><p>Fish &amp; chips</p>')).toBe('Cards Fish & chips');
  });
});

describe('recentReplies', () => {
  it('takes the lead’s latest replies, without tool calls', () => {
    const lines: TermLine[] = [
      { t: 0, kind: 'text', text: '⏺ First.' },
      { t: 0, kind: 'tool', text: '⏺ Read(a.ts)' },
      { t: 0, kind: 'text', text: '⏺ Second.' },
      { t: 0, kind: 'text', text: '⏺ Third.' },
    ];
    expect(recentReplies(lines, 2)).toEqual(['Second.', 'Third.']);
  });
});

describe('quickAnswerPrompt', () => {
  const ask = { leadName: 'Lt. Adeyemi', goal: 'Saved items', briefing: { id: 'save-journey', title: 'How a save travels', html: explainer() }, question: 'Why wait?', recent: ['Building the store.'] };

  it('gives the briefing beat by beat, marks the captain’s beat and asks the question there', () => {
    const prompt = quickAnswerPrompt({ ...ask, spot: { beat: 1, title: 'If the database is down' }, note: { done: 'Saves survive a reload', learned: ['The API holds up'], next: [] } });
    expect(prompt).toContain('▶ Beat 2, “If the database is down”: It waits </script> and retries. (narration: Watch the queue hold it.)');
    expect(prompt).toContain('What done looks like: Saves survive a reload');
    expect(prompt).toContain('- Building the store.');
    expect(prompt).toMatch(/The captain is on beat 2, “If the database is down”, and asks: Why wait\?$/);
  });

  it('gives a page that isn’t an explainer as its words', () => {
    const prompt = quickAnswerPrompt({ ...ask, briefing: { id: 'mockup', title: 'A mockup', html: '<p>Cards with pictures</p>' } });
    expect(prompt).toContain('The briefing, “A mockup”:\nCards with pictures');
    expect(prompt).toMatch(/The captain asks: Why wait\?$/);
  });
});

describe('quickAnswerNote', () => {
  it('tells the lead what was asked and answered, and that they need only reply to put it right', () => {
    const note = quickAnswerNote('How a save travels', { beat: 0, title: 'The save' }, 'Why?', 'Because.');
    expect(note).toContain('the captain asked about your briefing “How a save travels” (beat 1, “The save”): Why?');
    expect(note).toContain('The quick answerer answered for you: Because.');
    expect(note).toContain('No need to reply');
  });
});
