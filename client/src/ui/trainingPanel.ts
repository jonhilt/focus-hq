import { SCENARIOS, TRAINING } from '../../../shared/scenarios';
import { api } from '../net/api';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { busy, h } from './dom';

/**
 * The demo ship's training console (docs/studio.md): a button for each scenario, which sends everyone home, clears the
 * ship and puts the scenario's goal in line at its project's team stations, for the captain to start and play.
 */
export function openTrainingPanel(ui: Ui): void {
  const body = h('div', null,
    h('p', { class: 'muted' }, 'Resets the ship to a quiet start: everyone goes home, goals and the log are cleared, and the dice roll from the top. The goal then waits at a free team station for you to start it.'),
    h('div', { class: 'places scenarios' },
      ...SCENARIOS.map((scenario) => {
        const t = TRAINING[scenario];
        const button = h('button', { class: 'btn place' }, t.label, h('small', null, t.blurb));
        button.onclick = () => void busy(button, async () => {
          await api.startTraining(scenario);
          ui.panels.close();
        }, ui.error);
        return button;
      }),
    ),
  );
  ui.panels.open({ title: 'Holodeck training', body, accent: LCARS.gold });
}
