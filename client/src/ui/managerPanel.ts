import { isHidden } from '../../../shared/hidden';
import { autoMergeFor } from '../../../shared/mergeGate';
import type { Autonomy, Effort, MergeMethod, PreviewConfig, Project, RoomTheme, SpeechStatus, VoiceStatus } from '../../../shared/types';
import { DESKS_PER_ROOM, EFFORT_LEVELS, MERGE_METHODS, ROOM_THEMES } from '../../../shared/types';
import { voiceMissing, WHISPER_INSTALL } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import { roomTheme, THEME_INFO } from '../world/themes';
import { effortPicker, pickedCloud, pickedEffort, wherePicker } from './agentPanel';
import type { ManagerTab, Ui } from './context';
import { withMic } from './dictation';
import { confirmDialog } from './confirmDialog';
import { busy, fill, h } from './dom';
import { SideNav, Switch } from './panels';
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
  const options = ROOM_THEMES.map((t) => h('option', { value: t, selected: t === selected }, THEME_INFO[t].label));
  if (surprise) options.unshift(h('option', { value: '', selected: selected === '' }, 'Surprise me'));
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
  const nav = new SideNav<ManagerTab>((t) => show(t));
  let current = tab;
  let selected: string | undefined;
  const show = (t: ManagerTab) => {
    current = t;
    nav.show([
      { key: 'projects', label: 'Projects', readout: String(state.projects.length) },
      { key: 'new-project', label: 'New project' },
      { key: 'issue', label: 'New issue' },
      { key: 'settings', label: 'Settings' },
    ], t);
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
  ui.panels.open({ title: 'Ready room', body, nav, accent: LCARS.lilac, wide: true });
  show(tab);
  // keep the projects list fresh, but never wipe a form the manager is typing into
  ui.panels.own(state.on('projects', () => current === 'projects' && !body.contains(document.activeElement) && show('projects')));
  ui.panels.own(state.on('info', () => current === 'settings' && !body.contains(document.activeElement) && show('settings')));
}

/** One project at a time, picked from a list, so the console stays navigable however many projects there are. */
function projectsTab(ui: Ui, show: (t: ManagerTab) => void, selected: string | undefined, openProject: (id: string) => void): HTMLElement {
  // a hidden project only opens when picked, so a demo can open the console without landing on one
  const project = state.project(selected ?? '') ?? state.shown[0] ?? state.projects[0];
  if (!project) {
    return h('div', { class: 'empty' },
      h('p', null, 'No projects yet. Each project gets its own holodeck with stations for agents.'),
      h('button', { class: 'btn primary', onclick: () => show('new-project') }, 'Create your first project'),
    );
  }
  const list = h('nav', { class: 'project-list' },
    ...state.projects.map((p, i) =>
      h('button', { class: `project-pick${p === project ? ' on' : ''}`, onclick: () => openProject(p.id) },
        isHidden(p)
          ? [h('span', { class: 'dot', style: 'background:var(--line)' }), h('span', { class: 'grow' }, 'Hidden project', h('small', null, `Holodeck ${i + 1} · in use`))]
          : [
              h('span', { class: 'dot', style: `background:${p.color}` }),
              h('span', { class: 'grow' }, p.name, h('small', null, `Holodeck ${i + 1} · ${p.repos.length} repo${p.repos.length === 1 ? '' : 's'}`)),
            ],
      ),
    ),
  );
  return h('div', { class: 'projects' }, list, isHidden(project) ? hiddenCard(ui, project) : projectCard(ui, project));
}

/** A hidden project's card: nothing about it but where its holodeck is, and the way to show it again. */
function hiddenCard(ui: Ui, p: Project): HTMLElement {
  const show = h('button', { class: 'btn primary' }, 'Show it');
  show.onclick = () => void busy(show, () => api.updateProject(p.id, { hidden: false }), ui.error);
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Hidden project'), h('span', { class: 'chip' }, `Holodeck ${state.projects.indexOf(p) + 1}`)),
    h('p', { class: 'muted' },
      'Its holodeck stays locked behind an “in use” sign, and its name, board and crew show nowhere aboard. ',
      'Its crew keep working on it, and nothing else moves into its holodeck.'),
    h('div', { class: 'row' }, show),
  );
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
        repoMergePicker(ui, p, repo),
        h('button', {
          title: `Disconnect ${repo} from ${p.name}`,
          onclick: () => {
            void confirmDialog({ title: 'Disconnect', message: `Disconnect ${repo} from ${p.name}? (The GitHub repository is not touched.)`, confirmLabel: 'Disconnect', danger: true }).then((ok) => {
              if (ok) void api.disconnectRepo(p.id, repo).catch((e: Error) => ui.error(e.message));
            });
          },
        }, 'Disconnect'),
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
  const newRepoPrivate = new Switch('Private', true);
  const create = h('button', { class: 'btn small' }, 'Create blank repo');
  create.onclick = () => void busy(create, async () => {
    const { repo } = await api.createRepo({ name: newRepo.value, private: newRepoPrivate.on, description: `Part of ${p.name}`, projectId: p.id });
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
        h('div', { class: 'label', style: 'margin-top:14px' }, 'Preview'),
        ...previewInputs.map(([, label, input]) => h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'label', style: 'min-width:80px' }, label), h('div', { class: 'grow' }, input))),
        h('small', { class: 'muted', style: 'display:block;margin-top:4px' },
          'Runs in a checkout of the PR when you press Preview on the board. {dir} is that checkout, {dir:<repo>} another repo of this project ',
          '(the PR’s code if the PR is in it, its default branch otherwise), {port} a free port (also $FOCUS_PREVIEW_PORT). ',
          'Links come from the JSON the command prints ({"urls": {"web": "http://…"}}) or the local URLs in its output.'),
      )
    : null;

  const maxAgents = h('input', { type: 'number', min: '1', max: String(DESKS_PER_ROOM), value: String(p.maxAgents), style: 'width:80px' });
  maxAgents.addEventListener('change', () => void api.updateProject(p.id, { maxAgents: Number(maxAgents.value) }).catch((e: Error) => ui.error(e.message)));
  const label = h('input', { type: 'text', value: p.autoLabel, placeholder: 'any label', style: 'width:140px' });
  const saveAuto = () => void api.updateProject(p.id, { autoAssign: auto.on, autoLabel: label.value }).catch((e: Error) => ui.error(e.message));
  const auto = new Switch('Auto-assign open issues', p.autoAssign, { changed: saveAuto });
  label.addEventListener('change', saveAuto);
  const autoMerge = new Switch('Auto-merge QA-passed PRs', autoMergeFor(p), {
    title: 'Merges a PR the crew opened once QA passed its latest commit and its checks are green',
    changed: (on) => void api.updateProject(p.id, { autoMerge: on }).catch((e: Error) => ui.error(e.message)),
  });
  const theme = themeSelect(roomTheme(p));
  theme.addEventListener('change', () => void api.updateProject(p.id, { theme: theme.value as RoomTheme }).catch((e: Error) => ui.error(e.message)));

  const hide = h('button', { class: 'btn small', title: 'Keep it out of sight, say while you demo the office: its holodeck stays in place behind locked doors, and its crew keep working' }, 'Hide');
  hide.onclick = () => void busy(hide, () => api.updateProject(p.id, { hidden: true }), ui.error);
  const remove = h('button', { class: 'btn small danger' }, 'Close project');
  remove.onclick = async () => {
    if (!await confirmDialog({ title: 'Close project', message: `Close ${p.name}? Its agents are sent home. Nothing on GitHub is deleted.`, confirmLabel: 'Close project', danger: true })) return;
    void busy(remove, () => api.deleteProject(p.id), ui.error);
  };

  return h('div', { class: 'card', style: `border-left: 14px solid ${p.color}` },
    h('div', { class: 'row' }, color, h('div', { class: 'grow' }, name),
      h('button', { class: 'btn small', onclick: () => ui.openBoard(p.id) }, 'Board'),
      h('button', {
        class: 'btn small',
        onclick: () => {
          const place = ui.places().find((pl) => pl.projectId === p.id);
          if (place) ui.goTo(place);
        },
      }, 'Go there'),
    ),
    h('div', { class: 'label', style: 'margin-top:12px' }, 'Repositories'),
    chips,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, repoInput), connect, repoDatalist(listId)),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('div', { class: 'grow' }, newRepo), newRepoPrivate.el, create),
    previews,
    h('div', { class: 'row', style: 'margin-top:14px' },
      h('label', { class: 'row label', style: 'gap:6px' }, 'Holodeck program', theme),
      h('label', { class: 'row label', style: 'gap:6px' }, 'Agents at once', maxAgents),
      auto.el,
      h('label', { class: 'row label', style: 'gap:6px' }, 'with label', label),
      autoMerge.el,
      h('span', { class: 'grow' }),
      hide,
      remove,
    ),
  );
}

/** How a repo's pull requests merge: its own choice, or the office's (Settings) when left on default. */
function repoMergePicker(ui: Ui, p: Project, repo: string): HTMLSelectElement {
  const own = p.mergeMethods?.[repo];
  const office = state.info?.settings.mergeMethod ?? 'squash';
  const select = h('select', { class: 'merge-method', title: `How ${repo}’s pull requests merge` },
    h('option', { value: '', selected: !own }, `default (${office})`),
    ...MERGE_METHODS.map((m) => h('option', { value: m, selected: own === m }, m)),
  );
  select.addEventListener('change', () => void api.setMergeMethod(p.id, repo, select.value as MergeMethod | '').catch((e: Error) => ui.error(e.message)));
  return select;
}

function newProjectTab(ui: Ui, openProject: (id: string) => void): HTMLElement {
  const name = h('input', { type: 'text', placeholder: 'e.g. Sock Shop', autofocus: true });
  const color = h('input', { type: 'color', value: COLORS[state.projects.length % COLORS.length] });
  const repos = h('textarea', { placeholder: 'owner/frontend\nowner/backend', style: 'min-height:80px' });
  const blankName = h('input', { type: 'text', placeholder: 'repository name (defaults to the project name)' });
  const blankPrivate = new Switch('Private', true);
  const blankOpts = h('div', { class: 'row', hidden: true }, h('div', { class: 'grow' }, blankName), blankPrivate.el);
  const blank = new Switch('A new, blank repository on GitHub too', false, { changed: (on) => (blankOpts.hidden = !on) });
  const theme = themeSelect('', true);

  const create = h('button', { class: 'btn primary' }, 'Load the holodeck');
  create.onclick = () => void busy(create, async () => {
    if (!name.value.trim()) throw new Error('Give the project a name');
    const list = repos.value.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean);
    const project = await api.createProject(name.value, color.value, list, (theme.value || undefined) as RoomTheme | undefined);
    if (blank.on) {
      const repoName = (blankName.value || name.value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      await api.createRepo({ name: repoName, private: blankPrivate.on, description: name.value, projectId: project.id });
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
    h('div', { class: 'field' }, blank.el, blankOpts),
    h('div', { class: 'row' }, create),
  );
}

/** Form for filing a new issue; optionally hires an agent for it straight away. */
export function issueForm(ui: Ui, projectId?: string, onDone?: () => void): HTMLElement {
  if (!state.shown.length) return h('div', { class: 'empty' }, 'Create a project first.');
  const project = h('select', null, ...state.shown.map((p) => h('option', { value: p.id, selected: p.id === projectId }, p.name)));
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
  const effort = effortPicker();
  const where = wherePicker();
  const assign = new Switch('Assign an agent right away', true, {
    changed: (on) => {
      effort.disabled = !on;
      where.disabled = !on;
    },
  });
  const submit = h('button', { class: 'btn primary' }, 'Pin it to the board');
  submit.onclick = () => void busy(submit, async () => {
    if (!repo.value) throw new Error('This project has no repositories yet');
    const result = await api.createIssue({
      projectId: project.value,
      repo: repo.value,
      title: title.value,
      body: body.value,
      labels: labels.value.split(',').map((l) => l.trim()).filter(Boolean),
      assign: assign.on,
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
      assign.el,
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
    ['ask', 'Raise your hand', 'Agents edit files and run common dev commands (git, npm, tests…) freely. Anything else waits for your approval – walk over or use the toast.'],
    ['auto', 'Auto mode', "Claude Code's auto-mode classifier approves safe actions; agents only raise their hand when it can't decide."],
    ['full', 'Full autonomy', 'Bypass all permission checks. Fastest, but agents can run any command on this machine.'],
  ];
  const autonomy = h('div', { class: 'autonomy' },
    ...options.map(([value, title, text]) => {
      const radio = h('input', { type: 'radio', name: 'autonomy', value, checked: s.autonomy === value });
      radio.addEventListener('change', () => save({ autonomy: value }));
      return h('label', null, radio, h('div', null, h('strong', null, title), h('div', { class: 'muted' }, text)));
    }),
  );

  const max = h('input', { type: 'number', min: '1', max: '32', value: String(s.maxConcurrent), style: 'width:90px' });
  max.addEventListener('change', () => save({ maxConcurrent: Number(max.value) }));
  const model = h('input', { type: 'text', value: s.model, placeholder: "Claude Code's default" });
  model.addEventListener('change', () => save({ model: model.value }));
  const conflictsModel = h('input', { type: 'text', value: s.conflictsModel, placeholder: 'Use the office model', style: 'flex:1' });
  conflictsModel.addEventListener('change', () => save({ conflictsModel: conflictsModel.value }));
  const conflictsEffort = effortPicker(s.conflictsEffort);
  // an empty choice clears it on the server (undefined wouldn't survive JSON)
  conflictsEffort.addEventListener('change', () => save({ conflictsEffort: (pickedEffort(conflictsEffort) ?? '') as Effort }));
  const qaModel = h('input', { type: 'text', value: s.qaModel, placeholder: 'Use the office model' });
  qaModel.addEventListener('change', () => save({ qaModel: qaModel.value }));
  const merge = h('select', null, ...MERGE_METHODS.map((m) => h('option', { value: m, selected: s.mergeMethod === m }, m)));
  merge.addEventListener('change', () => save({ mergeMethod: merge.value as MergeMethod }));
  const attribution = new Switch('Sign pull requests and QA reports', s.attribution, { changed: (on) => save({ attribution: on }) });
  const userClaudeMd = new Switch('Agents read your own CLAUDE.md', s.userClaudeMd, { changed: (on) => save({ userClaudeMd: on }) });
  const leadEffort = h('select', null, ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: s.leadEffort === e }, e)));
  leadEffort.addEventListener('change', () => {
    const level = EFFORT_LEVELS.find((e) => e === leadEffort.value);
    if (level) save({ leadEffort: level });
  });
  const recheck = h('button', { class: 'btn small' }, 'Check again');
  recheck.onclick = () => void busy(recheck, () => api.checkGitHub(), ui.error);

  return h('div', null,
    h('div', { class: 'field' }, h('label', null, 'How much can agents do on their own?'), autonomy, h('small', null, "Applies to agents started from now on, except any you've given a mode of their own in their panel.")),
    h('div', { class: 'field' }, h('label', null, 'Agents working at once (all projects)'), max, h('small', null, 'Each agent is a full Claude Code session on your subscription – more agents use your limits faster.')),
    h('div', { class: 'field' }, h('label', null, 'Model'), model, h('small', null, 'e.g. claude-opus-5-5 or claude-sonnet-5-5. Leave empty for your Claude Code default.')),
    h('div', { class: 'field' }, h('label', null, 'Model and effort for resolving merge conflicts'), h('div', { class: 'row' }, conflictsModel, conflictsEffort), h('small', null, 'For a new agent seated on a pull request to resolve its conflicts, which is usually mechanical work: e.g. claude-sonnet-5-5. Leave empty for the model above. The developer who opened the PR, if still aboard, resolves them in their own session instead.')),
    h('div', { class: 'field' }, h('label', null, 'Model for QA'), qaModel, h('small', null, 'For every room’s QA officer and every goal’s reviewer, from their next review: e.g. claude-sonnet-5-5. Leave empty for the model above. How hard they think is set at each room’s QA station.')),
    h('div', { class: 'field' }, h('label', null, 'Effort a new goal’s lead starts at'), leadEffort, h('small', null, 'You can pick another when you start a goal. High suits most slices; xhigh and max take longer and cost more.')),
    h('div', { class: 'field' }, h('label', null, 'Merge method for the board’s Merge button'), merge),
    h('div', { class: 'field' }, attribution.el, h('small', null, 'Names the agent or QA officer who did the work, and mentions Focus, in what the office posts on GitHub.')),
    h('div', { class: 'field' }, userClaudeMd.el, h('small', null, 'Your ~/.claude/CLAUDE.md and ~/.claude/rules, written for your own Claude Code. Turn off so agents follow only Focus and the repo’s CLAUDE.md; your ~/.claude/settings.json still loads. Applies to agents started from now on.')),
    h('div', { class: 'card', style: 'margin-top:8px' },
      h('div', { class: 'row' },
        h('strong', { class: 'label' }, 'GitHub'),
        info.github.ok ? h('span', { class: 'chip ok' }, `signed in as ${info.github.login}`) : h('span', { class: 'chip bad' }, 'not connected'),
        h('span', { class: 'grow' }),
        recheck,
      ),
      info.github.error ? h('p', { class: 'muted' }, info.github.error) : null,
      h('p', { class: 'muted', style: 'margin-bottom:0' },
        info.mode === 'demo'
          ? 'Demo mode: GitHub and the agents are simulated. Run "pnpm run dev" for the real thing.'
          : 'Live mode: GitHub through the gh CLI, agents through the Claude Agent SDK using your Claude login.'),
    ),
    voiceSection(ui),
  );
}

const MB = 1024 * 1024;

/** Kokoro, the crew's voices: downloaded here or the first time voice mode is switched on. */
function speechSetup(speech: SpeechStatus, ui: Ui): HTMLElement {
  const engine = speech.engine;
  const get = h('button', { class: 'btn small primary' }, engine.state === 'failed' ? 'Try again' : speech.downloaded ? 'Load' : 'Download (90 MB)');
  get.onclick = () => void busy(get, () => api.loadSpeech(), ui.error);
  const chip =
    engine.state === 'ready' ? h('span', { class: 'chip ok', title: speech.path }, 'ready')
    : engine.state === 'loading' ? h('span', { class: 'chip' }, speech.downloaded ? 'loading…' : 'downloading…')
    : engine.state === 'failed' ? [h('span', { class: 'chip bad' }, 'failed'), get]
    : speech.downloaded ? [h('span', { class: 'chip ok', title: speech.path }, 'downloaded'), get]
    : [h('span', { class: 'chip bad' }, 'missing'), get];
  return h('div', null,
    h('div', { class: 'voice-row' }, h('span', null, 'Crew voices'), chip),
    h('small', { class: 'muted' }, 'Kokoro speaks Number One’s replies in voice mode, on this machine. Until it’s ready, the browser’s built-in voice stands in.'),
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
    if (!voice) return fill(el, h('strong', { class: 'label' }, 'Voice input'), h('p', { class: 'muted' }, 'Connecting…'));
    const recheck = h('button', { class: 'btn small', title: 'Look for whisper-cli and the model again' }, 'Check again');
    recheck.onclick = () => void busy(recheck, () => api.voiceStatus(), ui.error);
    const copy = h('button', { class: 'btn small' }, 'Copy');
    copy.onclick = () => void navigator.clipboard.writeText(WHISPER_INSTALL).then(() => ui.hud.toast('info', `Copied: ${WHISPER_INSTALL}`), (e: Error) => ui.error(e.message));
    const download = voice.download;
    const running = download?.state === 'running';
    const get = h('button', { class: 'btn small primary', disabled: running }, download?.state === 'failed' ? 'Retry download' : 'Download model (574 MB)');
    get.onclick = () => void busy(get, () => api.downloadVoiceModel(), ui.error);

    fill(el,
      h('div', { class: 'row' },
        h('strong', { class: 'label' }, 'Voice input'),
        voiceMissing(voice) ? h('span', { class: 'chip bad' }, 'not set up') : h('span', { class: 'chip ok' }, 'ready'),
        h('span', { class: 'grow' }),
        recheck,
      ),
      h('p', { class: 'muted' }, 'Dictate into the office’s text boxes with Mic or Ctrl+M. whisper.cpp transcribes on this machine: your audio never leaves it.'),
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
