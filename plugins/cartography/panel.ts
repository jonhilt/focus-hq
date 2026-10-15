// A view of a map as the browser shows it, on the engineering station and up close from its screen in the holodeck:
// the drawing, how to read it, and what it shows in sentences.
import type { Ui } from '../../client/src/ui/context';
import { h } from '../../client/src/ui/dom';
import { viewDrawing } from './draw';
import type { MapView, RepoMap } from './shared';

/** An SVG drawing, at its own size (readable), scrolling sideways when it's wider than the station. */
function drawing(svg: string): HTMLElement {
  const box = h('div', { class: 'cg-drawing' });
  box.innerHTML = svg;
  return box;
}

/** A view's body: how to read it, the drawing, and what it shows in numbered sentences. */
export function viewBody(map: RepoMap, view: MapView): HTMLElement[] {
  const { svg, key, sentences } = viewDrawing(map, view);
  return [h('small', { class: 'muted' }, key), drawing(svg), ...(sentences.length ? [h('ol', { class: 'cg-sentences' }, ...sentences.map((s) => h('li', null, s)))] : [])];
}

/** View `view` of `map` up close, filling the window. */
export function openView(ui: Ui, map: RepoMap, view: MapView): void {
  ui.panels.open({ title: view.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, map.repo), ...viewBody(map, view)) });
}
