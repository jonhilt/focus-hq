import { linkedPrs } from '../../../shared/previewSet';
import { sameCommit } from '../../../shared/qa';
import type { Preview, PreviewCheckout, PreviewLink, PreviewLog, PreviewLogFile, PreviewSet } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
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

/**
 * The project's preview: a row per checked-out repo (switch its PR there), links to open it in your own browser, the
 * command's output and log files, restart and stop.
 */
export function openPreviewPanel(ui: Ui, projectId: string, initial?: Preview): void {
  let current = state.previews.get(projectId) ?? initial;
  if (!current) return;
  // what Restart (and a row's picker) runs again, also once the preview has stopped
  let target = { repo: current.repo, number: current.number, title: current.title, set: current.set };
  const startWith = (repo: string, number: number, set: PreviewSet) => api.startPreview(projectId, repo, number, set);

  const title = h('h2');
  const warning = h('div');
  const info = h('div', { class: 'row', style: 'margin-bottom:12px' });
  const repos = h('div', { class: 'preview-repos' });
  const links = h('div', { class: 'preview-links' });
  const tabs = h('div', { class: 'preview-tabs' });
  const terminal = h('div', { class: 'terminal grow' });
  const fileView = h('div', { class: 'terminal grow', style: 'display:none' });
  const body = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, warning, info, repos, links, tabs, terminal, fileView);
  const restart = h('button', { class: 'btn' }, '↻ Restart');
  const stop = h('button', { class: 'btn danger' }, '■ Stop');
  const footer = h('div', { class: 'compose' },
    h('span', { class: 'grow muted', style: 'align-self:center' }, 'Runs the PRs’ code on this machine. Previews stop when one of their PRs is merged or closed.'),
    restart,
    stop,
  );
  ui.panels.open({ title, body, footer, wide: true, accent: LCARS.peach });

  restart.onclick = () => void busy(restart, () => startWith(target.repo, target.number, target.set), ui.error);
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

  /** Repo name, a picker of its open PRs (and the default branch), the checked-out commit and whether the PR moved on. */
  const repoRow = (c: PreviewCheckout) => {
    const board = state.boards.get(projectId);
    const open = (board?.prs ?? []).filter((x) => x.repo === c.repo);
    const main = board?.prs.find((x) => x.repo === target.repo && x.number === target.number);
    const linked = new Set(main && board ? linkedPrs(main, board).map((x) => `${x.repo}#${x.number}`) : []);
    const chosen = 'pr' in c.ref ? c.ref.pr : null;
    const pr = open.find((x) => x.number === chosen);
    const picker = h('select', { class: 'effort', title: 'Restart the preview with another PR here' },
      // the clicked PR's repo always runs a PR: picking another one there previews that one instead
      c.repo === target.repo ? null : h('option', { value: '', selected: chosen === null }, `⎇ ${'branch' in c.ref ? c.ref.branch : 'default branch'}`),
      ...open.map((x) => h('option', { value: String(x.number), selected: x.number === chosen }, `${linked.has(`${x.repo}#${x.number}`) ? '🔗 ' : ''}#${x.number} ${x.title}`)),
      // a PR that has since left the board stays visible as what's running
      chosen !== null && !pr ? h('option', { value: String(chosen), selected: true, disabled: true }, `#${chosen}`) : null,
    );
    picker.onchange = () => {
      const number = picker.value ? Number(picker.value) : null;
      const switching = c.repo === target.repo && number !== null;
      const set = { ...target.set, [c.repo]: number };
      picker.disabled = true;
      startWith(switching ? c.repo : target.repo, switching ? number : target.number, set).catch((e: Error) => {
        ui.error(e.message);
        render(); // back to what's running
      });
    };
    const behind = c.sha && pr?.headSha && c.sha !== 'demo' && !sameCommit(c.sha, pr.headSha);
    return h('div', { class: 'preview-repo' },
      h('strong', null, c.repo.split('/')[1]),
      picker,
      c.sha ? h('span', { class: 'chip', title: c.sha }, c.sha === 'demo' ? 'demo' : c.sha.slice(0, 7)) : h('span', { class: 'chip muted' }, '⏳ fetching'),
      behind ? h('span', { class: 'chip warn', title: 'Someone pushed to this PR since the preview started' }, '↻ behind – restart') : null,
      pr ? h('a', { class: 'btn small', href: `${pr.url}/files`, target: '_blank', rel: 'noreferrer' }, 'PR ↗') : null,
    );
  };

  const render = () => {
    const p = current;
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
    fill(
      info,
      h('span', { class: 'chip' }, p ? `${ICONS[p.status]} ${p.status}` : '💤 stopped'),
      h('span', { class: 'grow muted' }, p ? p.activity : 'Not running'),
      p ? h('span', { class: 'chip' }, `⏱ ${timeAgo(p.startedAt)}`) : null,
    );
    const checkouts = p?.checkouts ?? [];
    // linked PRs in repos the preview command never mentions with {dir:<repo>}: not checked out
    const outside = checkouts.length ? Object.entries(target.set).filter(([repo, n]) => n !== null && !checkouts.some((c) => c.repo === repo)) : [];
    fill(
      repos,
      ...checkouts.map(repoRow),
      ...outside.map(([repo, n]) => {
        const name = repo.split('/')[1];
        return h('div', { class: 'muted preview-repo' }, `🔗 ${name} #${n} isn’t part of the preview: the preview command doesn’t use ${name} (add {dir:${name}} to it).`);
      }),
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
    if (current) target = { repo: current.repo, number: current.number, title: current.title, set: current.set };
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
