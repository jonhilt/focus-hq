import { describe, expect, it } from 'vitest';
import { CLOSED_SHOWN, EMPTY_PERSONAL_LOG, entryIn, entryText, logFrom, personalMark, evolvePersonalLog, type PersonalFact, personalLogView, snoozeUntil } from './personalLog';

const fold = (...facts: (PersonalFact & { t?: number })[]) =>
  facts.reduce((log, f, i) => evolvePersonalLog(log, { ...f, seq: i + 1, t: f.t ?? (i + 1) * 1000 }), EMPTY_PERSONAL_LOG);

describe('the personal log', () => {
  it('keeps what was jotted down, open, stamped with when', () => {
    const log = fold({ kind: 'noted', id: 'a', text: 'A video about briefings', from: 'remote' });
    expect(log).toEqual({ seq: 1, entries: [{ id: 'a', text: 'A video about briefings', from: 'remote', at: 1000, status: 'open' }] });
  });

  it('notes an entry once, however many times it is told', () => {
    const log = fold({ kind: 'noted', id: 'a', text: 'one', from: 'office' }, { kind: 'noted', id: 'a', text: 'again', from: 'office' });
    expect(log.entries.map((e) => e.text)).toEqual(['one']);
    expect(log.seq).toBe(2);
  });

  it('edits, closes, puts aside and reopens an entry', () => {
    const noted = { kind: 'noted', id: 'a', text: 'one', from: 'office' } as const;
    expect(fold(noted, { kind: 'edited', id: 'a', text: 'two' }).entries[0]?.text).toBe('two');
    expect(fold(noted, { kind: 'done', id: 'a', t: 5000 }).entries[0]).toMatchObject({ status: 'done', closedAt: 5000 });
    expect(fold(noted, { kind: 'snoozed', id: 'a', until: 9000 }, { kind: 'dropped', id: 'a', t: 6000 }).entries[0]).toMatchObject({ status: 'dropped', until: undefined });
    expect(fold(noted, { kind: 'done', id: 'a' }, { kind: 'reopened', id: 'a' }).entries[0]).toMatchObject({ status: 'open', closedAt: undefined });
  });

  it('ignores a fact about an entry it never heard of', () => {
    expect(fold({ kind: 'done', id: 'nope' }).entries).toEqual([]);
  });

  it('finds an entry by id, or says there is none', () => {
    const { entries } = fold({ kind: 'noted', id: 'a', text: 'one', from: 'office' });
    expect(entryIn(entries, 'a').text).toBe('one');
    expect(() => entryIn(entries, 'b')).toThrow('No such entry');
  });
});

describe('the console’s view of it', () => {
  const log = fold(
    { kind: 'noted', id: 'old', text: 'old', from: 'office', t: 1000 },
    { kind: 'noted', id: 'new', text: 'new', from: 'office', t: 2000 },
    { kind: 'noted', id: 'aside', text: 'aside', from: 'office', t: 3000 },
    { kind: 'snoozed', id: 'aside', until: 10_000 },
    { kind: 'noted', id: 'back', text: 'back', from: 'office', t: 500 },
    { kind: 'snoozed', id: 'back', until: 4000 },
    { kind: 'noted', id: 'gone', text: 'gone', from: 'office' },
    { kind: 'done', id: 'gone' },
  );

  it('shows what is open newest first, with what is back from being put aside, then what is still aside', () => {
    const view = personalLogView(log.entries, 5000);
    expect(view.open.map((e) => e.id)).toEqual(['new', 'old', 'back']);
    expect(view.later.map((e) => e.id)).toEqual(['aside']);
    expect(view.closed.map((e) => e.id)).toEqual(['gone']);
  });

  it('shows only the latest of what was closed', () => {
    const many = Array.from({ length: CLOSED_SHOWN + 5 }, (_, i) => ({ id: `${i}`, text: 'x', from: 'office' as const, at: i, status: 'done' as const, closedAt: i }));
    const closed = personalLogView(many, 0).closed;
    expect(closed).toHaveLength(CLOSED_SHOWN);
    expect(closed[0]?.id).toBe(`${CLOSED_SHOWN + 4}`);
  });
});

describe('an entry’s text', () => {
  it('is trimmed, and refused empty or too long', () => {
    expect(entryText('  an idea \n')).toBe('an idea');
    expect(() => entryText('   ')).toThrow('Say what to remember');
    expect(() => entryText(42)).toThrow();
    expect(() => entryText('x'.repeat(2001))).toThrow('under 2000');
  });
});

describe('putting an entry aside', () => {
  it('brings it back at nine the next morning, or a week on', () => {
    const now = new Date(2026, 9, 16, 22, 30);
    expect(new Date(snoozeUntil(now, 'tomorrow'))).toEqual(new Date(2026, 9, 17, 9));
    expect(new Date(snoozeUntil(now, 'week'))).toEqual(new Date(2026, 9, 23, 9));
  });
});

describe('what the captain did with an entry, as asked', () => {
  it('reads each kind', () => {
    expect(personalMark('a', { kind: 'done' })).toEqual({ kind: 'done', id: 'a' });
    expect(personalMark('a', { kind: 'reopened', text: 'ignored' })).toEqual({ kind: 'reopened', id: 'a' });
    expect(personalMark('a', { kind: 'edited', text: 'new' })).toEqual({ kind: 'edited', id: 'a', text: 'new' });
    expect(personalMark('a', { kind: 'snoozed', until: 5000 })).toEqual({ kind: 'snoozed', id: 'a', until: 5000 });
  });

  it('refuses a kind it does not know, or a snooze without a time', () => {
    expect(() => personalMark('a', { kind: 'noted' })).toThrow('kind must be one of');
    expect(() => personalMark('a', {})).toThrow('kind must be one of');
    expect(() => personalMark('a', { kind: 'snoozed', until: '5000' })).toThrow('Say until when');
    expect(() => personalMark('a', { kind: 'snoozed', until: Number.NaN })).toThrow('Say until when');
  });

  it('takes an entry as from off the ship only when it says so', () => {
    expect(logFrom('remote')).toBe('remote');
    expect(logFrom(undefined)).toBe('office');
    expect(logFrom('anything')).toBe('office');
  });
});

describe('what the captain did with an entry, from any request', () => {
  it('leaves an edit without text for the log to refuse', () => {
    expect(personalMark('a', { kind: 'edited', text: 7 })).toEqual({ kind: 'edited', id: 'a', text: '' });
  });

  it('asks until when for a snooze that never ends, or says nothing', () => {
    for (const until of [undefined, Number.POSITIVE_INFINITY]) {
      expect(() => personalMark('a', { kind: 'snoozed', until })).toThrow('Say until when');
    }
  });

  it('refuses a request with no mark at all, as when it has no JSON body', () => {
    for (const body of [undefined, null, 'done', ['done'], { kind: 'DONE' }]) {
      expect(() => personalMark('a', body)).toThrow('kind must be one of edited, done, dropped, snoozed, reopened');
    }
  });
});
