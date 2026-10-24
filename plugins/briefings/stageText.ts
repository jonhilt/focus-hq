// Ops' check of the text on an explainer's stage, at each moment it takes a picture of: text drawn over other text,
// and text cut off by the box it's in or by the stage's edge. The player carries these functions into its page as
// their own source (`STAGE_TEXT_SCRIPT`), so each uses only the others and what it's given: `readStageText` measures
// the stage in the page, and `textClashes` decides what's wrong there, pure, so it's unit tested (stageText.test.ts).

/** A box on the page, in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One of the stage's elements as the page measured it; the stage itself comes first. */
export interface StageElement {
  /** Its parent, as its place in the list: -1 for the stage. */
  up: number;
  /** Its CSS position. Placed absolutely, it's inside the overflow only of the ancestors that place it (positioned or transformed). */
  position: string;
  transformed: boolean;
  /** Its overflow across and down: hidden, clip, auto or scroll cut what's in it to its box. */
  overflow: [string, string];
  opacity: number;
  /** Its visibility is hidden, which its text takes on. */
  hidden: boolean;
  /** Its text's colour as the page computed it (its fill, in an SVG). */
  colour: string;
  /** Its box inside its border, where its overflow cuts. */
  box: Box;
}

/** A run of the stage's text: its words, the element it's in (its place in the list), and a box for each line of it. */
export interface StageTextRun {
  text: string;
  el: number;
  boxes: Box[];
}

/** The stage's elements and text, as `readStageText` measures them. */
export interface StageText {
  els: StageElement[];
  texts: StageTextRun[];
}

/** What the check found: text drawn over other text (each pair's words, the smaller first) and text cut off, a few of each at most. */
export interface TextClashes {
  over: [string, string][];
  cut: string[];
}

/** How opaque a CSS colour is, 0 to 1: its alpha as the page writes it (`rgba(…, 0.4)`, `color(srgb … / 40%)`). */
export function colourAlpha(colour: string): number {
  if (colour === 'transparent' || colour === 'none') return 0;
  const alpha = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/.exec(colour) ?? /\/\s*([\d.]+)(%?)\s*\)$/.exec(colour);
  if (!alpha) return 1;
  return Number(alpha[1]) / (alpha[2] === '%' ? 100 : 1);
}

/** The part of a line of text's box its letters fill: under the room above the capitals, over most of the descenders' (as Antonio and JetBrains Mono draw them). */
export function inkBox(box: Box): Box {
  return { x: box.x, y: box.y + box.h * 0.2, w: box.w, h: box.h * 0.7 };
}

/** Where two boxes meet; null when they don't. */
export function meet(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Where what's in an element can show, `clip` cut to its box each way its overflow isn't visible; null when nowhere. */
export function cutBy(clip: Box, el: StageElement): Box | null {
  const [across, down] = el.overflow.map((o) => /^(hidden|clip|auto|scroll)$/.test(o));
  return meet(clip, { x: across ? el.box.x : clip.x, y: down ? el.box.y : clip.y, w: across ? el.box.w : clip.w, h: down ? el.box.h : clip.h });
}

/**
 * Where the text in element `el` can show, and how opaque it is: the stage's box cut by the overflow of each ancestor
 * that holds it, and every opacity up to the stage. An absolutely placed element escapes the overflow of ancestors
 * that don't place it.
 */
export function shownWhere(els: readonly StageElement[], el: number): { clip: Box | null; opacity: number } {
  let clip: Box | null = els[0].box;
  let opacity = 1;
  // whether the box below is placed absolutely, so only an ancestor that places it holds it
  let placed = false;
  for (let i = el; i >= 0; i = els[i].up) {
    const e = els[i];
    opacity *= e.opacity;
    if (placed && e.position === 'static' && !e.transformed) continue;
    if (clip && i > 0) clip = cutBy(clip, e);
    placed = e.position === 'absolute' || e.position === 'fixed';
  }
  return { clip, opacity };
}

/**
 * A run of text as it shows: each line's ink, cut to where it can show, and whether a line reaches past there (by more
 * than a few pixels, or an eighth of its height for big text). Null when none of it shows: too faint, hidden, or out of sight.
 */
export function shownRun(els: readonly StageElement[], run: StageTextRun): { text: string; el: number; ink: Box[]; cut: boolean } | null {
  const own = els[run.el];
  const { clip, opacity } = shownWhere(els, run.el);
  if (!clip || own.hidden || opacity * colourAlpha(own.colour) <= 0.1) return null;
  const lines = run.boxes.map(inkBox);
  const ink = lines.flatMap((line) => meet(line, clip) ?? []).filter((b) => b.w >= 2 && b.h >= 2);
  if (!ink.length) return null;
  const past = (b: Box) => Math.max(clip.x - b.x, b.x + b.w - clip.x - clip.w, clip.y - b.y, b.y + b.h - clip.y - clip.h);
  return { text: run.text, el: run.el, ink, cut: lines.some((b) => past(b) > Math.max(3, b.h / 8)) };
}

/** Whether elements `a` and `b` are one, or one holds the other: text is never drawn over its own element's. */
export function related(els: readonly StageElement[], a: number, b: number): boolean {
  for (let i = a; i >= 0; i = els[i].up) if (i === b) return true;
  for (let i = b; i >= 0; i = els[i].up) if (i === a) return true;
  return false;
}

/**
 * The most ink two runs share, in square pixels, where it counts: a few pixels each way, and a tenth of the smaller
 * line's ink, so touching edges and letter spacing don't. 0 when they share none that counts.
 */
export function sharedInk(a: readonly Box[], b: readonly Box[]): number {
  let most = 0;
  for (const p of a) {
    for (const q of b) {
      const m = meet(p, q);
      if (m && m.w >= 4 && m.h >= 4 && m.w * m.h >= 0.1 * Math.min(p.w * p.h, q.w * q.h)) most = Math.max(most, m.w * m.h);
    }
  }
  return most;
}

/** How much ink a run shows, in square pixels. */
export function inkArea(ink: readonly Box[]): number {
  return ink.reduce((sum, b) => sum + b.w * b.h, 0);
}

/** What's wrong with the stage's text: text drawn over other text, the biggest overlaps first, and text cut off; three of each at most. */
export function textClashes(seen: StageText): TextClashes {
  if (!seen.els.length) return { over: [], cut: [] };
  const shown = seen.texts.flatMap((run) => shownRun(seen.els, run) ?? []);
  const over: { pair: [string, string]; area: number }[] = [];
  shown.forEach((a, i) => {
    for (const b of shown.slice(i + 1)) {
      // the same words in the same place read as one
      const twin = a.text === b.text && Math.abs(a.ink[0].x - b.ink[0].x) < 2 && Math.abs(a.ink[0].y - b.ink[0].y) < 2;
      const area = twin || related(seen.els, a.el, b.el) ? 0 : sharedInk(a.ink, b.ink);
      if (area) over.push({ pair: inkArea(a.ink) <= inkArea(b.ink) ? [a.text, b.text] : [b.text, a.text], area });
    }
  });
  over.sort((p, q) => q.area - p.area);
  return { over: over.slice(0, 3).map((o) => o.pair), cut: shown.filter((s) => s.cut).slice(0, 3).map((s) => s.text) };
}

/** Runs in the page: the stage's elements and text, measured as they're drawn now. */
export function readStageText(stage: Element): StageText {
  const doc = stage.ownerDocument;
  const view = doc.defaultView;
  if (!view) return { els: [], texts: [] };
  const all = [stage, ...Array.from(stage.querySelectorAll('*'))];
  const at = new Map(all.map((e, i) => [e, i]));
  const els = all.map((e): StageElement => {
    const s = view.getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return {
      up: e === stage || !e.parentElement ? -1 : (at.get(e.parentElement) ?? -1),
      position: s.position,
      transformed: !!s.transform && s.transform !== 'none',
      overflow: [s.overflowX, s.overflowY],
      opacity: Number(s.opacity || 1),
      hidden: s.visibility === 'hidden' || s.visibility === 'collapse',
      colour: e instanceof view.SVGElement ? s.fill : s.color,
      box: { x: r.left + e.clientLeft, y: r.top + e.clientTop, w: e.clientWidth || r.width, h: e.clientHeight || r.height },
    };
  });
  const texts: StageTextRun[] = [];
  const walk = doc.createTreeWalker(stage, view.NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const el = node.parentElement ? at.get(node.parentElement) : undefined;
    if (!text || el === undefined) continue;
    range.selectNodeContents(node);
    texts.push({ text, el, boxes: Array.from(range.getClientRects(), (b) => ({ x: b.left, y: b.top, w: b.width, h: b.height })) });
  }
  return { els, texts };
}

/**
 * The check as the player's page carries it: these functions' own source. The bundler that keeps function names wraps
 * some in `__name(…)`, which the page doesn't have: it's given one that hands each back.
 */
export const STAGE_TEXT_SCRIPT = `var __name = function (f) { return f; };
${[colourAlpha, inkBox, meet, cutBy, shownWhere, shownRun, related, sharedInk, inkArea, textClashes, readStageText].map(String).join('\n')}`;
