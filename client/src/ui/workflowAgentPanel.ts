import { helperFor, UNIFORM } from '../../../shared/crew';
import type { Agent, TermLine, Workflow, WorkflowAgent } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { fill, h } from './dom';
import { TermView } from './terminal';

/** How often an open panel reads the agent's transcript again: Claude Code writes it as the agent works. */
const REFRESH_MS = 2000;

const workflowOf = (lead: Agent | undefined, id: string): Workflow | undefined => lead?.workflows?.find((w) => w.id === id);
const agentOf = (workflow: Workflow | undefined, index: number): WorkflowAgent | undefined => workflow?.agents.find((a) => a.index === index);

/**
 * One of a lead's workflow agents, from the pads of its transporter room: its own screen, the transcript Claude Code
 * keeps as it works (what it was asked, its tools and what came back, what it said), read again every couple of
 * seconds while it's open. You talk to the lead, not the agent.
 */
export function openWorkflowAgentPanel(ui: Ui, leadId: string, workflowId: string, index: number): void {
  const lead = state.agents.get(leadId);
  const workflow = workflowOf(lead, workflowId);
  const agent = agentOf(workflow, index);
  if (!lead || !workflow || !agent) return ui.openAgent(leadId);
  const crew = helperFor(`${workflowId}:${index}`);
  const phase = (w: Workflow, a: WorkflowAgent) => w.phases.find((p) => p.index === a.phase)?.title;

  const term = new TermView();
  const terminal = term.el;
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, info, h('div', { class: 'agent-grid single' }, terminal));
  const talk = h('button', { class: 'btn primary', onclick: () => ui.openAgent(leadId) }, `Talk to ${lead.name}`);
  const footer = h('div', { class: 'compose' }, h('span', { class: 'grow muted' }, `${agent.label} works in ${lead.name}'s workflow ${workflow.name}: talk to them about it.`), talk);
  const title = h('h2', null,
    h('span', { class: 'dot', style: `background:${UNIFORM[crew.avatar.division]};margin-right:8px;vertical-align:middle` }),
    `${agent.label} · `,
    h('span', { class: 'muted', style: 'font-weight:500' }, `workflow ${workflow.name}${phase(workflow, agent) ? `, ${phase(workflow, agent)}` : ''}`),
  );
  ui.panels.open({ title, body, footer, wide: true, accent: UNIFORM[crew.avatar.division] });

  const renderInfo = (a: WorkflowAgent) =>
    fill(
      info,
      h('span', { class: `chip ${a.status === 'done' ? 'ok' : a.status === 'failed' ? 'bad' : ''}` }, a.status),
      h('span', { class: 'grow muted' }, a.activity),
      a.model ? h('span', { class: 'chip', title: 'The model this agent runs on' }, a.model) : null,
    );
  renderInfo(agent);

  // its id comes with its first progress once it starts; it keeps it after it's gone from the workflow's list
  let agentId = agent.agentId;
  let shown = -1;
  const show = (lines: TermLine[]) => {
    if (lines.length === shown) return;
    const nearBottom = shown < 0 || terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    shown = lines.length;
    term.clear();
    term.append(lines.length ? lines : [{ t: Date.now(), kind: 'system', text: '✻ Nothing on its screen yet' }]);
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  };
  const read = () => {
    if (!agentId) return show([]);
    void api.workflowAgentLines(leadId, workflowId, agentId).then(show).catch(() => undefined);
  };
  read();
  const timer = setInterval(read, REFRESH_MS);
  ui.panels.own(() => clearInterval(timer));

  ui.panels.own(state.on('agent', (a) => {
    if (a.id !== leadId) return;
    const x = agentOf(workflowOf(a, workflowId), index);
    if (x) {
      agentId ??= x.agentId;
      renderInfo(x);
    }
  }));
  ui.panels.own(state.on('agent-removed', (a) => a.id === leadId && ui.panels.close()));
}
