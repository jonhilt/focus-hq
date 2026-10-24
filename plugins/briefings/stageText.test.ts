import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { type Box, colourAlpha, readStageText, STAGE_TEXT_SCRIPT, type StageElement, type StageText, type StageTextRun, textClashes } from './stageText';

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
const STAGE = box(200, 58, 1050, 500);
/** An element of the stage as the page measures it: in flow, seen, nothing cut, in the stage. */
const el = (over: Partial<StageElement> = {}): StageElement => ({ up: 0, position: 'static', transformed: false, overflow: ['visible', 'visible'], opacity: 1, hidden: false, colour: 'rgb(241, 234, 255)', box: STAGE, ...over });
const stage = el({ up: -1, position: 'absolute' });
/** A line of text as a range's box has it at 18px: 24px tall. */
const line = (x: number, y: number, w: number): Box => box(x, y, w, 24);
const run = (text: string, at: number, ...boxes: Box[]): StageTextRun => ({ text, el: at, boxes });
const seen = (els: StageElement[], ...texts: StageTextRun[]): StageText => ({ els: [stage, ...els], texts });

describe('text drawn over other text', () => {
  it('finds a label drawn over its card’s own text', () => {
    const card = el({ position: 'absolute', overflow: ['hidden', 'hidden'], box: box(300, 100, 400, 200) });
    const label = el({ up: 1, position: 'absolute' });
    const body = el({ up: 1 });
    const text = seen([card, label, body], run('1 · MEMORY', 2, line(316, 110, 90)), run('Loose threads kept across sessions', 3, line(316, 110, 260), line(316, 134, 120)));
    expect(textClashes(text)).toEqual({ over: [['1 · MEMORY', 'Loose threads kept across sessions']], cut: [] });
  });

  it('finds capsules in a row drawn over each other, naming the smaller first', () => {
    const pill = el({ position: 'absolute' });
    const text = seen([pill, pill], run('Drop what no longer matters', 2, line(450, 200, 210)), run('Steers by agreed intents', 1, line(300, 200, 190)));
    expect(textClashes(text).over).toEqual([['Steers by agreed intents', 'Drop what no longer matters']]);
  });

  it('doesn’t count text that only touches, or meets by a letter’s spacing', () => {
    const pill = el({ position: 'absolute' });
    const beside = (gap: number) => seen([pill, pill], run('Steers by agreed intents', 1, line(300, 200, 190)), run('Drop what no longer matters', 2, line(490 + gap, 200, 210)));
    expect(textClashes(beside(0)).over).toEqual([]);
    expect(textClashes(beside(-3)).over).toEqual([]);
    expect(textClashes(beside(-12)).over).toEqual([]);
    expect(textClashes(beside(-30)).over).toHaveLength(1);
  });

  it('doesn’t count lines one under another, even set tight (a line height of 1)', () => {
    const text = seen([el(), el()], run('Purpose', 1, line(300, 100, 80)), run('What the lead is for', 2, line(300, 118, 200)));
    expect(textClashes(text).over).toEqual([]);
    const overlapping = seen([el(), el()], run('Purpose', 1, line(300, 100, 80)), run('What the lead is for', 2, line(300, 108, 200)));
    expect(textClashes(overlapping).over).toHaveLength(1);
  });

  it('leaves out text too faint to see, hidden, or out of sight', () => {
    const under = run('Loose threads kept', 1, line(300, 100, 200));
    const over = (...els: StageElement[]) => textClashes(seen([el(), ...els], under, run('Purpose', els.length + 1, line(310, 100, 80)))).over;
    expect(over(el())).toHaveLength(1);
    expect(over(el({ opacity: 0.1 }))).toEqual([]);
    // opacity through every ancestor: 0.3 of 0.3 is too faint
    expect(over(el({ opacity: 0.3 }), el({ up: 2, opacity: 0.3 }))).toEqual([]);
    expect(over(el({ hidden: true }))).toEqual([]);
    expect(over(el({ colour: 'rgba(241, 234, 255, 0.05)' }))).toEqual([]);
    expect(over(el({ colour: 'transparent' }))).toEqual([]);
    // inside a box that cuts it off from sight (a list scrolled past it), and with nothing to draw (display: none)
    expect(over(el({ overflow: ['hidden', 'hidden'], box: box(600, 300, 100, 100) }), el({ up: 2 }))).toEqual([]);
    expect(textClashes(seen([el(), el()], under, run('Purpose', 2))).over).toEqual([]);
    // off the stage
    expect(textClashes(seen([el(), el()], run('Loose threads kept', 1, line(-900, 100, 200)), run('Purpose', 2, line(-890, 100, 80)))).over).toEqual([]);
  });

  it('never sets text against its own element’s, or the elements around it', () => {
    const pill = el({ position: 'absolute' });
    const tag = el({ up: 1 });
    expect(textClashes(seen([pill, tag], run('State', 1, line(300, 100, 80)), run('offline', 2, line(320, 100, 60)))).over).toEqual([]);
    expect(textClashes(seen([pill], run('State', 1, line(300, 100, 80)), run('offline', 1, line(320, 100, 60)))).over).toEqual([]);
  });

  it('reads the same words in the same place as one', () => {
    expect(textClashes(seen([el(), el()], run('Saved', 1, line(300, 100, 80)), run('Saved', 2, line(300.5, 100, 80)))).over).toEqual([]);
  });

  it('says three at most, the biggest overlaps first', () => {
    const els = Array.from({ length: 5 }, () => el({ position: 'absolute' }));
    const texts = [10, 20, 30, 40].map((by, i) => [run(`Over ${by}`, i + 1, line(300, 100 + i * 100, 100)), run(`Under ${by}`, 5, line(400 - by, 100 + i * 100, 100))]).flat();
    expect(textClashes(seen(els, ...texts)).over).toEqual([['Over 40', 'Under 40'], ['Over 30', 'Under 30'], ['Over 20', 'Under 20']]);
  });
});

describe('text cut off', () => {
  const quoteCard = el({ position: 'absolute', overflow: ['hidden', 'hidden'], box: box(300, 100, 400, 100) });

  it('finds text a box cuts off, its last lines or the end of its one line', () => {
    const quote = run('Each event becomes one line, appended and never rewritten', 2, line(316, 110, 360), line(316, 134, 360), line(316, 158, 360), line(316, 182, 360), line(316, 206, 200));
    expect(textClashes(seen([quoteCard, el({ up: 1 })], quote)).cut).toEqual(['Each event becomes one line, appended and never rewritten']);
    // a title on one line that doesn't fit its box (an ellipsis shows where)
    expect(textClashes(seen([el({ position: 'absolute', overflow: ['hidden', 'hidden'], box: box(300, 100, 100, 24) })], run('A very long title that is cut', 1, line(300, 100, 177), line(300, 100, 87)))).cut).toEqual(['A very long title that is cut']);
  });

  it('finds text running off the stage', () => {
    expect(textClashes(seen([el()], run('Off the edge', 1, line(1180, 300, 120)))).cut).toEqual(['Off the edge']);
  });

  it('leaves text that fits, give or take its descenders and letter spacing', () => {
    expect(textClashes(seen([quoteCard, el({ up: 1 })], run('One line, appended', 2, line(316, 110, 360)))).cut).toEqual([]);
    expect(textClashes(seen([el({ position: 'absolute', overflow: ['hidden', 'hidden'], box: box(300, 100, 100, 24) })], run('Fits', 1, line(300, 103, 102)))).cut).toEqual([]);
  });

  it('cuts absolutely placed text only by the boxes that place it', () => {
    const cutter = (over: Partial<StageElement>) => el({ overflow: ['hidden', 'hidden'], box: box(300, 100, 100, 100), ...over });
    const pill = (up: number) => run('Packet', up, line(380, 120, 80));
    expect(textClashes(seen([cutter({}), el({ up: 1, position: 'absolute' })], pill(2))).cut).toEqual([]);
    expect(textClashes(seen([cutter({ position: 'relative' }), el({ up: 1, position: 'absolute' })], pill(2))).cut).toEqual(['Packet']);
    expect(textClashes(seen([cutter({ transformed: true }), el({ up: 1, position: 'absolute' })], pill(2))).cut).toEqual(['Packet']);
    // in flow, it's cut by any box it's in
    expect(textClashes(seen([cutter({}), el({ up: 1 })], pill(2))).cut).toEqual(['Packet']);
  });

  it('cuts by the overflow only the way it isn’t visible', () => {
    const across = el({ overflow: ['clip', 'visible'], box: box(300, 100, 100, 30) });
    expect(textClashes(seen([across], run('Two lines here', 1, line(300, 100, 90), line(300, 124, 90)))).cut).toEqual([]);
    expect(textClashes(seen([across], run('One long line here', 1, line(300, 100, 190)))).cut).toEqual(['One long line here']);
  });
});

describe('a colour’s alpha', () => {
  it('reads it as the page writes it', () => {
    expect(colourAlpha('rgb(241, 234, 255)')).toBe(1);
    expect(colourAlpha('rgba(241, 234, 255, 0.4)')).toBe(0.4);
    expect(colourAlpha('rgba(241, 234, 255, .4)')).toBe(0.4);
    expect(colourAlpha('color(srgb 1 0 0 / 40%)')).toBe(0.4);
    expect(colourAlpha('oklch(0.5 0.1 20 / 0.25)')).toBe(0.25);
    expect(colourAlpha('url("#glow")')).toBe(1);
    expect(colourAlpha('transparent')).toBe(0);
    expect(colourAlpha('none')).toBe(0);
  });
});

describe('measuring the stage in the page', () => {
  function page() {
    const window = new Window();
    window.document.write(`<div id="stage"><div class="card" style="position:absolute;opacity:.5;color:rgba(1, 2, 3, .4)">Purpose <b>now</b></div><p style="visibility:hidden">
      spaced   out  </p><p> </p><svg><text>svg</text></svg></div>`);
    const found = window.document.getElementById('stage');
    if (!found) throw new Error('No stage');
    return found as unknown as Element;
  }

  it('lists the stage’s elements with their parents, and each run of its text with the element it’s in', () => {
    const { els, texts } = readStageText(page());
    expect(els.map((e) => e.up)).toEqual([-1, 0, 1, 0, 0, 0, 5]);
    expect(els[1]).toMatchObject({ position: 'absolute', opacity: 0.5, colour: 'rgba(1, 2, 3, .4)', hidden: false });
    expect(els[3]).toMatchObject({ hidden: true, opacity: 1 });
    expect(texts.map((t) => [t.text, t.el])).toEqual([['Purpose', 1], ['now', 2], ['spaced out', 3], ['svg', 6]]);
  });

  it('runs from its own source, as the player carries it into the page', () => {
    // in a context of its own, with nothing of this module's to lean on
    const own = runInNewContext(`${STAGE_TEXT_SCRIPT}\n({ textClashes, readStageText })`) as { textClashes: typeof textClashes; readStageText: typeof readStageText };
    const card = el({ position: 'absolute', overflow: ['hidden', 'hidden'], box: box(300, 100, 400, 30) });
    const text = seen([card, el({ up: 1 }), el({ up: 1 })], run('1 · MEMORY', 2, line(316, 110, 90)), run('Loose threads kept across sessions', 3, line(316, 110, 260), line(316, 134, 120)));
    expect(own.textClashes(text)).toEqual(textClashes(text));
    expect(own.textClashes(text)).toEqual({ over: [['1 · MEMORY', 'Loose threads kept across sessions']], cut: ['Loose threads kept across sessions'] });
    expect(own.readStageText(page())).toEqual(readStageText(page()));
    expect(STAGE_TEXT_SCRIPT).not.toMatch(/<\/script/i);
  });
});
