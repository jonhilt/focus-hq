import { ARTIFACT_SIZE, artifactUrl, latestArtifact } from '../../../shared/artifacts';
import type { GoalArtifact } from '../../../shared/types';
import { state } from '../net/state';
import { type PanePrefs, screenPrefs } from '../world/screenPanes';
import { LCARS } from '../world/starship';
import { sound } from '../sound';
import type { Ui } from './context';
import { h } from './dom';
import { SideNav } from './panels';

/** The panes view's key: artifact ids are lowercase letters, digits and dashes, so it can't be one of theirs. */
const PANES = ':panes';

/**
 * A station's screen up close. While the lead has shown something (`leadId`'s artifacts), it's each of those, live, one
 * view apiece down the sidebar, and what the screen shows is the last view; otherwise it's just that.
 */
export function openScreenPanel(ui: Ui, leadId?: string): void {
  const artifacts = (): GoalArtifact[] => (leadId ? state.agents.get(leadId)?.lead?.artifacts : undefined) ?? [];
  if (!artifacts().length) {
    ui.panels.open({ title: 'What this screen shows', body: panesView(), accent: LCARS.periwinkle });
    return;
  }

  const body = h('div');
  // the page at the size it was laid out for, scaled to fit the panel: up close, it looks as it does on the screen
  const stage = h('div', { class: 'artifact-stage' });
  const fit = () => {
    const frame = stage.querySelector('iframe');
    if (!frame) return;
    const scale = Math.min(stage.clientWidth / ARTIFACT_SIZE.w, stage.clientHeight / ARTIFACT_SIZE.h);
    frame.style.transform = `translateX(${(stage.clientWidth - ARTIFACT_SIZE.w * scale) / 2}px) scale(${scale})`;
  };
  const resized = new ResizeObserver(fit);
  resized.observe(stage);
  let picked = latestArtifact(artifacts())!.id;
  // the version on show, so a new one reloads the page and anything else leaves it be
  let shownUrl = '';
  const nav = new SideNav<string>((key) => {
    sound.press();
    picked = key;
    render();
  });
  const render = () => {
    const list = artifacts();
    if (picked !== PANES && !list.some((a) => a.id === picked)) picked = latestArtifact(list)?.id ?? PANES;
    const onScreen = latestArtifact(list)?.id;
    nav.show([...list.map((a) => ({ key: a.id, label: a.title, readout: a.id === onScreen ? 'SCREEN' : undefined })), { key: PANES, label: 'Screen panes' }], picked);
    const artifact = list.find((a) => a.id === picked);
    if (!artifact) {
      shownUrl = '';
      body.replaceChildren(panesView());
      return;
    }
    const url = artifactUrl(leadId!, artifact, 'html');
    if (url === shownUrl) return;
    shownUrl = url;
    // its own origin (no allow-same-origin): its scripts run, but can't reach the office
    stage.replaceChildren(h('iframe', {
      src: url,
      title: artifact.title,
      style: `width:${ARTIFACT_SIZE.w}px;height:${ARTIFACT_SIZE.h}px`,
      attrs: { sandbox: 'allow-scripts allow-popups' },
    }));
    body.replaceChildren(
      h('div', { class: 'row artifact-head' },
        h('h3', { class: 'grow' }, artifact.title),
        h('small', { class: 'muted' }, `Shown ${new Date(artifact.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`),
        h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open in a tab'),
      ),
      stage,
    );
    fit();
  };
  render();
  ui.panels.open({ title: 'On the screen', body, accent: LCARS.orange, wide: true, nav });
  ui.panels.own(state.on('agent', (agent) => {
    if (agent.id === leadId) render();
  }));
  ui.panels.own(() => resized.disconnect());
}

/**
 * What a station's screen shows beside the terminal, chosen at the screen itself: a picture of it, its panes laid out
 * as the screen lays them out, each one a switch. The choice is this viewer's, and every station screen follows it.
 */
function panesView(): HTMLElement {
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

  return h('div', null,
    h('p', null, 'Press a pane to show or hide it. The terminal always shows.'),
    h('div', { class: 'screen-map' },
      h('div', { class: 'screen-pane fixed on' }, 'Terminal', h('small', null, 'Always on')),
      h('div', { class: 'screen-stack' },
        pane('artifacts', 'Artifacts', 'what the lead has shown you'),
        pane('browser', 'Browser', 'the page the agent has up'),
      ),
      h('div', { class: 'screen-stack' },
        pane('note', 'Goal', "the lead's goal note"),
        pane('tasks', 'Tasks', "Claude's own task list"),
      ),
    ),
    h('small', { class: 'muted', style: 'display:block' },
      'Just for you, kept in this browser. Every station screen follows it, the laptops at desks too. A pane only shows while it has something in it, what the lead has shown takes the browser’s place, and a laptop fits two at most.'),
  );
}
