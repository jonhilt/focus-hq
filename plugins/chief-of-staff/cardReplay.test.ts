import { describe, expect, it } from 'vitest';
import type { JournalEntry, RunFact } from '../../plugin-api/server';
import { CARRY_ON_AFTER_LIMIT, conflictsResolvedNote } from '../../plugin-api/testing';
import { type DecisionFact, itemAgent, landedBy, leadCards, median, missed, senderOf, summarize, type VerdictFact } from './cardReplay';
import { answerText } from './inbox';
import { SENDER } from './shared';

const lead = { id: 'lead_p_1', projectId: 'p', name: 'Lt. Reyes', goal: 'A goal' };

/** A journal from facts, each a second after the last unless it says when (`t`). */
function journal(...facts: (RunFact & { t?: number })[]): JournalEntry[] {
  let t = 0;
  return facts.map((f, i) => {
    t = f.t ?? t + 1000;
    return { ...f, v: 1, seq: i + 1, t };
  });
}

/** A work turn `id` in session `s`, ending at `end`. */
const turn = (id: string, end: number, s = 'sess'): (RunFact & { t?: number })[] => [
  { kind: 'turn-requested', turn: id, turnKind: 'work', prompt: 'go', t: end - 3000 },
  { kind: 'turn-started', turn: id, session: s, t: end - 2000 },
  { kind: 'turn-ended', turn: id, outcome: { ok: true, started: true }, t: end },
  { kind: 'decided', turn: id, target: 'lead-done', t: end },
];

const verdict = (route: 1 | 2 | 3 | 4, at: number, sessionId = 'sess'): VerdictFact => ({ sessionId, route, why: `route ${route}`, at });
const none = { verdicts: [], decisions: [] };
const next = (id: string, t: number): RunFact & { t: number } => ({ kind: 'turn-requested', turn: id, turnKind: 'work', prompt: 'go', t });

describe('senderOf', () => {
  it('reads who a message is from by how Ops opens it, now and before it had its name', () => {
    expect(senderOf('[QA officer Lt. Varga] QA passed jonhilt/focus#1: fine')).toBe('qa');
    expect(senderOf('[Office] Slice 2 has landed: jonhilt/focus#559 merged. Carry on')).toBe('slice-landed');
    expect(senderOf('[Office] jonhilt/focus#588 had merge conflicts with `main`: Ensign X merged')).toBe('conflict');
    expect(senderOf('[Ops] Slice 2 has landed: jonhilt/focus#559 merged. Carry on')).toBe('slice-landed');
    expect(senderOf('[Ops] jonhilt/focus#588 had merge conflicts with `main`: Ensign X merged')).toBe('conflict');
    expect(senderOf('[Ops] something else')).toBe('ops');
    expect(senderOf('[Office] something else')).toBe('ops');
    expect(senderOf(`[${SENDER}] Show the captain the mockup first`)).toBe('chief-of-staff');
    expect(senderOf('[Quick answerer] While you were busy, the captain asked')).toBe('quick-answerer');
    expect(senderOf('Focus restarted while you were working, so your last turn was cut off')).toBe('restart');
    expect(senderOf('The office paused you mid-turn when its Claude usage limit was reached.')).toBe('plan-limit');
    expect(senderOf('Ops paused you mid-turn when its Claude usage limit was reached.')).toBe('plan-limit');
    expect(senderOf("Ops couldn't install the dependencies in your checkout")).toBe('ops');
    expect(senderOf("The office couldn't install the dependencies in your checkout")).toBe('ops');
    expect(senderOf('[Star chart] The captain spun contact c1 off')).toBe('plugin:Star chart');
    expect(senderOf('yes let’s do A')).toBe('captain');
  });

  it('reads the notes Ops sends as it words them now', () => {
    const pr = { repo: 'a/b', number: 2, baseBranch: 'main', branch: 'focus/x' };
    expect(senderOf(`[Ops] ${conflictsResolvedNote(pr, 'b', 'Ensign X')}`)).toBe('conflict');
    expect(senderOf(CARRY_ON_AFTER_LIMIT)).toBe('plan-limit');
  });
});

describe('leadCards', () => {
  it('a card the captain answers first closes as theirs, judged by the verdict on its session', () => {
    const entries = journal(...turn('t1', 10_000), { kind: 'queued', text: 'yes', at: 'end', t: 70_000 }, { kind: 'waiting' }, next('t2', 72_000));
    const decisions: DecisionFact[] = [{ kind: 'turn', answer: 'yes', via: 'office', at: 70_000 }];
    const [card] = leadCards(lead, entries, { verdicts: [verdict(2, 30_000), verdict(4, 20_000, 'other')], decisions });
    expect(card).toMatchObject({ turn: 't1', route: 2, why: 'route 2', outcome: 'captain', by: 'captain', captainSpoke: true, openedAt: 10_000, wokeAt: 71_000, closedAt: 72_000, waitMs: 62_000 });
    expect(card.decisions).toEqual(decisions);
  });

  it('a card a QA verdict woke the lead from is superseded, the captain having said nothing', () => {
    const entries = journal(...turn('t1', 10_000), { kind: 'queued', text: '[QA officer Lt. Varga] QA failed jonhilt/focus#1: broken', at: 'end', t: 40_000 }, { kind: 'waiting' }, next('t2', 42_000));
    const [card] = leadCards(lead, entries, { verdicts: [verdict(3, 15_000)], decisions: [] });
    expect(card).toMatchObject({ route: 3, outcome: 'superseded', by: 'qa', captainSpoke: false, waitMs: 32_000 });
    expect(missed([card])).toEqual([card]);
  });

  it('news that costs no turn waits in the inbox: what woke the lead is the message queued last before they were picked up', () => {
    const entries = journal(
      ...turn('t1', 10_000),
      { kind: 'queued', text: '[QA officer Lt. Varga] QA passed jonhilt/focus#1: fine', at: 'end', t: 20_000 },
      { kind: 'queued', text: '[Office] Slice 1 has landed: jonhilt/focus#1 merged. Carry on', at: 'end', t: 30_000 },
      { kind: 'waiting' },
      { kind: 'queued', text: 'and also this', at: 'end' },
      next('t2', 40_000),
    );
    const [card] = leadCards(lead, entries, { verdicts: [verdict(2, 12_000)], decisions: [], merges: [{ repo: 'jonhilt/focus', pr: 1, by: 'captain' }] });
    expect(card).toMatchObject({ outcome: 'superseded', by: 'slice-landed', mergedBy: 'captain', captainSpoke: true });
    expect(card.waker?.text).toMatch(/^\[Office\] Slice 1/);
    expect(card.messages.map((m) => m.sender)).toEqual(['qa', 'slice-landed', 'captain']);
  });

  it('a note wakes nobody: what woke the lead is the message after it, and a landing’s note says who merged', () => {
    const entries = journal(
      ...turn('t1', 10_000),
      { kind: 'queued', text: '[Ops] Slice 1 has landed: jonhilt/focus#1 merged. Your repos move to fresh code', at: 'note', t: 20_000 },
      { kind: 'queued', text: "[Ops] Slice 1 has landed: carry on with what's next", at: 'end', t: 20_000 },
      { kind: 'waiting' },
      next('t2', 25_000),
    );
    const [card] = leadCards(lead, entries, { verdicts: [], decisions: [], merges: [{ repo: 'jonhilt/focus', pr: 1, by: 'captain' }] });
    expect(card).toMatchObject({ outcome: 'superseded', by: 'slice-landed', mergedBy: 'captain' });
    expect(card.waker?.text).toMatch(/carry on/);
    // a note alone, then the captain's message: the captain woke them
    const captain = leadCards(lead, journal(...turn('t1', 10_000), { kind: 'queued', text: '[QA officer Lt. Varga] QA failed jonhilt/focus#1', at: 'note', t: 20_000 }, { kind: 'queued', text: 'fix it', at: 'end', t: 30_000 }, { kind: 'waiting' }, next('t2', 31_000)), none);
    expect(captain[0]).toMatchObject({ outcome: 'captain', by: 'captain' });
  });

  it('the chief of staff’s words sent tell who pressed send', () => {
    // the words and the decision line as the chief of staff sends and records them
    const words = { kind: 'queued' as const, text: `[${SENDER}] Check legibility first`, at: 'end' as const, t: 50_000 };
    const auto = leadCards(lead, journal(...turn('t1', 10_000), words, { kind: 'waiting' }, next('t2', 52_000)), { verdicts: [verdict(4, 11_000)], decisions: [{ kind: 'turn', answer: answerText({ send: true }), via: 'chief-of-staff', at: 50_000 }] });
    expect(auto[0]).toMatchObject({ outcome: 'cos-sent', cosSentBy: 'auto', route: 4 });
    const pressed = leadCards(lead, journal(...turn('t1', 10_000), words, { kind: 'waiting' }, next('t2', 52_000)), { verdicts: [], decisions: [{ kind: 'turn', answer: answerText({ send: true }), via: 'office', at: 50_000 }] });
    expect(pressed[0]).toMatchObject({ outcome: 'cos-sent', cosSentBy: 'captain', route: 'unjudged' });
  });

  it('a message into a session still listening is what closed it', () => {
    const entries = journal(...turn('t1', 10_000), { kind: 'sent', turn: 't1', text: 'still going?', t: 20_000 }, next('t2', 25_000));
    expect(leadCards(lead, entries, none)[0]).toMatchObject({ outcome: 'captain', wokeAt: 20_000, closedAt: 25_000 });
  });

  it('a next turn started with nothing sent is Ops’ own doing', () => {
    const entries = journal(...turn('t1', 10_000), next('t2', 11_000));
    expect(leadCards(lead, entries, none)[0]).toMatchObject({ outcome: 'superseded', by: 'none' });
  });

  it('a compaction Ops starts leaves the card open; a message sent into it is what woke the lead', () => {
    const entries = journal(
      ...turn('t1', 10_000),
      { kind: 'turn-requested', turn: 'c', turnKind: 'compact', prompt: '/compact', t: 20_000 },
      { kind: 'sent', turn: 'c', text: '[Office] Slice 3 has landed: jonhilt/focus#9 merged. Carry on', t: 21_000 },
      { kind: 'turn-ended', turn: 'c', outcome: { ok: true } },
      next('t2', 30_000),
    );
    const cards = leadCards(lead, entries, none);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ outcome: 'superseded', by: 'slice-landed', wokeAt: 21_000, closedAt: 30_000 });
    expect(cards[0].mergedBy).toBeUndefined();
  });

  it('news held for the end of the turn is heard as the card opens, and carries the lead straight on', () => {
    const entries = journal(
      { kind: 'turn-requested', turn: 't1', turnKind: 'work', prompt: 'go', t: 1000 },
      { kind: 'queued', text: '[QA officer Lt. Varga] QA passed jonhilt/focus#1', at: 'later', t: 5000 },
      { kind: 'turn-ended', turn: 't1', outcome: { ok: true }, t: 10_000 },
      { kind: 'released', t: 10_000 },
      { kind: 'decided', turn: 't1', target: 'lead-done', t: 10_000 },
      { kind: 'waiting', t: 10_000 },
      next('t2', 10_500),
    );
    expect(leadCards(lead, entries, none)[0]).toMatchObject({ outcome: 'superseded', by: 'qa', waitMs: 500 });
  });

  it('a lead sent home ends the card; one never woken stays open', () => {
    const ended = leadCards(lead, journal(...turn('t1', 10_000), { kind: 'reset', t: 20_000 }), { verdicts: [], decisions: [{ kind: 'wrap-up', answer: 'Closed the goal', via: 'office', at: 19_000 }] });
    expect(ended[0]).toMatchObject({ outcome: 'ended', closedAt: 20_000, captainSpoke: true });
    const open = leadCards(lead, journal(...turn('t1', 10_000), { kind: 'queued', text: '[QA officer X] QA passed', at: 'end' }), none);
    expect(open[0]).toMatchObject({ outcome: 'open', captainSpoke: false });
    expect(open[0].closedAt).toBeUndefined();
  });

  it('no card for a compaction, a turn Ops carries on by itself, or a verdict too late or already used', () => {
    const entries = journal(
      { kind: 'turn-requested', turn: 'c', turnKind: 'compact', prompt: '/compact', t: 1000 },
      { kind: 'turn-ended', turn: 'c', outcome: { ok: true }, t: 2000 },
      ...turn('t1', 10_000),
      { kind: 'turn-requested', turn: 't2', turnKind: 'work', prompt: 'go', t: 11_000 },
      { kind: 'turn-started', turn: 't2', session: 'sess', t: 11_500 },
      { kind: 'turn-ended', turn: 't2', outcome: { ok: false, limited: true }, t: 12_000 },
      { kind: 'turn-requested', turn: 't3', turnKind: 'work', prompt: 'go', t: 13_000 },
      { kind: 'turn-started', turn: 't3', session: 'sess', t: 13_500 },
      { kind: 'turn-ended', turn: 't3', outcome: { ok: true }, t: 14_000 },
      { kind: 'decided', turn: 't3', target: 'carry-on', t: 14_000 },
      ...turn('t4', 20_000),
    );
    const cards = leadCards(lead, entries, { verdicts: [verdict(2, 10_500), verdict(3, 20_000 + 11 * 60_000)], decisions: [] });
    expect(cards.map((c) => [c.turn, c.route])).toEqual([['t1', 2], ['t4', 'unjudged']]);
  });
});

describe('summarize', () => {
  it('counts cards per route and outcome, with the median wait of those that closed', () => {
    const a = leadCards(lead, journal(...turn('t1', 10_000), { kind: 'queued', text: 'ok', at: 'end', t: 20_000 }, next('t2', 20_000), ...turn('t2', 30_000), next('t3', 70_000), ...turn('t3', 80_000)), { verdicts: [verdict(2, 11_000), verdict(2, 31_000)], decisions: [] });
    const rows = summarize(a);
    expect(rows.map((r) => r.route)).toEqual([2, 'unjudged', 'all']);
    expect(rows[0]).toMatchObject({ total: 2, counts: { captain: 1, superseded: 1 }, medianWaitMs: 25_000 });
    expect(rows[2]).toMatchObject({ total: 3, counts: { open: 1 } });
  });

  it('takes the median of an odd or even count, and none of nothing', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe('landedBy', () => {
  it('finds who merged the first pull request a landing names', () => {
    const merges = [{ repo: 'a/b', pr: 2, by: 'office' }];
    expect(landedBy('[Office] Slice 1 has landed: a/b#2 merged, a/c#3 merged.', merges)).toBe('office');
    expect(landedBy('[Office] Slice 1 has landed: a/b#4 merged.', merges)).toBeUndefined();
    expect(landedBy('nothing here', merges)).toBeUndefined();
  });
});

describe('itemAgent', () => {
  it('reads the agent out of an inbox item’s id', () => {
    expect(itemAgent('turn:lead_proj_4af56fee46_795654:1792592216806')).toBe('lead_proj_4af56fee46_795654');
    expect(itemAgent('question:lead_x:q1')).toBe('lead_x');
    expect(itemAgent('nonsense')).toBeUndefined();
  });
});

describe('leadCards only opens a card for a finished (lead-done) turn', () => {
  it.each(['fail', 'stopped'] as const)('a turn decided %s is no card', (target) => {
    const entries = journal(
      { kind: 'turn-requested', turn: 't1', turnKind: 'work', prompt: 'go' },
      { kind: 'turn-started', turn: 't1', session: 's' },
      { kind: 'turn-ended', turn: 't1', outcome: { ok: false, started: true } },
      { kind: 'decided', turn: 't1', target },
    );
    expect(leadCards(lead, entries, none)).toEqual([]);
  });
});
