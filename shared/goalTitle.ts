/**
 * A goal's title from the captain's first words: their first line, cut at a word to about 60 characters. The office
 * titles a goal with it as it starts, and the browser shows a goal waiting in line by it.
 */
export function goalTitle(text: string): string {
  const line = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const plain = line.replace(/[.!?:;,]+$/, '');
  if (plain.length <= 60) return plain || 'A new goal';
  const cut = plain.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60).replace(/[\s.,;:]+$/, '')}…`;
}

/** A title a model proposed for a goal, tidied: one line, no quotes or closing stop, at most 60 characters; else undefined. */
export function tidyGoalTitle(proposed: unknown): string | undefined {
  if (typeof proposed !== 'string') return undefined;
  const line = proposed.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const plain = line.replace(/^["'“‘]+|["'”’]+$/g, '').replace(/[.!?:;,]+$/, '').replace(/\s+/g, ' ').trim();
  return plain && plain.length <= 60 ? plain : undefined;
}
