import { describe, expect, it } from 'vitest';
import { namesIn, normalise, numbersIn, quoteLine, receiptProblems, unbacked, wordsToNumber } from './receipts';

// From a real briefing: Lt. Castellanos's backtest of the between-turn judge, and a beat's narration of it.
const MESSAGE = 'Haiku judged as well as Sonnet, at about $0.35 for all 555 turns, so a cheap judge is fine.';
const NARRATION = 'Castellanos ran it against the five hundred and fifty five turns you labelled. The cheap model, Haiku, judged as well as Sonnet, for about thirty five cents in total.';

describe('finding a quote in its source', () => {
  const file = ['export function ledgerLine(event: LedgerEvent): string {', '  const { seq, ...rest } = event;', '  return `${JSON.stringify({ v: LEDGER_VERSION, seq, ...rest })}\\n`;', '}'].join('\n');

  it('gives the line it starts on, give or take spacing and case', () => {
    expect(quoteLine(file, 'const { seq, ...rest } = event;')).toBe(2);
    expect(quoteLine(file, 'CONST  {  SEQ')).toBe(2);
  });

  it('finds a quote that runs across lines', () => {
    expect(quoteLine(file, 'string { const { seq')).toBe(1);
  });

  it('is 0 for words that aren’t there, or no words at all', () => {
    expect(quoteLine(file, 'rewrites the ledger')).toBe(0);
    expect(quoteLine(file, '  ')).toBe(0);
  });

  it('makes curly quotes and dashes plain', () => {
    expect(normalise('“Shall I start slice 2?” — it’s')).toBe('"shall i start slice 2?" - it\'s');
  });
});

describe('the numbers a line says', () => {
  it('reads figures, and words from eleven up', () => {
    expect(numbersIn(MESSAGE)).toEqual([0.35, 555]);
    expect(numbersIn('about thirty-six a day, and one key to hold')).toEqual([36]);
    expect(numbersIn('a hundred and seventy one of your calls, 1,200 in all')).toEqual([1200, 171]);
  });

  it('reads cents as a fraction of a dollar', () => {
    expect(numbersIn('about thirty five cents')).toEqual([0.35]);
  });

  it('turns number words into their value', () => {
    expect(wordsToNumber(['five', 'hundred', 'and', 'fifty', 'five'])).toBe(555);
    expect(wordsToNumber(['two', 'thousand', 'and', 'twelve'])).toBe(2012);
    expect(wordsToNumber(['many'])).toBeNaN();
  });
});

describe('the names a line says', () => {
  it('takes capitalised words, a sentence’s first too unless it’s a common word, and code', () => {
    expect(namesIn(NARRATION)).toEqual(['Castellanos', 'Haiku', 'Sonnet']);
    expect(namesIn('So the judge waits. Opus agreed. You’d hold one key.')).toEqual(['Opus']);
    expect(namesIn('It writes to `ledger.jsonl` and Kokoro says it.')).toEqual(['Kokoro', 'ledger.jsonl']);
  });

  it('leaves out titles and the office’s own words', () => {
    expect(namesIn('So Lieutenant Moreau tells the Captain, and QA checks it.')).toEqual(['Moreau']);
  });
});

describe('checking a beat against its quotes', () => {
  it('passes a narration whose every number and name is quoted', () => {
    expect(unbacked('The cheap model, Haiku, judged as well as Sonnet: thirty five cents for 555 turns.', [MESSAGE])).toEqual([]);
  });

  it('names what isn’t quoted', () => {
    expect(unbacked(NARRATION, [MESSAGE])).toEqual(['Castellanos']);
    expect(unbacked(NARRATION, [MESSAGE, 'Lt. Castellanos'])).toEqual([]);
    expect(unbacked('Then Lt. Castellanos ran it on 600 turns with Opus.', [MESSAGE])).toEqual(['600', 'Castellanos', 'Opus']);
  });

  it('tells the lead what to fix, beat by beat', () => {
    expect(receiptProblems(1, ['no file "ledger.ts" in your checkout'], ['600'])).toEqual([
      'Beat 2: no file "ledger.ts" in your checkout',
      'Beat 2 says "600", which none of its quotes do: quote the source that says it, or leave it out.',
    ]);
    expect(receiptProblems(0, [], [])).toEqual([]);
  });
});
