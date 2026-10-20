/** How long a goal's title gets, in characters: about six to eight words. */
const TITLE_LENGTH = 60;

/** A small word a cut can leave hanging at the end of a title ("…from the cart and the"). */
const DANGLING = /\s+(?:a|an|and|as|at|but|by|for|from|in|into|of|on|or|so|that|the|then|to|with)$/i;

/**
 * A goal's title from the captain's first words, with no model: their first sentence, and when that's long, its first
 * clause or as many words as fit in about 60 characters, without trailing punctuation or a word left hanging. The office
 * titles a goal with it as it starts, and the browser shows a goal waiting in line by it.
 */
export function goalTitle(text: string): string {
  const line = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const sentence = line.split(/(?<=[.!?])\s/)[0];
  return tidy(sentence.length <= TITLE_LENGTH ? sentence : shortened(sentence)) || 'A new goal';
}

/** A long sentence cut to its first clause, if that's a title's length, else at the last word that fits. */
function shortened(sentence: string): string {
  const fits = sentence.slice(0, TITLE_LENGTH + 1);
  const clause = [...fits.matchAll(/[,;:(]\s|\s[-–—]\s/g)].find((m) => m.index >= 20);
  if (clause) return fits.slice(0, clause.index);
  const word = fits.lastIndexOf(' ');
  return fits.slice(0, word > 20 ? word : TITLE_LENGTH);
}

/** Without the punctuation or small words a cut leaves at its end. */
function tidy(title: string): string {
  const trimmed = title.replace(/[\s.!?:;,…–—-]+$/, '');
  const shorter = trimmed.replace(DANGLING, '');
  return shorter === trimmed ? trimmed : tidy(shorter);
}
