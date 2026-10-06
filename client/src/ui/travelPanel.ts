import { statusIcon, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import { state } from '../net/state';
import { sound } from '../sound';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { h } from './dom';
import { issueForm } from './managerPanel';

/** Jump to any room or straight to an agent's desk. */
export function openTeleportPanel(ui: Ui): void {
  const places = ui.places();
  const agents = [...state.agents.values()].sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || a.startedAt - b.startedAt);
  const body = h('div', null,
    h('div', { class: 'places' },
      ...places.map((place) =>
        h('button', { class: 'btn place', onclick: () => ui.goTo(place) },
          place.label,
          place.projectId ? h('small', null, `${state.agentsIn(place.projectId).length} agents`) : null,
        ),
      ),
    ),
    agents.length ? h('h3', null, 'People') : null,
    h('div', { class: 'places' },
      ...agents.map((a) =>
        h('button', { class: a.status === 'waiting' ? 'btn place warn' : 'btn place', onclick: () => ui.goToAgent(a.id) },
          h('span', { class: 'dot', style: `background:${UNIFORM[a.avatar.division]};margin-right:6px;vertical-align:-2px` }),
          `${statusIcon(a)} ${a.name}`,
          h('small', null, `${state.project(a.projectId)?.name ?? ''} · ${a.task === 'lead' ? `lead of “${a.lead?.title ?? 'a goal'}”` : `#${a.issue.number}`} · ${statusLine(a)}`),
        ),
      ),
    ),
  );
  ui.panels.open({ title: '🗺️ Where to?', body, accent: LCARS.periwinkle });
}

export function openNewIssuePanel(ui: Ui, projectId?: string): void {
  const project = projectId ? state.project(projectId) : undefined;
  ui.panels.open({
    title: project ? `📝 New issue for ${project.name}` : '📝 New issue',
    body: issueForm(ui, projectId, () => ui.panels.close()),
    accent: LCARS.gold,
  });
}

const soundLabel = (on: boolean) => (on ? '🔊 Ship sounds on' : '🔇 Ship sounds off');

export function openPausePanel(ui: Ui, resume: () => void): void {
  const info = state.info;
  const soundButton = h('button', { class: 'btn', onclick: () => (soundButton.textContent = soundLabel(sound.toggle())) }, soundLabel(sound.enabled));
  const body = h('div', { style: 'text-align:center' },
    h('p', null, 'The crew keeps working while you’re away.'),
    h('div', { class: 'row', style: 'justify-content:center' },
      h('button', { class: 'btn primary', onclick: resume }, '▶ Back to work'),
      h('button', { class: 'btn', onclick: () => ui.openTeleport() }, '🗺️ Teleport'),
      h('button', { class: 'btn', onclick: () => ui.openManager() }, '🎖️ Ready room'),
      soundButton,
    ),
    info?.mode === 'demo' ? h('p', { class: 'muted' }, 'Demo mode – GitHub and agents are simulated.') : null,
  );
  ui.panels.open({ title: '☕ Paused', body, accent: LCARS.sky });
}
