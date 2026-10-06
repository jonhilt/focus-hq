import { leadFor, leadId, UNIFORM } from '../../../shared/crew';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, h } from './dom';

/**
 * The project's lead: their Claude Code session, once they're at the group desk; until then, a box to tell them what
 * you're after, which seats them.
 */
export function openLeadPanel(ui: Ui, projectId: string): void {
  const project = state.project(projectId);
  if (!project) return;
  const id = leadId(projectId);
  if (state.agents.has(id)) return ui.openAgent(id);
  const lead = leadFor(projectId);
  const text = h('textarea', { class: 'planner-input', placeholder: 'What are we working on? e.g. shoppers can save items for later and find them again on any device', autofocus: true });
  const start = h('button', { class: 'btn primary' }, `🖖 Talk to ${lead.name}`);
  start.onclick = () =>
    void busy(start, async () => {
      await api.talkToLead(projectId, text.value);
      ui.openAgent(id);
    }, ui.error);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start.click();
  });
  const body = h('div', { class: 'lead-intro' },
    h('div', { class: 'planner-head' },
      h('span', { class: 'planner-badge', style: `background:${UNIFORM[lead.avatar.division]}` }, '🖖'),
      h('div', { class: 'grow' }, h('strong', null, lead.name), h('small', null, `Lead · ${project.name}`)),
    ),
    h('p', null, `${lead.name} is your own Claude Code session for ${project.name}, with ${project.repos.length === 1 ? project.repos[0] : `all ${project.repos.length} of its repos`} checked out side by side. Talk a goal through, then let them build it a slice at a time. Each slice ships as a pull request per repo it touches, QA reviews it, and you merge it. Then they carry on from what it taught you.`),
    withMic(ui, text),
    h('div', { class: 'row' }, start, h('small', { class: 'muted' }, 'Ctrl+Enter starts')),
  );
  ui.panels.open({ title: `🧭 ${project.name}’s lead`, body, accent: project.color });
}
