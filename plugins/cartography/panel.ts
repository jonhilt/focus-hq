// A view of a map as the browser shows it, on the engineering station and up close from its screen in the holodeck:
// the drawing, how to read it, and what it shows in sentences.
import { h, type Ui } from '../../plugin-api/client';
import { type Drawing, type Marks, viewDrawing } from './draw';
import type { MapView, RepoMap } from './shared';

/** An SVG drawing, at its own size (readable), scrolling sideways when it's wider than the station. */
function drawing(svg: string): HTMLElement {
  const box = h('div', { class: 'cg-drawing' });
  box.innerHTML = svg;
  return box;
}

/** A view's body: its answer, how to read it, the drawing, and what it shows in numbered sentences (with a slice's `marks`). */
export function viewBody(map: RepoMap, view: MapView, marks?: Marks): HTMLElement[] {
  return [...(view.answer && !marks ? [h('p', { class: 'cg-answer' }, view.answer)] : []), ...drawingBody(viewDrawing(map, view, marks))];
}

/** A numbered sentence, opening on its evidence when it has some (a scenario's step). */
function sentence(s: string, more?: string[]): HTMLElement {
  if (!more) return h('li', null, s);
  return h('li', null, h('details', null, h('summary', null, s), h('ul', null, ...more.map((d) => h('li', null, d)))));
}

/** A drawing's body: how to read it, the drawing, and what it shows in numbered sentences. */
export function drawingBody({ svg, key, sentences, details }: Drawing): HTMLElement[] {
  return [h('small', { class: 'muted' }, key), drawing(svg), ...(sentences.length ? [h('ol', { class: 'cg-sentences' }, ...sentences.map((s, i) => sentence(s, details?.[i])))] : [])];
}

/** View `view` of `map` up close, filling the window (with a slice's `marks`). */
export function openView(ui: Ui, map: RepoMap, view: MapView, marks?: Marks): void {
  ui.panels.open({ title: view.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, map.repo), ...viewBody(map, view, marks)) });
}

/** A drawing up close, filling the window, under `title`, with what it's of (`of`). */
export function openDrawing(ui: Ui, title: string, of: string, drawn: Drawing): void {
  ui.panels.open({ title, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, of), ...drawingBody(drawn)) });
}

/**
 * A kept diagram up close, filling the window: how it stands (out of date, which files changed since), what can be done
 * with it (`redraw` draws it again from the code as it stands, `forget` drops it), then the page its lead drew, live,
 * to step through.
 */
export function openDiagram(ui: Ui, d: { question: string; stale?: string[]; redrawing?: boolean }, standing: string, html: string, act: { redraw: () => Promise<unknown>; forget: () => Promise<unknown> }): void {
  const stale = d.stale ?? [];
  const frame = h('iframe', { class: 'cg-diagram', title: d.question });
  frame.srcdoc = html;
  const warning = stale.length
    ? [h('p', { class: 'cg-stale' }, `Out of date: ${stale.length === 1 ? 'a file it cites has' : `${stale.length} files it cites have`} changed on the default branch since it was drawn (${stale.join(', ')}).`)]
    : [];
  // each closes the panel once it's done (the space shows the diagram being drawn again, or gone); one the captain
  // thinks better of (false) leaves it as it was
  const button = (label: string, cls: string, run: () => Promise<unknown>) =>
    h('button', { class: cls, onclick: () => void run().then((done) => done !== false && ui.panels.close(), (err: Error) => ui.error(err.message)) }, label);
  const actions = h('div', { class: 'cg-actions' },
    d.redrawing ? h('span', { class: 'muted' }, 'Being drawn again…') : button('Draw it again', stale.length ? 'btn' : 'btn small', act.redraw),
    button('Forget it', 'btn small', act.forget));
  ui.panels.open({ title: d.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, standing), ...warning, actions, frame) });
}
