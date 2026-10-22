// A view of a map as the browser shows it, on the engineering station and up close from its screen in the holodeck:
// the drawing, how to read it, and what it shows in sentences.
import { h, type Ui } from '../../plugin-api/client';
import { MATRIX_HINT, type Marks, viewDrawing, wireMatrix } from './draw';
import type { MapView, RepoMap } from './shared';

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
