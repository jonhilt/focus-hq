// A view of a map as the browser shows it, on the engineering station and up close from its screen in the holodeck:
// the drawing, how to read it, and what it shows in sentences.
import type { Ui } from '../../client/src/ui/context';
import { h } from '../../client/src/ui/dom';
import { matrixExample, matrixSvg, viewSentences, viewSvg } from './draw';
import type { MapView, RepoMap } from './shared';
import { MATRIX_KEY, VIEW_KEY, WHOLE } from './views';

/** An SVG drawing, at its own size (readable), scrolling sideways when it's wider than the station. */
function drawing(svg: string): HTMLElement {
  const box = h('div', { class: 'cg-drawing' });
  box.innerHTML = svg;
  return box;
}

/** A view's body: the drawing, how to read it, and (for a view of a few parts) what it shows in sentences. */
export function viewBody(map: RepoMap, view: MapView): HTMLElement[] {
  if (view.id === WHOLE.id) {
    const example = matrixExample(map);
    return [h('small', { class: 'muted' }, MATRIX_KEY, example ? ` ${example}` : ''), drawing(matrixSvg(map))];
  }
  return [h('small', { class: 'muted' }, VIEW_KEY), drawing(viewSvg(map, view)), h('ol', { class: 'cg-sentences' }, ...viewSentences(map, view).map((s) => h('li', null, s)))];
}

/** View `view` of `map` up close, filling the window. */
export function openView(ui: Ui, map: RepoMap, view: MapView): void {
  ui.panels.open({ title: view.question, full: true, body: h('div', { class: 'cg-close-up' }, h('div', { class: 'muted' }, map.repo), ...viewBody(map, view)) });
}
