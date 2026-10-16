// A view of a map as the browser shows it, on the engineering station and up close from its screen in the holodeck:
// the drawing, how to read it, and what it shows in sentences.
import { h, type Ui } from '../../plugin-api/client';
import { type Marks, viewDrawing } from './draw';
import type { MapView, RepoMap } from './shared';

/** An SVG drawing, at its own size (readable), scrolling sideways when it's wider than the station. */
function drawing(svg: string): HTMLElement {
  const box = h('div', { class: 'cg-drawing' });
  box.innerHTML = svg;
  return box;
}

/** A view's body: how to read it, the drawing, and what it shows in numbered sentences (with a slice's `marks`). */
export function viewBody(map: RepoMap, view: MapView, marks?: Marks): HTMLElement[] {
  return drawingBody(viewDrawing(map, view, marks));
}

/** A drawing's body: how to read it, the drawing, and what it shows in numbered sentences. */
export function drawingBody({ svg, key, sentences }: { svg: string; key: string; sentences: string[] }): HTMLElement[] {
  return [h('small', { class: 'muted' }, key), drawing(svg), ...(sentences.length ? [h('ol', { class: 'cg-sentences' }, ...sentences.map((s) => h('li', null, s)))] : [])];
}

/** View `view` of `map` up close, filling the window (with a slice's `marks`). */
export function openView(ui: Ui, map: RepoMap, view: MapView, marks?: Marks): void {
  ui.panels.open({ title: view.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, map.repo), ...viewBody(map, view, marks)) });
}

/** A drawing up close, filling the window, under `title`, with what it's of (`of`). */
export function openDrawing(ui: Ui, title: string, of: string, drawn: { svg: string; key: string; sentences: string[] }): void {
  ui.panels.open({ title, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, of), ...drawingBody(drawn)) });
}
