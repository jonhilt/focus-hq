import { describe, expect, it } from 'vitest';
import { namesIn, normalise, numbersIn, quoteLine, receiptProblems, unbacked, unmarked, wordsToNumber } from './receipts';

// From a real briefing: Lt. Castellanos's backtest of the between-turn judge, and a beat's narration of it.
const MESSAGE = 'Haiku judged as well as Sonnet, at about $0.35 for all 555 turns, so a cheap judge is fine.';
const NARRATION = 'Castellanos ran it against the five hundred and fifty five turns you labelled. The cheap model, Haiku, judged as well as Sonnet, for about thirty five cents in total.';
// From a real lead's message, in markdown, which a quote of it without the asterisks wasn't found in.
const MARKDOWN = '**Point of contact**, backtested:\n- **Thomas & Co:** you ended 26 of its 27 threads. Seventeen of your 26 decisions matched…';

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

  it('reads markdown as it reads, so a quote can leave its bold and code marks out, or keep them', () => {
    expect(quoteLine(MARKDOWN, 'Thomas & Co: you ended 26 of its 27 threads', true)).toBe(2);
    expect(quoteLine(MARKDOWN, '**Thomas & Co:** you ended', true)).toBe(2);
    expect(quoteLine(MARKDOWN, 'Thomas & Co:** you ended', true)).toBe(2);
    expect(quoteLine(MARKDOWN, '**Thomas & Co', true)).toBe(2);
    expect(quoteLine(MARKDOWN, 'Point of contact, backtested', true)).toBe(1);
    expect(quoteLine('It _was_ `ledger.jsonl`, *every* __time__ ***twice***.', 'It was ledger.jsonl, every time twice.', true)).toBe(1);
  });

  it('reads a source that isn’t markdown as written', () => {
    expect(quoteLine(MARKDOWN, 'Thomas & Co: you ended', false)).toBe(0);
    expect(quoteLine(MARKDOWN, 'Thomas & Co:** you ended', false)).toBe(2);
  });

  it('still finds code in markdown, quoted as it is, and not with its marks gone from inside a word', () => {
    const said = 'Rename `snake_case_names` in a_b.py; a * b and 2*3*4; f(*args, **kwargs) in plugins/briefings/__tests__/receipts.ts.';
    for (const quote of ['snake_case_names', '`snake_case_names` in a_b.py', 'a * b and 2*3*4', 'f(*args, **kwargs)', '**kwargs', 'plugins/briefings/__tests__/receipts.ts']) {
      expect([quote, quoteLine(said, quote, true)]).toEqual([quote, 1]);
    }
    for (const quote of ['snakecasenames', 'ab.py', 'a b and 234', 'plugins/briefings/tests/receipts.ts']) expect([quote, quoteLine(said, quote, true)]).toEqual([quote, 0]);
  });

  it('takes out the marks that open or close a word, and leaves the rest', () => {
    expect(unmarked('- **Thomas & Co:** said "**yes**" (_twice_), the **must**-have…')).toBe('- Thomas & Co: said "yes" (twice), the must-have…');
    expect(unmarked('* a list item, a * b, x*(y+1), snake_case, src/__tests__/x.ts')).toBe('* a list item, a * b, x*(y+1), snake_case, src/__tests__/x.ts');
    expect(unmarked('`**kwargs`, **kwargs')).toBe('kwargs, kwargs');
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

  it('ends a number at punctuation, and goes on past "and" only after a hundred, thousand or million', () => {
    expect(numbersIn('steps one and two, then four, five and six')).toEqual([]);
    expect(numbersIn('eleven, twelve and thirteen')).toEqual([11, 12, 13]);
    expect(numbersIn('a hundred and five, and a thousand and twelve')).toEqual([105, 1012]);
  });

  it('reads every number word, below eleven too, when asked: what a quote says, to back a figure', () => {
    expect(numbersIn('Four steps, one key and two hundred turns', true)).toEqual([4, 1, 200]);
    expect(numbersIn('Four steps, one key and two hundred turns')).toEqual([200]);
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

  it('doesn’t take a count opening a sentence for a name, but does one in the middle of it', () => {
    expect(namesIn('Four steps: Point of contact. Seventeen of your 26 matched. Twenty-six in all. Second, Haiku. Half went to Opus.')).toEqual(['Point', 'Haiku', 'Opus']);
    expect(namesIn('It took Seventeen tries.')).toEqual(['Seventeen']);
  });

  it('leaves out titles and Ops’ own words', () => {
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

  it('passes a caption opening on a count its quote says in figures', () => {
    expect(unbacked('Four steps: Point of contact first, then the rest.', ['4. Point of contact'])).toEqual([]);
  });

  it('backs a number in figures with its words, and in words with its figures', () => {
    expect(unbacked('Seventeen of your 26 decisions matched.', ['17 of your 26 decisions matched'])).toEqual([]);
    expect(unbacked('17 of your 26 decisions matched.', [MARKDOWN])).toEqual([]);
    expect(unbacked('It takes 4 steps.', ['Four steps:'])).toEqual([]);
    expect(unbacked('It takes 5 steps.', ['Four steps:'])).toEqual(['5']);
  });

  it('still names a capitalised word mid-sentence that no quote says', () => {
    expect(unbacked('Four steps, as Moreau said.', ['4. Point of contact'])).toEqual(['Moreau']);
    expect(unbacked('Then Seventeen of them matched.', ['17 of your 26 decisions matched'])).toEqual(['Seventeen']);
  });

  it('tells the lead what to fix, beat by beat', () => {
    expect(receiptProblems(1, ['no file "ledger.ts" in your checkout'], ['600'])).toEqual([
      'Beat 2: no file "ledger.ts" in your checkout',
      'Beat 2 says "600", which none of its quotes do: quote the source that says it, or leave it out.',
    ]);
    expect(receiptProblems(0, [], [])).toEqual([]);
  });
});
