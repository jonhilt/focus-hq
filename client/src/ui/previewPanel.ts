import type { Preview, PreviewLink, PreviewLog, PreviewLogFile } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';

const ICONS: Record<Preview['status'], string> = { starting: '⏳', running: '✅', failed: '❗', stopping: '⏹' };
const TROUBLE = /\b(error|errors|fail|failed|failure|exception|fatal|unhealthy|down|refused|denied|panic)\b/i;

/** What a link's last health check found, for a tooltip. */
export function linkHealth(link: PreviewLink): string {
  if (link.health === 'down') return 'Not answering';
  if (link.health === 'error') return `Answering with HTTP ${link.code}`;
  return link.code ? `HTTP ${link.code}` : '';
}

/** The project's preview: links to open it in your own browser, the command's output and log files, restart and stop. */
export function openPreviewPanel(ui: Ui, projectId: string, initial?: Preview): void {
  let current = state.previews.get(projectId) ?? initial;
  if (!current) return;
  // what Restart runs again once the preview has stopped
  let target = { repo: current.repo, number: current.number, title: current.title };

  const title = h('h2');
  const warning = h('div');
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  const links = h('div', { class: 'preview-links' });
  const tabs = h('div', { class: 'preview-tabs' });
  const terminal = h('div', { class: 'terminal grow' });
  const fileView = h('div', { class: 'terminal grow', style: 'display:none' });
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, warning, info, links, tabs, terminal, fileView);
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

  // ---- log files the command reported ("logs"), one tab each next to the command's own output
  let files: PreviewLogFile[] = [];
  let tab = ''; // '' = the command's output
  let shown = '';
  const showFile = async (name: string) => {
    const { text, truncated } = await api.previewLogFile(projectId, name);
    if (tab !== name) return;
    const key = `${name}:${text.length}:${text.slice(-200)}`;
    if (key === shown) return;
    shown = key;
    const atBottom = fileView.scrollHeight - fileView.scrollTop - fileView.clientHeight < 60 || !fileView.childElementCount;
    fileView.replaceChildren(
      ...(truncated ? [h('div', { class: 'system' }, '… (showing the end of the file)')] : []),
      ...text.split(/\r?\n/).map((line) => h('div', { class: TROUBLE.test(line) ? 'error' : 'text' }, line || ' ')),
    );
    if (atBottom) fileView.scrollTop = fileView.scrollHeight;
  };
  const renderTabs = () => {
    fill(
      tabs,
      ...(files.length
        ? [
            h('button', { class: `tab${tab === '' ? ' on' : ''}`, onclick: () => select('') }, '▶ Output'),
            ...files.map((f) => h('button', { class: `tab${tab === f.name ? ' on' : ''}`, title: `${f.size.toLocaleString()} bytes, updated ${timeAgo(f.modified)}`, onclick: () => select(f.name) }, `📄 ${f.name}`)),
          ]
        : []),
    );
    terminal.style.display = tab === '' ? '' : 'none';
    fileView.style.display = tab === '' ? 'none' : '';
  };
  const select = (name: string) => {
    tab = name;
    shown = '';
    fileView.replaceChildren(h('div', { class: 'system' }, 'Loading…'));
    renderTabs();
    if (name) void showFile(name).catch((e: Error) => ui.error(e.message));
  };
  let logsAt = '';
  const refreshFiles = () =>
    void api.previewLogFiles(projectId).then((list) => {
      const changed = list.map((f) => f.name).join('\n') !== files.map((f) => f.name).join('\n');
      files = list;
      if (!changed) return; // don't rebuild the tabs under the cursor every few seconds
      if (tab && !files.some((f) => f.name === tab)) tab = '';
      renderTabs();
      render();
    }, () => undefined);
  const timer = setInterval(() => {
    if (current?.logs) refreshFiles();
    if (tab) void showFile(tab).catch(() => undefined);
  }, 3000);
  ui.panels.own(() => clearInterval(timer));

  const render = () => {
    const p = current;
    const pr = state.boards.get(projectId)?.prs.find((x) => x.repo === target.repo && x.number === target.number);
    title.replaceChildren(
      `▶ ${target.repo.split('/')[1]}#${target.number} · `,
      h('span', { class: 'muted', style: 'font-weight:500' }, target.title),
    );
    fill(
      warning,
      p?.warning && p.status === 'running'
        ? h('div', { class: 'ask' }, h('strong', null, '⚠'), h('span', { class: 'grow' }, p.warning, h('br'), h('small', { class: 'muted' }, files.length ? 'The sites may still be worth a look. The log tabs below say what’s wrong.' : 'The sites may still be worth a look.')))
        : null,
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
        ? found.map((link, i) => {
            const sick = link.health === 'down' || link.health === 'error';
            return h('a', {
              class: `btn ${sick ? 'warn' : i === 0 ? 'go' : ''}`,
              href: link.url,
              target: '_blank',
              rel: 'noreferrer',
              title: [link.url, linkHealth(link)].filter(Boolean).join('\n'),
            }, `${sick ? '⚠ ' : ''}Open ${link.name ?? link.url} ↗`);
          })
        : found.map((link) => h('span', { class: 'chip', title: 'Not answering yet' }, link.name ? `${link.name}: ${link.url}` : link.url))),
      p?.status === 'starting' && !found.length ? h('span', { class: 'muted' }, 'Links appear here as soon as the site answers.') : null,
      p?.command ? h('code', { class: 'grow', title: p.command }, `$ ${p.command}`) : null,
      p?.logs ? h('code', { title: 'Where the command keeps its own logs' }, `📁 ${p.logs}`) : null,
    );
    restart.textContent = p ? '↻ Restart' : '▶ Start again';
    restart.disabled = p?.status === 'stopping';
    stop.textContent = p?.status === 'failed' ? '✕ Dismiss' : '■ Stop';
    stop.title = p?.status === 'failed' ? 'It has already been torn down; this clears it' : '';
    stop.disabled = !p || p.status === 'stopping';
    if ((p?.logs ?? '') !== logsAt) {
      logsAt = p?.logs ?? '';
      refreshFiles();
    }
  };

  render();
  renderTabs();
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
      files = [];
      logsAt = '';
      select('');
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
  if (line.startsWith('⚠')) return 'manager';
  if (line.startsWith('✔')) return 'success';
  if (line.startsWith('$ ')) return 'tool';
  if (line.startsWith('▸')) return 'system';
  return 'text';
}
