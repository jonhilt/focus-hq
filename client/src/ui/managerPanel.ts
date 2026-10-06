import { autoMergeFor } from '../../../shared/mergeGate';
import type { Autonomy, PreviewConfig, Project, RoomTheme, SpeechStatus, VoiceStatus } from '../../../shared/types';
import { DESKS_PER_ROOM, ROOM_THEMES } from '../../../shared/types';
import { voiceMissing, WHISPER_INSTALL } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { roomTheme, THEME_INFO } from '../world/themes';
import { effortPicker, pickedCloud, pickedEffort, wherePicker } from './agentPanel';
import type { ManagerTab, Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';
import { plannerCard } from './plannerCard';

const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#c879ff', '#fde74c', '#ff5d8f', '#2ec4b6', '#f4a259'];

let repoCache: Promise<string[]> | null = null;
function knownRepos(): Promise<string[]> {
  repoCache ??= api.listRepos().catch(() => {
    repoCache = null;
    return [];
  });
  return repoCache;
}

/** Picker for the program a holodeck runs. */
function themeSelect(selected: RoomTheme | '', surprise = false): HTMLSelectElement {
  const options = ROOM_THEMES.map((t) => h('option', { value: t, selected: t === selected }, `${THEME_INFO[t].emoji} ${THEME_INFO[t].label}`));
  if (surprise) options.unshift(h('option', { value: '', selected: selected === '' }, '✨ Surprise me'));
  return h('select', null, ...options);
}

function repoDatalist(id: string): HTMLDataListElement {
  const list = h('datalist', { id });
  void knownRepos().then((repos) => list.replaceChildren(...repos.map((r) => h('option', { value: r }))));
  return list;
}

/** The ready room console: projects, repositories, new issues and ship-wide settings. */
export function openManagerPanel(ui: Ui, tab: ManagerTab = state.projects.length ? 'projects' : 'new-project'): void {
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const names: [ManagerTab, string][] = [
    ['projects', '🏢 Projects'],
    ['new-project', '＋ New project'],
    ['issue', '📝 New issue'],
    ['settings', '⚙️ Settings'],
  ];
  let current = tab;
  let selected: string | undefined;
  const show = (t: ManagerTab) => {
    current = t;
    tabs.replaceChildren(...names.map(([key, label]) => h('button', { class: `tab${key === t ? ' on' : ''}`, onclick: () => show(key) }, label)));
    body.replaceChildren(
      t === 'projects' ? projectsTab(ui, show, selected, openProject)
        : t === 'new-project' ? newProjectTab(ui, openProject)
        : t === 'issue' ? issueForm(ui)
        : settingsTab(ui),
    );
  };
  const openProject = (id: string) => {
    selected = id;
    show('projects');
  };
  ui.panels.open({ title: '🎖️ Ready room', body, tabs, accent: LCARS.lilac });
  show(tab);
  // keep the projects list fresh, but never wipe a form the manager is typing into
  ui.panels.own(state.on('projects', () => current === 'projects' && !body.contains(document.activeElement) && show('projects')));
  ui.panels.own(state.on('info', () => current === 'settings' && !body.contains(document.activeElement) && show('settings')));
}

/** One project at a time, picked from a list, so the console stays navigable however many projects there are. */
function projectsTab(ui: Ui, show: (t: ManagerTab) => void, selected: string | undefined, openProject: (id: string) => void): HTMLElement {
  const project = state.project(selected ?? '') ?? state.projects[0];
  if (!project) {
    return h('div', { class: 'empty' },
      h('p', null, 'No projects yet. Each project gets its own holodeck with stations for agents.'),
      h('button', { class: 'btn primary', onclick: () => show('new-project') }, '＋ Create your first project'),
    );
  }
  const list = h('nav', { class: 'project-list' },
    ...state.projects.map((p, i) =>
      h('button', { class: `project-pick${p === project ? ' on' : ''}`, onclick: () => openProject(p.id) },
        h('span', { class: 'dot', style: `background:${p.color}` }),
        h('span', { class: 'grow' }, p.name, h('small', null, `Holodeck ${i + 1} · ${p.repos.length} repo${p.repos.length === 1 ? '' : 's'}`)),
      ),
    ),
  );
  return h('div', { class: 'projects' }, list, projectCard(ui, project));
}

function projectCard(ui: Ui, p: Project): HTMLElement {
  const name = h('input', { type: 'text', value: p.name });
  const color = h('input', { type: 'color', value: p.color });
  const save = () => void api.updateProject(p.id, { name: name.value, color: color.value }).catch((e: Error) => ui.error(e.message));
  name.addEventListener('change', save);
  color.addEventListener('change', save);

  const chips = h('div', { class: 'repo-chips' },
    ...(p.repos.length ? p.repos : []).map((repo) =>
      h('span', { class: 'chip' },
        h('a', { href: `https://github.com/${repo}`, target: '_blank', rel: 'noreferrer' }, repo),
        h('button', {
          title: `Disconnect ${repo}`,
          onclick: () => {
            if (confirm(`Disconnect ${repo} from ${p.name}? (The GitHub repository is not touched.)`)) {
              void api.disconnectRepo(p.id, repo).catch((e: Error) => ui.error(e.message));
            }
          },
        }, '✕'),
      ),
    ),
    p.repos.length ? null : h('span', { class: 'muted' }, 'No repositories connected yet.'),
  );

  const listId = `repos-${p.id}`;
  const repoInput = h('input', { type: 'text', placeholder: 'owner/name or GitHub URL', attrs: { list: listId } });
  const connect = h('button', { class: 'btn small primary' }, 'Connect');
  connect.onclick = () => void busy(connect, async () => {
    await api.connectRepo(p.id, repoInput.value);
    repoInput.value = '';
  }, ui.error);

  const newRepo = h('input', { type: 'text', placeholder: 'new-repo-name' });
  const newRepoPrivate = h('input', { type: 'checkbox', checked: true });
  const create = h('button', { class: 'btn small' }, '✨ Create blank repo');
  create.onclick = () => void busy(create, async () => {
    const { repo } = await api.createRepo({ name: newRepo.value, private: newRepoPrivate.checked, description: `Part of ${p.name}`, projectId: p.id });
    newRepo.value = '';
    ui.hud.toast('success', `Created ${repo}`);
  }, ui.error);

  const firstRepo = p.repos[0]?.split('/')[1] ?? 'repo';
  const fields: [keyof PreviewConfig, string, string][] = [
    ['command', 'Start', 'auto: npm install && npm run dev in the PR’s repo'],
    ['stopCommand', 'Stop', `optional, e.g. {dir:${firstRepo}}/scripts/stack down`],
    ['statusCommand', 'Progress', 'optional, polled while starting: JSON with a "phase", or a list of stacks'],
  ];
  const previewInputs = fields.map(([key, label, placeholder]) => {
    const input = h('input', { type: 'text', value: p.preview?.[key] ?? '', placeholder, spellcheck: false });
    input.addEventListener('change', () => {
      const preview = Object.fromEntries(previewInputs.map(([k, , el]) => [k, el.value.trim()]));
      void api.updateProject(p.id, { preview }).catch((e: Error) => ui.error(e.message));
    });
    return [key, label, input] as const;
  });
  const previews = p.repos.length
    ? h('div', null,
        h('div', { class: 'label', style: 'margin-top:14px' }, '▶ Preview'),
        ...previewInputs.map(([, label, input]) => h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { style: 'min-width:80px' }, label), h('div', { class: 'grow' }, input))),
        h('small', { class: 'muted', style: 'display:block;margin-top:4px' },
          'Runs in a checkout of the PR when you press ▶ Preview on the board. {dir} is that checkout, {dir:<repo>} another repo of this project ',
          '(the PR’s code if the PR is in it, its default branch otherwise), {port} a free port (also $FOCUS_PREVIEW_PORT). ',
          'Links come from the JSON the command prints ({"urls": {"web": "http://…"}}) or the local URLs in its output.'),
      )
    : null;

  const maxAgents = h('input', { type: 'number', min: '1', max: String(DESKS_PER_ROOM), value: String(p.maxAgents), style: 'width:80px' });
  maxAgents.addEventListener('change', () => void api.updateProject(p.id, { maxAgents: Number(maxAgents.value) }).catch((e: Error) => ui.error(e.message)));
  const auto = h('input', { type: 'checkbox', checked: p.autoAssign });
  const label = h('input', { type: 'text', value: p.autoLabel, placeholder: 'any label', style: 'width:140px' });
  const saveAuto = () => void api.updateProject(p.id, { autoAssign: auto.checked, autoLabel: label.value }).catch((e: Error) => ui.error(e.message));
  auto.addEventListener('change', saveAuto);
  label.addEventListener('change', saveAuto);
  const autoMerge = h('input', { type: 'checkbox', checked: autoMergeFor(p) });
  autoMerge.addEventListener('change', () => void api.updateProject(p.id, { autoMerge: autoMerge.checked }).catch((e: Error) => ui.error(e.message)));
  const theme = themeSelect(roomTheme(p));
  theme.addEventListener('change', () => void api.updateProject(p.id, { theme: theme.value as RoomTheme }).catch((e: Error) => ui.error(e.message)));

  const remove = h('button', { class: 'btn small danger' }, '🗑 Close project');
  remove.onclick = () => {
    if (!confirm(`Close ${p.name}? Its agents are sent home. Nothing on GitHub is deleted.`)) return;
    void busy(remove, () => api.deleteProject(p.id), ui.error);
  };

  const room = state.projects.indexOf(p) + 1;
  return h('div', { class: 'card', style: `border-left: 14px solid ${p.color}` },
    h('div', { class: 'row' }, color, h('div', { class: 'grow' }, name), h('span', { class: 'chip' }, `Holodeck ${room}`),
      h('button', { class: 'btn small', onclick: () => ui.openBoard(p.id) }, '📋 Board'),
      h('button', {
        class: 'btn small',
        onclick: () => {
          const place = ui.places().find((pl) => pl.projectId === p.id);
          if (place) ui.goTo(place);
        },
      }, '🚶 Go there'),
    ),
    h('div', { class: 'label', style: 'margin-top:12px' }, 'Repositories'),
    chips,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, repoInput), connect, repoDatalist(listId)),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('div', { class: 'grow' }, newRepo), h('label', { class: 'row', style: 'gap:4px' }, newRepoPrivate, 'private'), create),
    previews,
    h('div', { class: 'row', style: 'margin-top:14px' },
      h('label', { class: 'row', style: 'gap:6px' }, 'Holodeck program', theme),
      h('label', { class: 'row', style: 'gap:6px' }, 'Agents at once', maxAgents),
      h('label', { class: 'row', style: 'gap:6px' }, auto, 'Auto-assign open issues'),
      h('label', { class: 'row', style: 'gap:6px' }, 'with label', label),
      h('label', { class: 'row', style: 'gap:6px', title: 'Merges a PR the crew opened once QA passed its latest commit and its checks are green' }, autoMerge, 'Auto-merge QA-passed PRs'),
      h('span', { class: 'grow' }),
      remove,
    ),
  );
}

function newProjectTab(ui: Ui, openProject: (id: string) => void): HTMLElement {
  const name = h('input', { type: 'text', placeholder: 'e.g. Sock Shop', autofocus: true });
  const color = h('input', { type: 'color', value: COLORS[state.projects.length % COLORS.length] });
  const repos = h('textarea', { placeholder: 'owner/frontend\nowner/backend', style: 'min-height:80px' });
  const blank = h('input', { type: 'checkbox' });
  const blankName = h('input', { type: 'text', placeholder: 'repository name (defaults to the project name)' });
  const blankPrivate = h('input', { type: 'checkbox', checked: true });
  const blankOpts = h('div', { style: 'display:none;margin:-4px 0 12px 28px' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, blankName), h('label', { class: 'row', style: 'gap:4px' }, blankPrivate, 'private')),
  );
  blank.addEventListener('change', () => (blankOpts.style.display = blank.checked ? '' : 'none'));
  const theme = themeSelect('', true);

  const create = h('button', { class: 'btn primary' }, '✨ Load the holodeck');
  create.onclick = () => void busy(create, async () => {
    if (!name.value.trim()) throw new Error('Give the project a name');
    const list = repos.value.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean);
    const project = await api.createProject(name.value, color.value, list, (theme.value || undefined) as RoomTheme | undefined);
    if (blank.checked) {
      const repoName = (blankName.value || name.value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      await api.createRepo({ name: repoName, private: blankPrivate.checked, description: name.value, projectId: project.id });
    }
    ui.hud.toast('success', `${project.name} has a holodeck!`, {
      label: 'Go there',
      run: () => {
        const place = ui.places().find((p) => p.projectId === project.id);
        if (place) ui.goTo(place);
      },
    });
    openProject(project.id);
  }, ui.error);

  return h('div', null,
    h('div', { class: 'field' }, h('label', null, 'Project name'), h('div', { class: 'row' }, color, h('div', { class: 'grow' }, name))),
    h('div', { class: 'field' },
      h('label', null, 'Existing GitHub repositories'),
      repos,
      h('small', null, 'One per line, as owner/name or a GitHub URL. Leave empty to add them later.'),
    ),
    h('div', { class: 'field' },
      h('label', null, 'Holodeck program'),
      theme,
      h('small', null, 'The holodeck’s walls disappear and the crew works in the middle of this instead. Change it any time.'),
    ),
    h('label', { class: 'row', style: 'margin-bottom:12px;font-weight:600' }, blank, '✨ Also create a new, blank repository on GitHub for it'),
    blankOpts,
    h('div', { class: 'row' }, create),
  );
}

/** Form for filing a new issue; optionally hires an agent for it straight away. */
export function issueForm(ui: Ui, projectId?: string, onDone?: () => void): HTMLElement {
  if (!state.projects.length) return h('div', { class: 'empty' }, 'Create a project first.');
  const project = h('select', null, ...state.projects.map((p) => h('option', { value: p.id, selected: p.id === projectId }, p.name)));
  const repo = h('select');
  const fillRepos = () => {
    const p = state.project(project.value);
    repo.replaceChildren(...(p?.repos ?? []).map((r) => h('option', { value: r }, r)));
    repo.disabled = !p?.repos.length;
  };
  fillRepos();
  const title = h('input', { type: 'text', placeholder: 'What needs doing?' });
  const body = h('textarea', { placeholder: 'Details, acceptance criteria, links… (Markdown)' });
  const planner = plannerCard(ui, () => project.value, { repo, title, body });
  project.addEventListener('change', () => {
    fillRepos();
    planner.refresh();
  });
  const labels = h('input', { type: 'text', placeholder: 'bug, enhancement (must already exist on GitHub)' });
  const assign = h('input', { type: 'checkbox', checked: true });
  const effort = effortPicker();
  const where = wherePicker();
  assign.addEventListener('change', () => {
    effort.disabled = !assign.checked;
    where.disabled = !assign.checked;
  });
  const submit = h('button', { class: 'btn primary' }, '📌 Pin it to the board');
  submit.onclick = () => void busy(submit, async () => {
    if (!repo.value) throw new Error('This project has no repositories yet');
    const result = await api.createIssue({
      projectId: project.value,
      repo: repo.value,
      title: title.value,
      body: body.value,
      labels: labels.value.split(',').map((l) => l.trim()).filter(Boolean),
      assign: assign.checked,
      effort: pickedEffort(effort),
      cloud: pickedCloud(where),
      fromDraft: planner.usedDraft(),
    });
    title.value = '';
    body.value = '';
    const agent = result.agent;
    ui.hud.toast('success', agent ? `#${result.issue.number} filed – ${agent.name} is on it` : `#${result.issue.number} filed`, agent ? { label: 'Watch', run: () => ui.goToAgent(agent.id) } : undefined);
    onDone?.();
  }, ui.error);

  return h('div', null,
    h('div', { class: 'field' }, h('label', null, 'Project'), project),
    planner.el,
    h('div', { class: 'row' },
      h('div', { class: 'field grow' }, h('label', null, 'Repository'), repo),
    ),
    h('div', { class: 'field' }, h('label', null, 'Title'), withMic(ui, title)),
    h('div', { class: 'field' }, h('label', null, 'Description'), withMic(ui, body)),
    h('div', { class: 'field' }, h('label', null, 'Labels'), labels),
    h('div', { class: 'row', style: 'margin-bottom:14px' },
      h('label', { class: 'row', style: 'font-weight:600' }, assign, '🤖 Assign an agent right away'),
      effort,
      where,
    ),
    h('div', { class: 'row' }, submit),
  );
}

function settingsTab(ui: Ui): HTMLElement {
  const info = state.info;
  if (!info) return h('div', { class: 'empty' }, 'Connecting…');
  const s = info.settings;
  const save = (patch: Parameters<typeof api.updateSettings>[0]) => void api.updateSettings(patch).catch((e: Error) => ui.error(e.message));

  const options: [Autonomy, string, string][] = [
    ['ask', '✋ Raise your hand', 'Agents edit files and run common dev commands (git, npm, tests…) freely. Anything else waits for your approval – walk over or use the toast.'],
    ['auto', '🤖 Auto mode', "Claude Code's auto-mode classifier approves safe actions; agents only raise their hand when it can't decide."],
    ['full', '🚀 Full autonomy', 'Bypass all permission checks. Fastest, but agents can run any command on this machine.'],
  ];
  const autonomy = h('div', { class: 'autonomy' },
    ...options.map(([value, title, text]) => {
      const radio = h('input', { type: 'radio', name: 'autonomy', value, checked: s.autonomy === value });
      radio.addEventListener('change', () => save({ autonomy: value }));
      return h('label', { class: s.autonomy === value ? 'on' : '' }, radio, h('div', null, h('strong', null, title), h('div', { class: 'muted' }, text)));
    }),
  );

  const max = h('input', { type: 'number', min: '1', max: '32', value: String(s.maxConcurrent), style: 'width:90px' });
  max.addEventListener('change', () => save({ maxConcurrent: Number(max.value) }));
  const model = h('input', { type: 'text', value: s.model, placeholder: "Claude Code's default" });
  model.addEventListener('change', () => save({ model: model.value }));
  const merge = h('select', null, ...(['squash', 'merge', 'rebase'] as const).map((m) => h('option', { value: m, selected: s.mergeMethod === m }, m)));
  merge.addEventListener('change', () => save({ mergeMethod: merge.value as 'squash' }));
  const attribution = h('input', { type: 'checkbox', checked: s.attribution });
  attribution.addEventListener('change', () => save({ attribution: attribution.checked }));
  const recheck = h('button', { class: 'btn small' }, '⟳ Check again');
  recheck.onclick = () => void busy(recheck, () => api.checkGitHub(), ui.error);

  return h('div', null,
    h('div', { class: 'field' }, h('label', null, 'How much can agents do on their own?'), autonomy, h('small', null, 'Applies to agents started from now on.')),
    h('div', { class: 'field' }, h('label', null, 'Agents working at once (all projects)'), max, h('small', null, 'Each agent is a full Claude Code session on your subscription – more agents use your limits faster.')),
    h('div', { class: 'field' }, h('label', null, 'Model'), model, h('small', null, 'e.g. claude-opus-5-5 or claude-sonnet-5-5. Leave empty for your Claude Code default.')),
    h('div', { class: 'field' }, h('label', null, 'Merge method for the board’s Merge button'), merge),
    h('div', { class: 'field' }, h('label', null, attribution, ' Sign pull requests and QA reports'), h('small', null, 'Names the agent or QA officer who did the work, and mentions Focus, in what the office posts on GitHub.')),
    h('div', { class: 'card', style: 'margin-top:8px' },
      h('div', { class: 'row' },
        h('strong', null, 'GitHub'),
        info.github.ok ? h('span', { class: 'chip ok' }, `signed in as ${info.github.login}`) : h('span', { class: 'chip bad' }, 'not connected'),
        h('span', { class: 'grow' }),
        recheck,
      ),
      info.github.error ? h('p', { class: 'muted' }, info.github.error) : null,
      h('p', { class: 'muted', style: 'margin-bottom:0' },
        info.mode === 'demo'
          ? 'Demo mode: GitHub and the agents are simulated. Run "npm run dev" for the real thing.'
          : 'Live mode: GitHub through the gh CLI, agents through the Claude Agent SDK using your Claude login.'),
    ),
    voiceSection(ui),
  );
}

const MB = 1024 * 1024;

/** Kokoro, the crew's voices in briefings: downloaded here or the first time voice mode is switched on. */
function speechSetup(speech: SpeechStatus, ui: Ui): HTMLElement {
  const engine = speech.engine;
  const get = h('button', { class: 'btn small primary' }, engine.state === 'failed' ? '↻ Try again' : speech.downloaded ? 'Load' : '⬇ Download (90 MB)');
  get.onclick = () => void busy(get, () => api.loadSpeech(), ui.error);
  const chip =
    engine.state === 'ready' ? h('span', { class: 'chip ok', title: speech.path }, 'ready')
    : engine.state === 'loading' ? h('span', { class: 'chip' }, speech.downloaded ? 'loading…' : 'downloading…')
    : engine.state === 'failed' ? [h('span', { class: 'chip bad' }, 'failed'), get]
    : speech.downloaded ? [h('span', { class: 'chip ok', title: speech.path }, 'downloaded'), get]
    : [h('span', { class: 'chip bad' }, 'missing'), get];
  return h('div', null,
    h('div', { class: 'voice-row' }, h('span', null, 'Crew voices'), chip),
    h('small', { class: 'muted' }, 'Kokoro speaks the crew’s lines in a briefing’s 🔊 voice mode, on this machine. Until it’s ready, the browser’s built-in voice stands in.'),
    engine.state === 'loading' && engine.bytes
      ? h('div', { class: 'voice-progress' },
          h('progress', engine.total ? { max: engine.total, value: engine.bytes } : null),
          h('small', { class: 'muted' }, `${Math.round(engine.bytes / MB)}${engine.total ? ` of ${Math.round(engine.total / MB)}` : ''} MB`),
        )
      : null,
    engine.state === 'failed' ? h('p', { class: 'planner-error' }, engine.error) : null,
  );
}

/** Dictation's setup: whisper-cli (installed by hand) and its model (downloaded from here). Follows the server live. */
function voiceSection(ui: Ui): HTMLElement {
  const el = h('div', { class: 'card voice-setup', style: 'margin-top:12px' });
  const render = (voice: VoiceStatus | null) => {
    if (!voice) return fill(el, h('strong', null, 'Voice input'), h('p', { class: 'muted' }, 'Connecting…'));
    const recheck = h('button', { class: 'btn small', title: 'Look for whisper-cli and the model again' }, '⟳ Check again');
    recheck.onclick = () => void busy(recheck, () => api.voiceStatus(), ui.error);
    const copy = h('button', { class: 'btn small' }, '📋 Copy');
    copy.onclick = () => void navigator.clipboard.writeText(WHISPER_INSTALL).then(() => ui.hud.toast('info', `Copied: ${WHISPER_INSTALL}`), (e: Error) => ui.error(e.message));
    const download = voice.download;
    const running = download?.state === 'running';
    const get = h('button', { class: 'btn small primary', disabled: running }, download?.state === 'failed' ? '↻ Retry download' : '⬇ Download model (574 MB)');
    get.onclick = () => void busy(get, () => api.downloadVoiceModel(), ui.error);

    fill(el,
      h('div', { class: 'row' },
        h('strong', null, '🎤 Voice input'),
        voiceMissing(voice) ? h('span', { class: 'chip bad' }, 'not set up') : h('span', { class: 'chip ok' }, 'ready'),
        h('span', { class: 'grow' }),
        recheck,
      ),
      h('p', { class: 'muted' }, 'Dictate into the office’s text boxes with 🎤 or Ctrl+M. whisper.cpp transcribes on this machine: your audio never leaves it.'),
      h('div', { class: 'voice-row' },
        h('span', null, 'whisper-cli'),
        voice.whisper.found
          ? h('span', { class: 'chip ok', title: voice.whisper.command }, 'found')
          : [h('span', { class: 'chip bad' }, 'not found'), h('code', null, WHISPER_INSTALL), copy],
      ),
      h('div', { class: 'voice-row' },
        h('span', null, 'Speech model'),
        voice.model.present ? h('span', { class: 'chip ok', title: voice.model.path }, 'present') : [h('span', { class: 'chip bad' }, 'missing'), get],
      ),
      running
        ? h('div', { class: 'voice-progress' },
            h('progress', download.total ? { max: download.total, value: download.bytes } : null),
            h('small', { class: 'muted' }, `${Math.round(download.bytes / MB)}${download.total ? ` of ${Math.round(download.total / MB)}` : ''} MB`),
          )
        : null,
      download?.state === 'failed' ? h('p', { class: 'planner-error' }, download.error) : null,
      voice.model.present ? null : h('small', { class: 'muted' }, `Or download it yourself to ${voice.model.path}.`),
      speechSetup(voice.speech, ui),
    );
  };
  ui.panels.own(state.on('voice', () => el.isConnected && render(state.voice)));
  render(state.voice);
  return el;
}
