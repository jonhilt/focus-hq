import type { Preview, PreviewLog } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';

const ICONS: Record<Preview['status'], string> = { starting: '⏳', running: '✅', failed: '❗', stopping: '⏹' };

/** The project's preview: links to open it in your own browser, the command's output, restart and stop. */
export function openPreviewPanel(ui: Ui, projectId: string, initial?: Preview): void {
  let current = state.previews.get(projectId) ?? initial;
  if (!current) return;
  // what Restart runs again once the preview has stopped
  let target = { repo: current.repo, number: current.number, title: current.title };

  const title = h('h2');
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  const links = h('div', { class: 'preview-links' });
  const terminal = h('div', { class: 'terminal grow' });
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, info, links, terminal);
  const restart = h('button', { class: 'btn' }, '↻ Restart');
  const stop = h('button', { class: 'btn danger' }, '■ Stop');
  const footer = h('div', { class: 'compose' },
    h('span', { class: 'grow muted', style: 'align-self:center' }, 'Runs the PR’s code on this machine. Previews stop when the PR is merged or closed.'),
    restart,
    stop,
  );
  ui.panels.open({ title, body, footer, wide: true, accent: '#b2f2bb88' });

  restart.onclick = () => void busy(restart, () => api.startPreview(projectId, target.repo, target.number), ui.error);
  stop.onclick = () => void busy(stop, () => api.stopPreview(projectId), ui.error);

  // The fetched backlog and live lines can arrive in either order: live ones wait for the backlog, line numbers dedupe.
  let next = 0;
  let loaded = false;
  const early: PreviewLog[] = [];
  const append = (log: PreviewLog) => {
    if (log.startedAt !== current?.startedAt || log.first + log.lines.length <= next) return;
    const nearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    for (const line of log.lines.slice(Math.max(0, next - log.first))) terminal.append(h('div', { class: lineClass(line) }, line || ' '));
    next = log.first + log.lines.length;
    while (terminal.childElementCount > 2000) terminal.firstElementChild?.remove();
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  };

  const render = () => {
    const p = current;
    const pr = state.boards.get(projectId)?.prs.find((x) => x.repo === target.repo && x.number === target.number);
    title.replaceChildren(
      `▶ ${target.repo.split('/')[1]}#${target.number} · `,
      h('span', { class: 'muted', style: 'font-weight:500' }, target.title),
    );
    const behind = p?.sha && pr?.headSha && p.sha !== 'demo' && p.sha !== pr.headSha;
    fill(
      info,
      h('span', { class: 'chip' }, p ? `${ICONS[p.status]} ${p.status}` : '💤 stopped'),
      h('span', { class: 'grow muted' }, p ? p.activity : 'Not running'),
      behind ? h('span', { class: 'chip', style: 'background:#ffe066', title: 'Someone pushed to the PR since this preview started' }, '↻ PR has new commits – restart') : null,
      p?.sha && p.sha !== 'demo' ? h('span', { class: 'chip', title: p.sha }, p.sha.slice(0, 7)) : null,
      p ? h('span', { class: 'chip' }, `⏱ ${timeAgo(p.startedAt)}`) : null,
      pr ? h('a', { class: 'btn small', href: `${pr.url}/files`, target: '_blank', rel: 'noreferrer' }, 'PR ↗') : null,
    );
    const found = p?.links ?? [];
    fill(
      links,
      ...(p?.status === 'running'
        ? found.map((link, i) => h('a', { class: `btn ${i === 0 ? 'go' : ''}`, href: link.url, target: '_blank', rel: 'noreferrer', title: link.url }, `Open ${link.name ?? link.url} ↗`))
        : found.map((link) => h('span', { class: 'chip', title: 'Not answering yet' }, link.name ? `${link.name}: ${link.url}` : link.url))),
      p?.status === 'starting' && !found.length ? h('span', { class: 'muted' }, 'Links appear here as soon as the site answers.') : null,
      p?.command ? h('code', { class: 'grow', title: p.command }, `$ ${p.command}`) : null,
      p?.logs ? h('code', { title: 'Where the command keeps its own logs' }, `📁 ${p.logs}`) : null,
    );
    restart.textContent = p ? '↻ Restart' : '▶ Start again';
    restart.disabled = p?.status === 'stopping';
    stop.disabled = !p || p.status === 'stopping';
  };

  render();
  void api.previewLog(projectId).then(append, () => undefined).finally(() => {
    loaded = true;
    for (const log of early.splice(0)) append(log);
    terminal.scrollTop = terminal.scrollHeight;
  });

  ui.panels.own(state.on('preview', (e) => {
    if (e.projectId !== projectId) return;
    if (e.preview && e.preview.startedAt !== current?.startedAt) {
      // a new run: all of its output streams in from here
      terminal.replaceChildren();
      next = 0;
    }
    current = e.preview ?? undefined;
    if (current) target = { repo: current.repo, number: current.number, title: current.title };
    render();
  }));
  ui.panels.own(state.on('preview-log', (e) => {
    if (e.projectId !== projectId) return;
    if (loaded) append(e.log);
    else early.push(e.log);
  }));
  ui.panels.own(state.on('board', (id) => id === projectId && render()));
}

function lineClass(line: string): string {
  if (line.startsWith('✘')) return 'error';
  if (line.startsWith('✔')) return 'success';
  if (line.startsWith('$ ')) return 'tool';
  if (line.startsWith('▸')) return 'system';
  return 'text';
}
