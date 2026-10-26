import { describe, expect, it } from 'vitest';
import type { LeadWork } from '../../shared/types';
import { BRIEF_LIMITS, briefedGoal, briefForPrompt, briefMovedNote, editsBrief, keptBrief, needsBrief, noteAsBrief, readBrief } from './briefFile';

const BRIEF = `# Saved items, anywhere

The captain wants shoppers to keep a list.

## Done looks like

Saved items survive a reload,
on any device.

## Learned

- The store is **fine** as it is
  for a list this size
- Signing in brings the list along

## Ideas for next

A few, in order:

1. Show it in the header
2. [Tidy](https://example.com/tidy) the \`store\` code

## Loose threads

- [ ] Is the API rate limited?
- [x] Dark mode: the system setting covers it
- Polling drains battery?

## Notes to self

- Not part of the note
`;

const work: LeadWork = { station: 0, title: 'Saved items', repos: [], slice: 1, prs: [], waypoints: [{ slice: 1, startedAt: 0 }] };

describe('reading a brief', () => {
  it('takes the title from its # heading and each part from the heading that names it', () => {
    expect(readBrief(BRIEF)).toEqual({
      title: 'Saved items, anywhere',
      note: {
        done: 'Saved items survive a reload, on any device.',
        learned: ['The store is fine as it is for a list this size', 'Signing in brings the list along'],
        next: ['Show it in the header', 'Tidy the store code'],
      },
      // a ticked box is dealt with
      threads: ['Is the API rate limited?', 'Polling drains battery?'],
    });
  });

  it('reads the lead’s own headings loosely, and a part with no bullets a paragraph at a time', () => {
    const read = readBrief('## What done looks like\nIt works.\n\n## Lessons\nFirst one.\n\nSecond one.\n\n## Next\n\n## Open questions\n- Why?');
    expect(read).toEqual({ note: { done: 'It works.', learned: ['First one.', 'Second one.'], next: [] }, threads: ['Why?'] });
  });

  it('reads nothing from a brief with none of its headings, or from inside a code block', () => {
    expect(readBrief('Just some words.')).toEqual({ note: { done: '', learned: [], next: [] }, threads: [] });
    expect(readBrief('# Goal\n\n```md\n## Loose threads\n- not one\n```\n')).toEqual({ title: 'Goal', note: { done: '', learned: [], next: [] }, threads: [] });
  });

  it('keeps each part to a few lines, cut short', () => {
    const many = readBrief(`## Next\n${Array.from({ length: 20 }, (_, i) => `- idea ${i}`).join('\n')}\n## Learned\n- ${'x'.repeat(BRIEF_LIMITS.item + 10)}`);
    expect(many.note.next).toHaveLength(BRIEF_LIMITS.next);
    expect(many.note.learned[0]).toHaveLength(BRIEF_LIMITS.item);
    expect(keptBrief('x'.repeat(BRIEF_LIMITS.chars + 1))).toMatch(/\[Ops kept only the first \d+ characters of this brief\.\]$/);
  });
});

describe('the goal its brief gives', () => {
  it('takes the brief, its title, note and loose threads onto the goal, and is the same goal when the brief hasn’t changed', () => {
    const after = briefedGoal(work, BRIEF, 10);
    expect(after).toMatchObject({ briefMd: BRIEF, title: 'Saved items, anywhere', note: readBrief(BRIEF).note });
    expect(after.contacts?.map((c) => [c.id, c.text])).toEqual([['c1', 'Is the API rate limited?'], ['c2', 'Polling drains battery?']]);
    expect(briefedGoal(after, BRIEF, 11)).toBe(after);
    // no title in it: the goal keeps its own
    expect(briefedGoal(work, '## Next\n- Header', 10).title).toBe('Saved items');
  });

  it('clears a thread the lead takes off it, and turns the course when done changes', () => {
    const first = briefedGoal(work, BRIEF, 10);
    const second = briefedGoal(first, BRIEF.replace('- Polling drains battery?\n', '').replace('on any device.', 'on every device.'), 20);
    expect(second.contacts?.map((c) => c.closed?.as)).toEqual([undefined, 'cleared']);
    expect(second.waypoints?.[0].turnedFrom).toBe('Saved items survive a reload, on any device.');
  });

  it('keeps an idea the captain spun off off the note until the lead takes it off the brief', () => {
    const spun = { ...briefedGoal(work, BRIEF, 10), spunOffIdeas: ['Show it in the header'] };
    const again = briefedGoal(spun, `${BRIEF}\n`, 20);
    expect(again.note?.next).toEqual(['Tidy the store code']);
    expect(again.spunOffIdeas).toEqual(['Show it in the header']);
    const gone = briefedGoal(again, BRIEF.replace('1. Show it in the header\n', ''), 30);
    expect(gone.note?.next).toEqual(['Tidy the store code']);
    expect(gone).not.toHaveProperty('spunOffIdeas');
  });
});

describe('a goal from before brief.md', () => {
  const noted = { ...work, note: { done: 'Works anywhere', learned: ['Store is fine'], next: ['Header'] }, contacts: [{ id: 'c1', text: 'Rate limits?', slice: 1, at: 0 }, { id: 'c2', text: 'Gone', slice: 1, at: 0, closed: { as: 'dropped' as const, slice: 1, at: 1 } }] };

  it('has its lead asked once to write the brief, from the note they kept', () => {
    expect(needsBrief(noted)).toBe(true);
    expect(needsBrief({ ...noted, briefAsked: true })).toBe(false);
    expect(needsBrief({ ...noted, briefMd: '' })).toBe(false);
    expect(needsBrief(work)).toBe(false);
    expect(noteAsBrief(noted)).toBe('# Saved items\n\n## Done looks like\n\nWorks anywhere\n\n## Learned\n\n- Store is fine\n\n## Next\n\n- Header\n\n## Loose threads\n\n- Rate limits?');
    expect(readBrief(noteAsBrief(noted))).toEqual({ title: 'Saved items', note: noted.note, threads: ['Rate limits?'] });
    expect(briefMovedNote(noted)).toMatch(/^\[Ops\] The goal's note is now a file you keep yourself: \.\/brief\.md.*The note tool is gone\./);
    expect(briefMovedNote(noted)).toContain(`\`\`\`markdown\n${noteAsBrief(noted)}\n\`\`\``);
  });
});

describe('the brief for the lead', () => {
  it('is the goal as the captain put it, and the brief as it stands', () => {
    const goal = { ...work, brief: 'Let shoppers save items for later', briefMd: '# Saved items\n\n## Next\n\n- Header\n' };
    expect(briefForPrompt(goal)).toBe(
      'The goal: Saved items\n\nAs the captain first put it:\n> Let shoppers save items for later\n\nYour brief, ./brief.md, as it stands:\n\n# Saved items\n\n## Next\n\n- Header',
    );
    // a one-liner is its own title, and a brief not written yet says so
    expect(briefForPrompt({ title: 'Saved items', brief: 'Saved items' })).toBe('The goal: Saved items\n\nYou haven\'t written ./brief.md yet.');
    expect(briefForPrompt({ title: 'Saved items', note: { done: 'Works', learned: [], next: [] } })).toContain('Your note as it stood (write it to ./brief.md):\n\n# Saved items\n\n## Done looks like\n\nWorks');
  });
});

describe('an edit of the brief', () => {
  it('is a file tool’s on ./brief.md in the workspace, however the path is put', () => {
    expect(editsBrief('/ws/lead1', { file_path: '/ws/lead1/brief.md' })).toBe(true);
    expect(editsBrief('/ws/lead1', { file_path: 'brief.md' })).toBe(true);
    expect(editsBrief('/ws/lead1', { file_path: '/ws/lead1/web/../brief.md' })).toBe(true);
    expect(editsBrief('/ws/lead1', { file_path: '/ws/lead1/web/brief.md' })).toBe(false);
    expect(editsBrief('/ws/lead1', { command: 'cat brief.md' })).toBe(false);
    expect(editsBrief('/ws/lead1', undefined)).toBe(false);
  });
});
