import { helperFor, UNIFORM } from '../../../shared/crew';
import type { Agent, Helper, TermLine } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { fill, h, timeAgo } from './dom';
import { TermView } from './terminal';

const helperOf = (lead: Agent | undefined, id: string): Helper | undefined => lead?.helpers?.find((x) => x.id === id);

/**
 * A lead's helper (one of Claude Code's subagents) at the team station: its own transcript, from what the lead asked of
 * it to how it got on, without the lead's conversation round it. You talk to the lead, not the helper.
 */
export function openHelperPanel(ui: Ui, leadId: string, id: string): void {
  const lead = state.agents.get(leadId);
  const helper = helperOf(lead, id);
  if (!lead || !helper) return ui.openAgent(leadId);
  const crew = helperFor(id);

  const term = new TermView();
  const terminal = term.el;
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, info, h('div', { class: 'agent-grid single' }, terminal));
  const talk = h('button', { class: 'btn primary', onclick: () => ui.openAgent(leadId) }, `Talk to ${lead.name}`);
  const footer = h('div', { class: 'compose' }, h('span', { class: 'grow muted' }, `${crew.name} works for ${lead.name}: talk to them about it.`), talk);
  const title = h('h2', null,
    h('span', { class: 'dot', style: `background:${UNIFORM[crew.avatar.division]};margin-right:8px;vertical-align:middle` }),
    `${crew.name} · `,
    h('span', { class: 'muted', style: 'font-weight:500' }, `helping ${lead.name}: ${helper.description}`),
  );
  ui.panels.open({ title, body, footer, wide: true, accent: UNIFORM[crew.avatar.division] });

  const renderInfo = (x: Helper) =>
    fill(
      info,
      h('span', { class: `chip ${x.status === 'done' ? 'ok' : x.status === 'failed' ? 'bad' : ''}` }, x.status),
      h('span', { class: 'grow muted' }, x.activity),
      x.type ? h('span', { class: 'chip' }, x.type) : null,
      x.model ? h('span', { class: 'chip', title: 'The model this helper runs on' }, x.model) : null,
      h('span', { class: 'chip', title: "Claude Code doesn't report a subagent's effort: it thinks at its lead's" }, `${x.effort ?? 'default'} effort (inherited)`),
      h('span', { class: 'chip' }, `started ${timeAgo(x.startedAt)}`),
    );

  const appendLines = (lines: TermLine[]) => {
    const nearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    term.append(lines);
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  };

  renderInfo(helper);
  appendLines(state.lines.get(id) ?? []);
  terminal.scrollTop = terminal.scrollHeight;
  void api.lines(id).then((lines) => {
    term.clear();
    appendLines(lines);
    terminal.scrollTop = terminal.scrollHeight;
  }).catch(() => undefined);

  ui.panels.own(state.on('lines', (e) => e.id === id && appendLines(e.lines)));
  ui.panels.own(state.on('agent', (a) => {
    if (a.id !== leadId) return;
    const x = helperOf(a, id);
    // once they've gone, what they did stays up until you close it
    if (x) renderInfo(x);
    else fill(info, h('span', { class: 'chip off' }, 'gone'), h('span', { class: 'grow muted' }, `${crew.name} has gone on their way`));
  }));
  ui.panels.own(state.on('agent-removed', (a) => a.id === leadId && ui.panels.close()));
}
