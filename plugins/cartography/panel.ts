// A view of a map as the browser shows it, on the engineering station and up close from its screen in the holodeck:
// the drawing, how to read it, and what it shows in sentences.
import { h, type Ui } from '../../plugin-api/client';
import { MATRIX_HINT, type Marks, viewDrawing, wireMatrix } from './draw';
import type { MapView, RepoMap } from './shared';
import { diagramStands } from './shown';

/** An SVG drawing, at its own size (readable), scrolling sideways when it's wider than the station. */
function drawing(svg: string): HTMLElement {
  const box = h('div', { class: 'cg-drawing' });
  box.innerHTML = svg;
  return box;
}

/** A view's body: how to read it, the drawing, and what it shows in sentences (with a slice's `marks`). */
export function viewBody(map: RepoMap, view: MapView, marks?: Marks): HTMLElement[] {
  return drawingBody(viewDrawing(map, view, marks));
}

/** Under the whole map's matrix: the line a clicked cell fills, and the matrix answering the pointer (wireMatrix). */
function matrixDetail(box: HTMLElement): HTMLElement[] {
  if (!box.querySelector('svg[data-matrix]')) return [];
  const said = h('small', { class: 'muted' }, MATRIX_HINT);
  said.dataset.said = '';
  const wrapper = h('div', null, box, said);
  wireMatrix(wrapper);
  return [wrapper];
}

/** A drawing's body: how to read it, the drawing, and what it shows in sentences. */
export function drawingBody({ svg, key, sentences }: { svg: string; key: string; sentences: string[] }): HTMLElement[] {
  const box = drawing(svg);
  const detail = matrixDetail(box);
  return [h('small', { class: 'muted' }, key), ...(detail.length ? detail : [box]), ...(sentences.length ? [h('ul', { class: 'cg-sentences' }, ...sentences.map((s) => h('li', null, s)))] : [])];
}

/** View `view` of `map` up close, filling the window (with a slice's `marks`). */
export function openView(ui: Ui, map: RepoMap, view: MapView, marks?: Marks): void {
  ui.panels.open({ title: view.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, map.repo), ...viewBody(map, view, marks)) });
}

/** A drawing up close, filling the window, under `title`, with what it's of (`of`). */
export function openDrawing(ui: Ui, title: string, of: string, drawn: { svg: string; key: string; sentences: string[] }): void {
  ui.panels.open({ title, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, of), ...drawingBody(drawn)) });
}
/**
 * A kept diagram up close, filling the window: how it stands (out of date, which files changed since), what can be done
 * with it (`redraw` draws it again from the code as it stands, `forget` drops it), then the page its lead drew, live,
 * to step through.
 */
export function openDiagram(ui: Ui, d: { question: string; stale?: string[]; redrawing?: boolean }, standing: string, html: string, act: { redraw: () => Promise<unknown>; forget: () => Promise<unknown> }): void {
  const { warning, redraw } = diagramStands(d);
  const frame = h('iframe', { class: 'cg-diagram', title: d.question });
  frame.srcdoc = html;
  // each closes the panel once it's done (the space shows the diagram being drawn again, or gone); one the captain
  // thinks better of (false) leaves it as it was
  const button = (label: string, cls: string, run: () => Promise<unknown>) =>
    h('button', { class: cls, onclick: () => void run().then((done) => done !== false && ui.panels.close(), (err: Error) => ui.error(err.message)) }, label);
  const actions = h('div', { class: 'cg-actions' },
    redraw ? button('Draw it again', redraw.class, act.redraw) : h('span', { class: 'muted' }, 'Being drawn again…'),
    button('Forget it', 'btn small', act.forget));
  ui.panels.open({ title: d.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, standing), warning ? h('p', { class: 'cg-stale' }, warning) : null, actions, frame) });
}
