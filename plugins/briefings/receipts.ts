// Receipts: a beat of an explainer says where its facts come from, quoting each source word for word, and
// Ops checks both before the captain sees it: that every quote is in its source (a file in the lead's checkout,
// the lead's own earlier words, a line of the ship's log, a pull request), and that every number and name the beat's narration says is
// in its quotes. Pure, so it's unit tested (receipts.test.ts); finding the sources is the explain tool's.

/** Where a beat's fact comes from, as the lead cites it: the source, and its words quoted exactly. */
export interface Ref {
  /** A file in the lead's checkout, the lead's own earlier words, a line of the ship's log, or a pull request. */
  kind: 'file' | 'said' | 'ledger' | 'pr';
  /** The file's path (with its repo's folder first when the goal has more than one), the ledger line's number, or the pull request (owner/repo#number); nothing for said. */
  where?: string;
  quote: string;
}

/** A ref Ops found in its source: what its chip says, and the quote it opens to. */
export interface Receipt {
  label: string;
  quote: string;
}

/** The most refs a beat carries, and the longest quote. */
export const RECEIPT_LIMITS = { refs: 4, quote: 300 } as const;

/** Text as quotes are matched in: lower case, one space between words, curly quotes and dashes made plain. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Markdown as it reads: its bold, italic and code marks (`**`, `__`, `*`, `_`, backticks) taken out where they open
 * or close a word. One inside a word (snake_case_names, 2*3), on its own (a * b, a list's `* `) or by a slash
 * (__tests__ in a path) stays. Both sides of a match go through it, so code and a quote of it still agree.
 */
export function unmarked(text: string): string {
  return text.replace(/[*_`]+/g, (marks: string, at: number) => {
    const before = text[at - 1] ?? ' ';
    const after = text[at + marks.length] ?? ' ';
    const opens = /[\s([{"'‘“–—]/.test(before) && /\S/.test(after);
    const closes = /\S/.test(before) && /[\s)\]}.,:;!?"'’”…\-–—]/.test(after);
    return opens || closes ? '' : marks;
  });
}

/**
 * The line (from 1) of `source` a quote starts on, word for word give or take spacing and case; 0 when it isn't there.
 * A `markdown` source (the lead's words, a pull request, a docs page) is matched as it reads too, so a quote can
 * leave its bold and code marks out; one quoted with them, as written, is still found.
 */
export function quoteLine(source: string, quote: string, markdown = false): number {
  return lineOf(source, quote, normalise) || (markdown ? lineOf(source, quote, (text) => normalise(unmarked(text))) : 0);
}

/** `quoteLine` with the source's lines and the quote both made plain by `plain`. */
function lineOf(source: string, quote: string, plain: (text: string) => string): number {
  const q = plain(quote);
  if (!q) return 0;
  // the source as one plain text, with where each line starts in it, so a quote across lines is found too
  let text = '';
  const starts: number[] = [];
  for (const line of source.split('\n')) {
    starts.push(text.length);
    const n = plain(line);
    if (n) text += `${text ? ' ' : ''}${n}`;
  }
  const at = text.indexOf(q);
  if (at < 0) return 0;
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= at) line++;
  return line + 1;
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000 };
const isNumberWord = (w: string) => w in SMALL || w in TENS || w in SCALES;

/** A run of number words as its value ("five hundred and fifty five" is 555); NaN when it isn't one. */
export function wordsToNumber(words: readonly string[]): number {
  let total = 0;
  let group = 0;
  let any = false;
  for (const w of words) {
    if (w === 'and') continue;
    if (w in SMALL) group += SMALL[w];
    else if (w in TENS) group += TENS[w];
    else if (w === 'hundred') group = (group || 1) * 100;
    else if (w in SCALES) {
      total += (group || 1) * SCALES[w];
      group = 0;
    } else return NaN;
    any = true;
  }
  return any ? total + group : NaN;
}

/**
 * The numbers a line says, written in figures or in words. Words below eleven are left out ("one key", "two
 * questions" are how people talk, not figures to check) unless `every`, as for a quote, whose "four" backs a "4".
 * Figures are always in. "N cents" counts as N/100 too.
 */
export function numbersIn(text: string, every = false): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) found.push(Number(m[0].replace(/,/g, '')));
  // the words, and the punctuation between them, which ends a number ("eleven, twelve" is two)
  const words = text.toLowerCase().replace(/-/g, ' ').match(/[a-z]+|[^a-z\s]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const j = numberEnd(words, i);
    if (j === i) continue;
    const n = wordsToNumber(words.slice(i, j));
    if (every || n > 10 || j - i > 1) found.push(words[j] === 'cents' ? n / 100 : n);
    i = j - 1;
  }
  return found;
}

/** Where the number words from `i` end (`i` when there are none): "and" goes on with one only after a hundred, thousand or million ("a hundred and five", but "one and two" are two). */
function numberEnd(words: readonly string[], i: number): number {
  let j = i;
  while (j < words.length && (isNumberWord(words[j]) || (words[j] === 'and' && words[j - 1] in SCALES && isNumberWord(words[j + 1] ?? '')))) j++;
  return j;
}

/** Words that start a sentence without being a name: it's only a name check for a first word not among them. */
const COMMON = new Set(
  `a about above across after again against all almost also although always an and another any anything are around as
  at back be because been before behind being below beside besides between both but by can could do does doing
  done down during each either else enough even every everything few first for from further had has have having he
  her here hers him his how however i if in inside instead into is it its just last later least
  less let like many maybe me meanwhile more most much must my neither never next no none nor not nothing
  now of off often on once one only or other others otherwise our out over perhaps rather really right left
  same see she should since so some something sometimes still such than that the their them then there therefore these
  they this those though through thus to today together too top bottom under underneath unless until up upon us very
  was we well were what whatever when where whether which while who whom whose why will with within without yes
  yet you your yours first second third finally imagine look picture remember say think watch notice here's that's it's there's
  what's let's we're you're they're don't doesn't isn't wasn't can't won't`.split(/\s+/),
);

/** Counts and ordinals, which start a sentence ("Four steps", "Seventeen of them", "Second") without being names. */
const COUNTS = new Set([
  ...Object.keys(SMALL), ...Object.keys(TENS), ...Object.keys(SCALES),
  ...`first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth
  sixteenth seventeenth eighteenth nineteenth twentieth half twice several dozen dozens hundreds thousands millions`.split(/\s+/),
]);

/** A sentence's first word that's no name: a common word, or a count, hyphenated too ("Twenty-six", "Twenty-first"). */
const opensSentence = (lower: string) => COMMON.has(lower) || lower.split('-').every((part) => COUNTS.has(part));

/** Capitalised words that aren't names to check: the start of speech, and Ops' own words. */
const NOT_NAMES = new Set(['i', 'ok', 'okay', 'captain', 'lieutenant', 'lt', 'commander', 'cmdr', 'ensign', 'chief', 'focus', 'qa']);

/**
 * The names a line says: capitalised words (Haiku, Castellanos, PostgreSQL), a sentence's first too unless it's a
 * common word or a count ("So", "Every", "Four"), and anything in code style. Titles and Ops' own words are left out.
 */
export function namesIn(text: string): string[] {
  const names = new Set<string>();
  // a title's full stop doesn't end a sentence, so the name after it still counts
  const spoken = text.replace(/\b(Lt|Cmdr|Capt|Dr|Mr|Mrs|Ms|St|e\.g|i\.e)\./g, '$1');
  for (const sentence of spoken.split(/(?<=[.!?:;])\s+|\n+/)) {
    const words = sentence.match(/[\p{L}][\p{L}\p{N}_'’.-]*/gu) ?? [];
    words.forEach((w, i) => {
      const word = w.replace(/['’]s$/, '').replace(/[.'’-]+$/, '');
      const lower = word.toLowerCase();
      // a contraction (You'd, We'll) is never a name
      if (/['’](d|ll|ve|re|m|t)$/i.test(word)) return;
      if (/^\p{Lu}/u.test(word) && !NOT_NAMES.has(lower) && (i > 0 || !opensSentence(lower))) names.add(word);
    });
  }
  for (const m of text.matchAll(/`([^`]+)`/g)) names.add(m[1]);
  return [...names];
}

/** The numbers and names a beat's narration says that none of its quotes do: nothing when every one is backed. */
export function unbacked(narration: string, quotes: readonly string[]): string[] {
  const said = quotes.join('\n');
  const numbers = new Set(numbersIn(said, true));
  const text = normalise(said);
  const missing = numbersIn(narration).filter((n) => !numbers.has(n)).map(String);
  const names = namesIn(narration).filter((name) => !text.includes(normalise(name)));
  return [...new Set([...missing, ...names])];
}

/** What the lead hears about a beat whose facts aren't all in its receipts, or whose quotes weren't found. */
export function receiptProblems(beat: number, unfound: readonly string[], missing: readonly string[]): string[] {
  const which = `Beat ${beat + 1}`;
  return [
    ...unfound.map((u) => `${which}: ${u}`),
    ...(missing.length ? [`${which} says ${missing.map((m) => `"${m}"`).join(', ')}, which none of its quotes do: quote the source that says it, or leave it out.`] : []),
  ];
}
