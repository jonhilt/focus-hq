import { describe, expect, it } from 'vitest';
import { ackStep, closeStep, goalKey, lineAfterRestart, normalised, sayStep, startedWaiting, startStep, tellStep } from './lineRules';
import { freshLine, type LineStart } from './shared';

const projects = [{ id: 'p', name: 'Web shop' }, { id: 'q', name: 'API' }];
const started = (over: Partial<LineStart> = {}): LineStart => ({
  key: goalKey('p', 'Add dark mode'), leadId: 'lead-1', projectId: 'p', project: 'Web shop', text: 'Add dark mode', why: 'You asked', at: 1, ...over,
});

describe('a goal’s key', () => {
  it('is the project and its words, whatever their case, punctuation or spacing', () => {
    expect(normalised('  Add   dark-mode! ')).toBe('add dark mode');
    expect(goalKey('p', 'Add dark mode.')).toBe(goalKey('p', 'add  DARK mode'));
    expect(goalKey('p', 'Add dark mode')).not.toBe(goalKey('q', 'Add dark mode'));
  });
});

describe('starting a goal from the line', () => {
  const call = { projectId: 'p', text: 'add dark mode!', why: 'You want it before the launch' };

  it('starts one it hasn’t started, keyed by its project and words', () => {
    expect(startStep(call, { projects, started: [], aboard: new Set() })).toEqual({ kind: 'start', key: 'p|add dark mode' });
  });

  it('finds one it started already and still open, rather than starting it twice (a retried or resumed turn)', () => {
    const s = started();
    expect(startStep(call, { projects, started: [s], aboard: new Set(['lead-1']) })).toEqual({ kind: 'already', start: s });
  });

  it('starts it again once the user closed it from the line, or its goal has gone', () => {
    expect(startStep(call, { projects, started: [started({ closed: 5 })], aboard: new Set(['lead-1']) }).kind).toBe('start');
    expect(startStep(call, { projects, started: [started()], aboard: new Set() }).kind).toBe('start');
  });

  it('refuses a project not on the line, naming those that are', () => {
    const step = startStep({ ...call, projectId: 'zz' }, { projects, started: [], aboard: new Set() });
    expect(step).toEqual({ kind: 'refuse', why: 'There\'s no project zz on your line. The projects are: Web shop (p), API (q).' });
  });

  it('refuses without the goal’s words, or without why', () => {
    expect(startStep({ ...call, text: ' ?! ' }, { projects, started: [], aboard: new Set() }).kind).toBe('refuse');
    expect(startStep({ ...call, why: ' ' }, { projects, started: [], aboard: new Set() }).kind).toBe('refuse');
  });
});

describe('telling a goal from the line', () => {
  const told = { leadId: 'lead-1', goal: 'Saved items', text: 'Mind the footer!', at: 5 };

  it('tells an open goal’s lead on the line', () => {
    expect(tellStep({ leadId: 'lead-1', text: 'Mind the footer' }, { goals: [{ id: 'lead-1' }], told: [] })).toEqual({ kind: 'tell', leadId: 'lead-1' });
  });

  it('finds the same words told them already, rather than telling them twice', () => {
    expect(tellStep({ leadId: 'lead-1', text: 'mind the  footer' }, { goals: [{ id: 'lead-1' }], told: [told] })).toEqual({ kind: 'already' });
    expect(tellStep({ leadId: 'lead-2', text: 'mind the footer' }, { goals: [{ id: 'lead-2' }], told: [told] }).kind).toBe('tell');
  });

  it('refuses anyone else, or nothing to say', () => {
    expect(tellStep({ leadId: 'lead-2', text: 'Hi' }, { goals: [{ id: 'lead-1' }], told: [] }).kind).toBe('refuse');
    expect(tellStep({ leadId: 'lead-1', text: ' ' }, { goals: [{ id: 'lead-1' }], told: [] }).kind).toBe('refuse');
  });
});

describe('closing a goal it started', () => {
  it('closes it while its lead is aboard', () => {
    const s = started();
    expect(closeStep(s.key, [s], new Set(['lead-1']))).toEqual({ kind: 'close', start: s });
  });

  it('only marks it closed when its goal has gone some other way', () => {
    const s = started();
    expect(closeStep(s.key, [s], new Set())).toEqual({ kind: 'mark', start: s });
  });

  it('refuses one closed already, so pressing twice closes it once, and one it never started', () => {
    expect(closeStep(started().key, [started({ closed: 3 })], new Set(['lead-1'])).kind).toBe('refuse');
    expect(closeStep('p|nope', [started()], new Set(['lead-1'])).kind).toBe('refuse');
  });

  it('goes by the latest start of a goal started again after closing', () => {
    const again = started({ leadId: 'lead-2', at: 9 });
    expect(closeStep(again.key, [started({ closed: 5 }), again], new Set(['lead-2']))).toEqual({ kind: 'close', start: again });
  });
});

// README.md: "each goal it starts waits in the muster until the user hears of it or closes it"
describe('the goals it started, waiting in the muster', () => {
  it('waits while its goal is open and the user hasn’t heard of it, newest first', () => {
    const older = started();
    const newer = started({ key: 'p|search', leadId: 'lead-2', at: 5 });
    expect(startedWaiting([older, newer], new Set(['lead-1', 'lead-2']))).toEqual([newer, older]);
  });

  it('leaves once acknowledged, closed from the line or the muster, or its lead gone some other way', () => {
    expect(startedWaiting([started({ acked: 4 })], new Set(['lead-1']))).toEqual([]);
    expect(startedWaiting([started({ closed: 4 })], new Set(['lead-1']))).toEqual([]);
    expect(startedWaiting([started()], new Set())).toEqual([]);
  });

  it('acknowledges one waiting, once however often Got it is pressed, and nothing it never started', () => {
    const s = started();
    expect(ackStep(s.key, [s], new Set(['lead-1']))).toEqual({ kind: 'ack', start: s });
    expect(ackStep(s.key, [started({ acked: 3 })], new Set(['lead-1']))).toEqual({ kind: 'refuse', why: 'That’s no longer waiting on you' });
    expect(ackStep(s.key, [started({ closed: 3 })], new Set(['lead-1'])).kind).toBe('refuse');
    expect(ackStep(s.key, [s], new Set()).kind).toBe('refuse');
    expect(ackStep('p|nope', [s], new Set(['lead-1'])).kind).toBe('refuse');
  });

  it('goes by the latest start of a goal started again after closing', () => {
    const again = started({ leadId: 'lead-2', at: 9 });
    expect(ackStep(again.key, [started({ closed: 5 }), again], new Set(['lead-2']))).toEqual({ kind: 'ack', start: again });
  });
});

describe('the line after a restart', () => {
  it('ends a turn Focus went down in as failed, and leaves any other as it was', () => {
    const line = { ...freshLine(), status: 'thinking' as const };
    expect(lineAfterRestart(line)).toMatchObject({ status: 'failed', error: expect.stringContaining('Interrupted') });
    const waiting = freshLine();
    expect(lineAfterRestart(waiting)).toBe(waiting);
  });
});

describe('saying something on the line', () => {
  it('takes words while it’s not thinking, trimmed', () => {
    expect(sayStep({ status: 'failed' }, '  hello ')).toEqual({ kind: 'say', text: 'hello' });
  });

  it('refuses while a turn runs, or nothing said', () => {
    expect(sayStep({ status: 'thinking' }, 'hello').kind).toBe('refuse');
    expect(sayStep({ status: 'waiting' }, '  ').kind).toBe('refuse');
  });
});
