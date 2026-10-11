import type { Agent, BackgroundTask, TermLine } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { runningFor } from '../world/probeSlots';
import type { Ui } from './context';
import { confirmDialog } from './confirmDialog';
import { fill, h } from './dom';
import { TermView } from './terminal';

/** How often an open panel reads the task's output again: it keeps writing it as it runs. */
const REFRESH_MS = 2000;

/** A command reads as typed. */
const MONO = 'font-family:var(--mono);text-transform:none;letter-spacing:0';

const STATUS_CHIP: Record<BackgroundTask['status'], string> = { running: '', done: 'ok', failed: 'bad', stopped: 'off' };

const taskOf = (lead: Agent | undefined, id: string): BackgroundTask | undefined => lead?.background?.find((t) => t.id === id);

/**
 * One of a lead's background commands or monitors, from its probe by their chair or their crew list: the tail of its
 * output, read again every couple of seconds while it's open, and a Stop button while it runs (the lead is told).
 */
export function openBackgroundPanel(ui: Ui, leadId: string, taskId: string): void {
  const lead = state.agents.get(leadId);
  const task = taskOf(lead, taskId);
  if (!lead || !task) return ui.openAgent(leadId);
  const what = task.kind === 'monitor' ? 'monitor' : 'background command';

  const term = new TermView();
  const terminal = term.el;
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  const outcome = h('span', { class: 'grow muted' }, `${lead.name}'s ${what}: talk to them about it.`);
  const stop = h('button', { class: 'btn danger', title: `Stop it; ${lead.name} hears that you did` }, 'Stop');
  const talk = h('button', { class: 'btn primary', onclick: () => ui.openAgent(leadId) }, `Talk to ${lead.name}`);
  const footer = h('div', { class: 'compose' }, outcome, stop, talk);
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, info, h('div', { class: 'agent-grid single' }, terminal));
  const title = h('h2', null,
    h('span', { style: MONO }, `${task.kind === 'monitor' ? '◎' : '>_'} ${task.description}`),
    h('span', { class: 'muted', style: 'font-weight:500' }, ` · ${lead.name}'s ${what}`),
  );
  ui.panels.open({ title, body, footer, wide: true });

  let current = task;
  let gone = false;
  const renderInfo = () => {
    const t = current;
    const ended = t.status !== 'running';
    fill(
      info,
      h('span', { class: 'chip' }, t.kind),
      h('span', { class: `chip ${STATUS_CHIP[t.status]}` }, t.status),
      h('span', { class: 'grow muted' }, ended ? (t.summary ?? `ran for ${runningFor(t, Date.now())}`) : `running for ${runningFor(t, Date.now())}`),
      gone ? h('span', { class: 'chip off' }, 'gone') : null,
    );
    stop.style.display = ended || gone ? 'none' : '';
  };
  renderInfo();

  let shown = '';
  const show = (lines: Omit<TermLine, 't'>[]) => {
    const key = `${lines.length}:${lines.at(-1)?.text ?? ''}`;
    if (key === shown) return;
    const nearBottom = !shown || terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    shown = key;
    const t = Date.now();
    term.clear();
    term.append(lines.length ? lines.map((l) => ({ ...l, t })) : [{ t, kind: 'system', text: '✻ No output yet' }]);
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  };
  const read = () => {
    renderInfo();
    // once it's gone from the lead, what it last wrote stays up
    if (gone) return;
    void api.backgroundOutput(leadId, taskId).then(show).catch(() => undefined);
  };
  read();
  const timer = setInterval(read, REFRESH_MS);
  ui.panels.own(() => clearInterval(timer));

  stop.onclick = async () => {
    if (!await confirmDialog({ title: 'Stop', message: `Stop \`${current.description}\`? The lead will be told.`, confirmLabel: 'Stop', danger: true })) return;
    stop.disabled = true;
    try {
      const { stopped } = await api.stopBackground(leadId, taskId);
      outcome.textContent = stopped ? `Stopped: ${lead.name} has been told.` : `Couldn't stop it: ${lead.name}'s session isn't listening any more.`;
    } catch (e) {
      outcome.textContent = `Couldn't stop it: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      stop.disabled = false;
    }
  };

  ui.panels.own(state.on('agent', (a) => {
    if (a.id !== leadId) return;
    const t = taskOf(a, taskId);
    if (t) current = t;
    else gone = true;
    renderInfo();
  }));
  ui.panels.own(state.on('agent-removed', (a) => a.id === leadId && ui.panels.close()));
}
