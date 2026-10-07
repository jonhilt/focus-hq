import { type PanePrefs, screenPrefs } from '../world/screenPanes';
import { LCARS } from '../world/starship';
import { sound } from '../sound';
import type { Ui } from './context';
import { h } from './dom';

/**
 * What a station's screen shows beside the terminal, chosen at the screen itself: a picture of it, its panes laid out
 * as the screen lays them out, each one a switch. The choice is this viewer's, and every station screen follows it.
 */
export function openScreenPanel(ui: Ui): void {
  const pane = (key: keyof PanePrefs, label: string, what: string) => {
    const reading = h('small');
    const button = h('button', { class: 'screen-pane', title: `Show ${what} on the screen` }, label, reading);
    const paint = () => {
      const on = screenPrefs.current[key];
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      reading.textContent = on ? 'On' : 'Off';
    };
    button.onclick = () => {
      sound.press();
      screenPrefs.set(key, !screenPrefs.current[key]);
      paint();
    };
    paint();
    return button;
  };

  const body = h('div', null,
    h('p', null, 'Press a pane to show or hide it. The terminal always shows.'),
    h('div', { class: 'screen-map' },
      h('div', { class: 'screen-pane fixed on' }, 'Terminal', h('small', null, 'Always on')),
      pane('browser', 'Browser', 'the page the agent has up'),
      h('div', { class: 'screen-stack' },
        pane('note', 'Goal', "the lead's goal note"),
        pane('tasks', 'Tasks', "Claude's own task list"),
      ),
    ),
    h('small', { class: 'muted', style: 'display:block' },
      'Just for you, kept in this browser. Every station screen follows it, the laptops at desks too. A pane only shows while it has something in it, and a laptop fits two at most.'),
  );
  ui.panels.open({ title: 'What this screen shows', body, accent: LCARS.periwinkle });
}
