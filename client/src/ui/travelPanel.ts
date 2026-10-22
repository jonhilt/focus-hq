import { statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import { state } from '../net/state';
import { pluginPanels } from '../plugins';
import { sound } from '../sound';
import type { Place } from '../world/ship';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { h } from './dom';
import { issueForm } from './managerPanel';
import { Switch } from './panels';

/** Jump to any room or straight to an agent's desk. */
export function openTeleportPanel(ui: Ui): void {
  const listed = ui.places().filter((place) => !place.unlisted);
  const places = listed.filter((place) => !place.chair);
  const chairs = listed.filter((place) => place.chair);
  const agents = state.shownAgents().sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || a.startedAt - b.startedAt);
  const body = h('div', null,
    h('div', { class: 'places' },
      ...places.map((place) =>
        h('button', { class: 'btn place', onclick: () => ui.goTo(place) },
          place.label,
          place.projectId ? h('small', null, `${state.agentsIn(place.projectId).length} agents`) : null,
        ),
      ),
    ),
    chairs.length ? h('h3', null, 'Your chairs') : null,
    h('div', { class: 'places' }, ...chairs.map((place) => h('button', { class: 'btn place', onclick: () => ui.goTo(place) }, place.label))),
    agents.length ? h('h3', null, 'People') : null,
    h('div', { class: 'places' },
      ...agents.map((a) =>
        h('button', { class: a.status === 'waiting' ? 'btn place warn' : 'btn place', onclick: () => ui.goToAgent(a.id) },
          h('span', { class: 'dot', style: `background:${UNIFORM[a.avatar.division]};margin-right:6px;vertical-align:-2px` }),
          a.name,
          h('small', null, `${state.project(a.projectId)?.name ?? ''} · ${a.task === 'lead' ? `lead of “${a.lead?.title ?? 'a goal'}”` : `#${a.issue.number}`} · ${statusLine(a)}`),
        ),
      ),
    ),
  );
  ui.panels.open({ title: 'Teleport', body, accent: LCARS.periwinkle });
}

/** The turbolift's controls: a button for each deck it stops at, bar the one you're on. */
export function openTurboliftPanel(ui: Ui, stops: Place[], here: Place | undefined): void {
  const body = h('div', { class: 'places' },
    ...stops.map((stop) =>
      stop === here
        ? h('button', { class: 'btn place', disabled: true }, stop.label, h('small', null, 'You’re here'))
        : h('button', { class: 'btn place', onclick: () => ui.ride(stop) }, stop.label),
    ),
  );
  ui.panels.open({ title: 'Turbolift', body, accent: LCARS.gold });
}

export function openNewIssuePanel(ui: Ui, projectId?: string): void {
  const project = projectId ? state.project(projectId) : undefined;
  const body = h('div');
  ui.panels.open({ title: project ? `${project.name} · new issue` : 'New issue', body, accent: LCARS.gold });
  // built once the panel is open: the planner card subscribes to its drafts as it's built
  body.append(issueForm(ui, projectId, () => ui.panels.close()));
}

export function openPausePanel(ui: Ui, resume: () => void): void {
  const info = state.info;
  const sounds = new Switch('Ship sounds', sound.enabled, { changed: () => sound.toggle() });
  const body = h('div', null,
    h('p', { style: 'margin-top:0' }, 'The crew keeps working while you’re away.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: resume }, 'Back to work'),
      ...pluginPanels().map((panel) => h('button', { class: 'btn', onclick: () => panel.open(ui) }, panel.label)),
      h('button', { class: 'btn', onclick: () => ui.openTeleport() }, 'Teleport'),
      h('button', { class: 'btn', onclick: () => ui.openManager() }, 'Ready room'),
      sounds.el,
    ),
    info?.mode === 'demo' ? h('p', { class: 'muted' }, 'Demo mode – GitHub and agents are simulated.') : null,
  );
  ui.panels.open({ title: 'Paused', body, accent: LCARS.sky });
}
