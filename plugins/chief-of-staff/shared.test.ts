import { describe, expect, it } from 'vitest';
import { answersOf, cosReadOf, cosStateOf, MAX_ASKS, MAX_REPLY_LABEL, MAX_REPLY_TEXT, readOf, repliesOf, verdictOf } from './shared';

const verdict = { route: 2, asks: [{ ask: 'Filters first?' }], why: 'A pick.', message: 'Filters.' };
const back = { route: 4, asks: [{ ask: 'Test it first' }], why: 'No evidence.', message: 'Test it first.' };

describe('its mark on a lead’s turn, read back', () => {
  it('is a read when it has the shape of one, its words’ time only once judged', () => {
    expect(cosReadOf({ at: 5 })).toEqual({ at: 5 });
    expect(cosReadOf({ at: 5, judged: back, sendsAt: 9 })).toEqual({ at: 5, judged: back, sendsAt: 9 });
    expect(cosReadOf({ at: 5, sendsAt: 9 })).toEqual({ at: 5 });
    // only words sending a turn back count down: a carry-on's countdown from an older version is dropped
    expect(cosReadOf({ at: 5, judged: { ...back, route: 1 }, sendsAt: 9 })).toEqual({ at: 5, judged: { ...back, route: 1 } });
    expect(cosReadOf({ at: 5, judged: { ...verdict, route: 7 } })).toEqual({ at: 5 });
    for (const not of [undefined, 'reading', {}, { at: '5' }]) expect(cosReadOf(not)).toBeUndefined();
  });

  it('keeps when the captain acknowledged the turn, and drops a countdown once they have', () => {
    expect(cosReadOf({ at: 5, acked: 7 })).toEqual({ at: 5, acked: 7 });
    expect(cosReadOf({ at: 5, judged: back, sendsAt: 9, acked: 7 })).toEqual({ at: 5, judged: back, acked: 7 });
    expect(cosReadOf({ at: 5, acked: 'yes' })).toEqual({ at: 5 });
  });

  it('reads each ask’s suggested replies, and one from before it suggested any as suggesting none', () => {
    const replies = [{ label: 'Keep it open', text: 'Keep the goal open.' }, { label: 'Close it', text: 'Close it.' }];
    expect(verdictOf({ ...verdict, asks: [{ ask: 'Filters first?', replies }] })).toEqual({ ...verdict, asks: [{ ask: 'Filters first?', replies }] });
    expect(verdictOf(verdict)).toEqual(verdict);
    expect(verdictOf({ ...verdict, asks: [{ ask: 'Filters first?', replies: 'yes' }] })).toEqual(verdict);
    expect(verdictOf({ ...verdict, asks: [{ ask: 'Filters first?', replies: [] }] })).toEqual(verdict);
  });

  it('reads a verdict kept before a turn could ask several things, its one ask and replies, as a list of one', () => {
    const replies = [{ label: 'Close it', text: 'Close it.' }];
    const old = { route: 2, ask: 'Filters first?', why: 'A pick.', message: 'Filters.' };
    expect(verdictOf(old)).toEqual(verdict);
    expect(verdictOf({ ...old, replies })).toEqual({ ...verdict, asks: [{ ask: 'Filters first?', replies }] });
    expect(cosReadOf({ at: 5, judged: { ...old, replies } })).toEqual({ at: 5, judged: { ...verdict, asks: [{ ask: 'Filters first?', replies }] } });
    // with no ask at all it isn't a verdict
    expect(verdictOf({ route: 2, why: 'A pick.', message: 'm' })).toBeUndefined();
    expect(verdictOf({ ...verdict, asks: [{ ask: ' ' }] })).toBeUndefined();
  });

  it('keeps several asks, MAX_ASKS at most, dropping any that isn’t one', () => {
    const asks = ['a?', 'b?', 'c?', 'd?', 'e?'].map((ask) => ({ ask }));
    expect(verdictOf({ ...verdict, asks: [asks[0], 'x', { replies: [] }, ...asks.slice(1)] })?.asks).toEqual(asks.slice(0, MAX_ASKS));
  });

  it('keeps the answers held to a judged turn’s asks, each ask’s latest, and none for an ask it doesn’t have', () => {
    const judged = { ...verdict, asks: [{ ask: 'a?' }, { ask: 'b?' }] };
    expect(cosReadOf({ at: 5, judged, answers: [{ ask: 1, text: ' Yes ' }, { ask: 0, text: 'No' }, { ask: 1, text: 'Later' }, { ask: 2, text: 'x' }] }))
      .toEqual({ at: 5, judged, answers: [{ ask: 0, text: 'No' }, { ask: 1, text: 'Later' }] });
    expect(cosReadOf({ at: 5, answers: [{ ask: 0, text: 'No' }] })).toEqual({ at: 5 });
    expect(answersOf([{ ask: -1, text: 'x' }, { ask: 0.5, text: 'x' }, { ask: 0, text: '' }, 'x', null])).toEqual([]);
    expect(answersOf('x')).toEqual([]);
  });

  it('keeps the check that decided a verdict, so a watch can tell a hail, and reads one from before it named one as naming none', () => {
    expect(verdictOf({ ...verdict, check: 'irreversible' })).toEqual({ ...verdict, check: 'irreversible' });
    expect(verdictOf({ ...verdict, check: 'gut feel' })).toEqual(verdict);
  });

  it('takes a reply only with a label and words, each label once, three at most', () => {
    expect(repliesOf([{ label: ' Go ', text: ' Yes, go. ' }, { label: 'go', text: 'Again' }, { label: '', text: 'x' }, { label: 'x' }, 'Go', null, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }]))
      .toEqual([{ label: 'Go', text: 'Yes, go.' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }]);
    expect(repliesOf(undefined)).toEqual([]);
  });

  it('drops a reply whose label would run off its button, or whose words are a letter, rather than clip it', () => {
    const label = 'x'.repeat(MAX_REPLY_LABEL);
    const text = 'y'.repeat(MAX_REPLY_TEXT);
    expect(repliesOf([
      { label: 'Keep the goal open and start the settings page slice next', text: 'Keep it open.' },
      { label: 'Close it', text: `${text}y` },
      { label: ` ${label} `, text: ` ${text} ` },
    ])).toEqual([{ label, text }]);
    expect(verdictOf({ ...verdict, asks: [{ ask: 'Filters first?', replies: [{ label: `${label}x`, text: 'Go.' }] }] })).toEqual(verdict);
  });

  it('is read from the lead’s marks, under the plugin’s id', () => {
    expect(readOf({ lead: { title: 'W', repos: [], slice: 1, prs: [], marks: { 'chief-of-staff': { at: 3 }, other: 'x' } } })).toEqual({ at: 3 });
    expect(readOf({ lead: undefined })).toBeUndefined();
  });
});

describe('what it keeps across a restart, read back', () => {
  it('keeps the goal at the conn and the hails stood by, and reads what was kept before the watch as no watch', () => {
    expect(cosStateOf({ autoSend: { p: true }, conn: 'lead-1', stoodBy: ['turn:b:4', 7] })).toEqual({ autoSend: { p: true }, jev: {}, conn: 'lead-1', stoodBy: ['turn:b:4'] });
    expect(cosStateOf({ autoSend: {}, conn: '' })).toEqual({ autoSend: {}, jev: {} });
    expect(cosStateOf(undefined)).toEqual({ autoSend: {}, jev: {} });
    // a goal it started from the line keeps whether the user closed it and whether they heard of it in the muster
    const kept = cosStateOf({ autoSend: {}, line: { started: [{ key: 'p|x', leadId: 'l', projectId: 'p', project: 'P', text: 'x', why: 'y', at: 1, closed: 3, acked: 2 }, { key: 'p|y', leadId: 'm', acked: 'soon' }] } });
    expect(kept.line?.started).toEqual([
      { key: 'p|x', leadId: 'l', projectId: 'p', project: 'P', text: 'x', why: 'y', at: 1, closed: 3, acked: 2 },
      { key: 'p|y', leadId: 'm', projectId: '', project: '', text: '', why: '', at: 0 },
    ]);
  });
});
