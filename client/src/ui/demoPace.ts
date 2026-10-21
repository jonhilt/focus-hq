// The demo ship's pace (shared/demoPace.ts): slower and faster from the ready room's settings, or - and = aboard.
// Focus tells every tab the new pace (`info.demoPace`), so each shows it.
import { nextSpeed, paceLabel } from '../../../shared/demoPace';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { h } from './dom';

/** Steps the demo's agents a rung slower (-1) or faster (+1), from their next wait on; `then` hears the new pace. */
export function stepDemoPace(by: 1 | -1, ui: Ui, then?: (speed: number) => void): void {
  const now = state.info?.demoPace ?? 1;
  const next = nextSpeed(now, by);
  if (next === now) return;
  void api.demoSpeed(next).then(
    ({ speed }) => {
      ui.hud.toast('info', `Demo pace ${paceLabel(speed)}`);
      then?.(speed);
    },
    (e: Error) => ui.error(e.message),
  );
}

/** The settings' Demo pace row: slower, the pace now, faster. */
export function demoPaceField(ui: Ui): HTMLElement {
  const pace = state.info?.demoPace ?? 1;
  const slower = h('button', { class: 'btn small', title: 'Slower (-)' }, 'Slower');
  const faster = h('button', { class: 'btn small', title: 'Faster (=)' }, 'Faster');
  const shown = h('span', { class: 'chip' }, paceLabel(pace));
  // the panel keeps its form while a button in it has focus, so the pace shown is set here rather than redrawn
  const shows = (speed: number) => (shown.textContent = paceLabel(speed));
  slower.onclick = () => stepDemoPace(-1, ui, shows);
  faster.onclick = () => stepDemoPace(1, ui, shows);
  return h('div', { class: 'field' },
    h('label', null, 'Demo pace'),
    h('div', { class: 'row' }, slower, shown, faster),
    h('small', null, 'How fast the pretend agents go: 1× is a demo’s usual pace, where a workflow takes several minutes. Changes take from each agent’s next step. Aboard, - and = do the same.'),
  );
}
