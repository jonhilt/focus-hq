import type { Agent, Workflow, WorkflowScript } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { countsLine, phaseColour, plannedPhases, runningLines, usageLine } from '../world/workflowRooms';
import type { Ui } from './context';
import { fill, h } from './dom';

/** How often an open panel reads the script again while the workflow runs: what it logged and returned come as it ends. */
const REFRESH_MS = 3000;

const workflowOf = (lead: Agent | undefined, id: string): Workflow | undefined => lead?.workflows?.find((w) => w.id === id);

/**
 * The script behind one of a lead's workflows, from its transporter room's console: the source with the lines running
 * now lit in their phases' colours, and beside it the phases its meta plans with what each is for and how its agents
 * stand, then what it logged and returned once it's over, and what it has used. You talk to the lead about it.
 */
export function openWorkflowScriptPanel(ui: Ui, leadId: string, workflowId: string): void {
  const lead = state.agents.get(leadId);
  let workflow = workflowOf(lead, workflowId);
  if (!lead || !workflow) return ui.openAgent(leadId);
  let script: WorkflowScript | undefined;

  const code = h('div', { class: 'script-code' });
  const side = h('div', { class: 'script-side' });
  const body = h('div', { class: 'script-panel' }, code, side);
  const talk = h('button', { class: 'btn primary', onclick: () => ui.openAgent(leadId) }, `Talk to ${lead.name}`);
  const footer = h('div', { class: 'compose' }, h('span', { class: 'grow muted' }, `${lead.name} wrote this script: talk to them about it.`), talk);
  const title = h('h2', null, `${workflow.name} · `, h('span', { class: 'muted', style: 'font-weight:500' }, 'its script'));
  ui.panels.open({ title, body, footer, wide: true, accent: LCARS.gold });

  let scrolled = false;
  const render = () => {
    const wf = workflow;
    if (!wf) return;
    const phases = plannedPhases(wf);
    const colourOf = (phase: number) => LCARS[phaseColour(phases.find((p) => p.index === phase) ?? { index: phase })];
    const lit = script ? runningLines(script.source, wf) : new Map<number, number>();
    const lines = script?.source ? script.source.split('\n') : [];
    fill(code, ...(lines.length
      ? lines.map((text, i) => {
        const phase = lit.get(i);
        const colour = phase !== undefined ? colourOf(phase) : undefined;
        return h('div', { class: `script-line${colour ? ' lit' : ''}`, style: colour ? `--c:${colour}` : '' }, h('span', { class: 'script-num' }, String(i + 1)), text || ' ');
      })
      : [h('div', { class: 'muted' }, script ? 'The office never saw this workflow’s script.' : 'Reading the script…')]));
    // the first time there's something running, bring it into view
    const first = code.querySelector('.script-line.lit');
    if (first && !scrolled) {
      scrolled = true;
      first.scrollIntoView({ block: 'center' });
    }

    const section = (heading: string, colour: string, ...children: (Node | string | null)[]) =>
      h('div', { class: 'script-section' }, h('div', { class: 'script-heading', style: `color:${colour}` }, heading), ...children);
    fill(side,
      h('div', { class: 'muted', style: 'margin-bottom:10px' }, wf.description),
      section('Phases', LCARS.orange, ...(phases.length
        ? phases.map((p) => h('div', { class: 'script-phase', style: `--c:${LCARS[phaseColour(p)]}` },
          h('div', null, h('b', null, p.title), h('span', { class: 'muted' }, ` · ${countsLine(p)}`)),
          p.detail ? h('div', { class: 'muted' }, p.detail) : null))
        : [h('div', { class: 'muted' }, 'It hasn’t named any yet.')])),
      script?.logs.length ? section('Log', LCARS.lilac, ...script.logs.map((l) => h('div', { class: 'script-mono' }, l))) : null,
      script?.result !== undefined ? section('Returned', wf.status === 'failed' ? LCARS.red : '#9c6', h('pre', { class: 'script-result' }, script.result)) : null,
      wf.usage ? section('Used', LCARS.gold, h('div', null, usageLine(wf.usage))) : null,
    );
  };

  const read = () => void api.workflowScript(leadId, workflowId).then((s) => {
    script = s;
    render();
  }).catch(() => undefined);
  render();
  read();
  const timer = setInterval(() => {
    if (workflow?.status === 'running' || !script?.logs.length) read();
  }, REFRESH_MS);
  ui.panels.own(() => clearInterval(timer));

  ui.panels.own(state.on('agent', (a) => {
    if (a.id !== leadId) return;
    const next = workflowOf(a, workflowId);
    if (!next) return;
    const ended = workflow?.status === 'running' && next.status !== 'running';
    workflow = next;
    render();
    if (ended) read();
  }));
  ui.panels.own(state.on('agent-removed', (a) => a.id === leadId && ui.panels.close()));
}
