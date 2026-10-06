import { chiefEngineer, crewVoice, plannerFor, qaOfficerFor } from '../../../shared/crew';
import { optionLabel } from '../../../shared/engineering';
import { issueRef, STEP_STATE_LABELS, stepState } from '../../../shared/goals';
import type { Brief, Breakdown, BreakdownEdits, Briefing, EngineeringOption, GoalStep, StepProposal, WrapUpShape } from '../../../shared/types';
import { linesToSpeak } from '../../../shared/voice';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { voicePrefs, VoiceSession } from './briefingVoice';
import { type MicMode, withMic } from './dictation';
import { diagramView } from './diagrams';
import { busy, fill, h } from './dom';

let open = false;
/** Whether the briefing panel is showing (so the office doesn't toast what you can already see). */
export const briefingPanelOpen = () => open;

/**
 * The observation lounge's briefing: the conversation with the project's operations officer on the left, the brief
 * they keep on the wall screen on the right, under the engineer's options once engineering has been asked. For a goal,
 * the step they propose sits above the message box, and the brief shows where you're going and the steps so far. With
 * no briefing in session, a form to call one, under the goals parked until you reconvene them.
 */
export function openBriefingPanel(ui: Ui, projectId?: string): void {
  const body = h('div', { class: 'briefing' });
  const title = h('h2');
  // the message box outlives re-renders, so a reply arriving doesn't wipe what you're typing
  const input = h('textarea', { class: 'briefing-input' });
  // 🔊 voice mode: the crew speak their new lines, and 🎤 / Ctrl+M is push-to-talk, sending what you say
  let voice = voicePrefs.voiceMode ? new VoiceSession(voicePrefs.keepMicOpen) : null;
  ui.panels.own(() => voice?.end());
  const micMode = (): MicMode =>
    voice ? { kind: 'talk', mic: voice.mic, started: () => voice?.speaker.hush(), send: (text) => api.briefingSay(text).then(() => undefined) } : { kind: 'dictate' };
  const inputBox = withMic(ui, input, micMode);
  // what was in the log when the panel opened has been said: only lines after it are spoken
  let heard = { id: state.briefing?.id, count: state.briefing?.messages.length ?? 0 };
  const speak = (briefing: Briefing) => {
    const lines = linesToSpeak(briefing.messages, heard.id === briefing.id ? heard.count : 0);
    heard = { id: briefing.id, count: briefing.messages.length };
    for (const line of lines) voice?.speaker.say(line.text, crewVoice(line.speaker, briefing.projectId));
  };
  const send = h('button', { class: 'btn primary' }, 'Send');
  const sendNow = () => {
    if (!input.value.trim() || send.disabled) return;
    const text = input.value;
    void busy(send, async () => {
      await api.briefingSay(text);
      input.value = '';
    }, ui.error);
  };
  send.onclick = sendNow;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendNow();
    }
  });
  let shownMessages = -1;
  // 📋 Wrap up asks how first: one issue or a breakdown
  let choosing = false;
  // the breakdown editor outlives re-renders too, rebuilt only when what's filed (or the briefing) changes
  let editor: { key: string; view: BreakdownEditor } | null = null;
  // so is the call form (a parked goal's step moving on mustn't wipe what you're typing), rebuilt when the projects change
  let calling: { key: string; el: HTMLElement; goals: HTMLElement } | null = null;
  // and a goal's proposed step, rebuilt only when the officer proposes another
  let stepCard: { key: string; view: StepEditor } | null = null;

  const render = () => {
    const briefing = state.briefing;
    if (!briefing) {
      shownMessages = -1;
      title.textContent = '🖖 Observation lounge';
      const key = JSON.stringify(state.projects.map((p) => [p.id, p.name, p.repos.length]));
      if (calling?.key !== key) calling = { key, ...callForm(ui, projectId) };
      fill(calling.goals, ...parkedGoals(ui));
      if (body.firstChild !== calling.el) fill(body, calling.el);
      return;
    }
    calling = null;
    const goal = briefing.goal;
    speak(briefing);
    const officer = plannerFor(briefing.projectId);
    const qa = qaOfficerFor(briefing.projectId);
    const engineer = chiefEngineer();
    const names = { manager: 'You', officer: officer.name, qa: `${qa.name} · QA`, engineer: `${engineer.name} · Engineering` };
    const project = state.project(briefing.projectId);
    title.textContent = `${goal ? '🧭 Goal' : '🖖 Briefing'}: ${project?.name ?? 'a project'}`;
    const yourTurn = briefing.status === 'waiting' || briefing.status === 'failed';
    input.disabled = !yourTurn;
    send.disabled = !yourTurn;
    input.placeholder = voice
      ? 'Press 🎤 or Ctrl+M and talk, then press again (or hold it and let go): your answer goes as soon as it’s transcribed. Or type it.'
      : 'Your answer… (Enter to send, Shift+Enter for a new line)';

    const log = h('div', { class: 'briefing-log' },
      ...briefing.messages.map((m) =>
        m.from === 'system'
          ? h('div', { class: 'briefing-note' }, m.text)
          : h('div', { class: `briefing-msg ${m.from}` },
              h('strong', null, names[m.from]),
              ...m.text.split(/\n{2,}/).map((p) => h('p', null, p)),
            ),
      ),
      briefing.status === 'thinking' || briefing.status === 'wrapping-up' || (goal && briefing.status === 'filing')
        ? h('div', { class: 'briefing-msg officer typing' }, h('strong', null, officer.name), h('p', null, `✻ ${briefing.activity}`))
        : null,
      briefing.status === 'qa-checking'
        ? h('div', { class: 'briefing-msg qa typing' }, h('strong', null, names.qa), h('p', null, `✻ ${briefing.activity}`))
        : null,
      briefing.status === 'engineering'
        ? h('div', { class: 'briefing-msg engineer typing' }, h('strong', null, names.engineer), h('p', null, `✻ ${briefing.activity}`))
        : null,
      briefing.status === 'failed'
        ? h('div', { class: 'briefing-note error' }, goal?.proposal && briefing.error ? `⚠ ${briefing.error}` : `⚠ ${briefing.error ?? 'Something went wrong'}. Say something to carry on.`)
        : null,
    );

    if (!yourTurn) choosing = false;
    const wrapUp = (shape: WrapUpShape, button: HTMLButtonElement) =>
      void busy(button, async () => {
        await api.briefingWrapUp(shape);
        choosing = false;
      }, ui.error);
    const wrap = h('button', { class: 'btn', title: `${officer.name} writes it up as one issue, or breaks it down into an epic and sub-issues` }, '📋 Wrap up');
    wrap.disabled = !yourTurn || briefing.messages.length < 2;
    wrap.onclick = () => {
      choosing = true;
      render();
    };
    // what's in the message box goes with it: a steer for the first ask, the changes wanted on a second
    const ask = h('button', { class: 'btn', title: `${engineer.name} reads the code and comes back with 2 or 3 options for how to build it. Anything in the message box goes along as a note.` },
      briefing.engineering ? '🔧 Back to engineering' : '🔧 Ask engineering');
    ask.disabled = !yourTurn || briefing.messages.length < 2;
    ask.onclick = () => {
      const text = input.value;
      void busy(ask, async () => {
        await api.briefingAskEngineering(text);
        input.value = '';
      }, ui.error);
    };
    const one = h('button', { class: 'btn primary', title: `${officer.name} writes one issue and leaves it at the stand` }, '📝 One issue');
    one.onclick = () => wrapUp('one', one);
    const breakDown = h('button', { class: 'btn primary', title: `${officer.name} writes an epic and 2 to 5 sub-issues for you to check before anything is filed` }, '🧩 Break it down');
    breakDown.onclick = () => wrapUp('breakdown', breakDown);
    const cancel = h('button', { class: 'btn small' }, 'Not yet');
    cancel.onclick = () => {
      choosing = false;
      render();
    };

    const filed = briefing.status === 'done' && briefing.breakdown;
    const end = h('button', { class: 'btn small' }, briefing.status === 'done' ? '✕ End briefing' : briefing.breakdown ? '✕ End without filing' : '✕ End without an issue');
    end.onclick = () => {
      if (briefing.status === 'done' || confirm(`End the briefing? ${officer.name} won't ${briefing.breakdown ? 'file the breakdown' : 'write anything up'}.`)) {
        void api.briefingEnd().catch((e: Error) => ui.error(e.message));
      }
    };
    const cost = h('small', { class: 'muted' }, briefing.costUsd ? `$${briefing.costUsd.toFixed(2)} so far` : '');

    if (briefing.status !== 'reviewing' && briefing.status !== 'filing') editor = null;
    const reviewing = (briefing.status === 'reviewing' || briefing.status === 'filing') && briefing.breakdown ? briefing.breakdown : null;
    if (reviewing) {
      const key = JSON.stringify([briefing.id, briefing.status, numbers(reviewing)]);
      if (editor?.key !== key) editor = { key, view: breakdownEditor(reviewing, briefing.status === 'filing') };
      const view = editor.view;
      const fileAll = h('button', { class: 'btn primary', title: 'Files the epic, then each sub-issue linked to it' }, '📌 File all');
      fileAll.disabled = briefing.status === 'filing';
      fileAll.onclick = () => {
        const edits = view.edits();
        if (!confirm(`File the epic and ${edits.subIssues.length} sub-issue${edits.subIssues.length === 1 ? '' : 's'} in ${reviewing.repo}?`)) return;
        void busy(fileAll, () => api.briefingFile(edits), ui.error);
      };
      const anyFiled = numbers(reviewing).some((n) => n !== undefined);
      const instead = h('button', { class: 'btn', title: `${officer.name} writes one issue at the stand instead` }, '📝 One issue instead');
      instead.disabled = briefing.status === 'filing' || anyFiled;
      instead.onclick = () => wrapUp('one', instead);
      fill(body,
        h('div', { class: 'briefing-chat' },
          h('div', { class: 'breakdown' },
            briefing.status === 'filing' ? h('div', { class: 'briefing-note' }, `✻ ${briefing.activity}`) : null,
            briefing.error ? h('div', { class: 'briefing-note error' }, `⚠ ${briefing.error}`) : null,
            view.el,
          ),
          h('div', { class: 'row' }, fileAll, instead, cost, h('span', { class: 'grow' }), end),
        ),
        h('aside', { class: 'briefing-brief' }, briefView(briefing.brief, briefing.idea)),
      );
      return;
    }

    if (goal) {
      const next = goal.steps.length ? 'next' : 'first';
      // with a step already proposed, what you've said since goes into a rewrite
      const take = goal.proposal
        ? h('button', { class: 'btn', title: `${officer.name} writes the step again, with what you've said since` }, '↻ Rewrite the step')
        : h('button', { class: 'btn', title: `${officer.name} writes up the ${next} step: the smallest one that tests the riskiest unknown, for you to edit and file` }, `🧭 Take the ${next} step`);
      take.disabled = !yourTurn || briefing.messages.length < 2;
      take.onclick = () => void busy(take, () => api.briefingWrapUp('step'), ui.error);
      const park = h('button', { class: 'btn', title: 'Out of the lounge until you reconvene it, so the lounge is free for other briefings' }, '⏸ Park');
      park.disabled = !yourTurn;
      park.onclick = () => void busy(park, () => api.briefingPark(), ui.error);
      const endGoal = h('button', { class: 'btn small' }, '✕ End goal');
      endGoal.onclick = () => {
        if (confirm(`End the goal? ${officer.name} forgets it. Its issues stay on GitHub.`)) void api.briefingEnd().catch((e: Error) => ui.error(e.message));
      };
      const proposal = goal.proposal;
      if (!proposal) stepCard = null;
      else {
        const key = JSON.stringify([briefing.id, proposal]);
        if (stepCard?.key !== key) stepCard = { key, view: stepEditor(ui, proposal) };
        stepCard.view.enable(yourTurn);
      }
      fill(body,
        h('div', { class: 'briefing-chat' }, log, stepCard?.view.el, h('div', null, voiceControls(), inputBox, h('div', { class: 'row' }, send, take, park, cost, h('span', { class: 'grow' }), endGoal))),
        h('aside', { class: 'briefing-brief' }, goalView(briefing)),
      );
      if (briefing.messages.length !== shownMessages) {
        shownMessages = briefing.messages.length;
        requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
      } else {
        log.scrollTop = log.scrollHeight;
      }
      if (yourTurn && !proposal && document.activeElement !== input) input.focus();
      return;
    }

    const controls = briefing.status === 'done'
      ? h('div', { class: 'row' },
          filed ? filedLinks(filed) : h('button', { class: 'btn primary', onclick: () => ui.openNewIssue(briefing.projectId) }, '📝 Open the draft'),
          h('span', { class: 'grow' }),
          end,
        )
      : h('div', null,
          voiceControls(),
          inputBox,
          choosing
            ? h('div', { class: 'row' }, h('strong', null, 'Wrap up as'), one, breakDown, cancel)
            : h('div', { class: 'row' }, send, ask, wrap, cost, h('span', { class: 'grow' }), end),
        );

    fill(body,
      h('div', { class: 'briefing-chat' }, log, controls),
      h('aside', { class: 'briefing-brief' }, optionsView(ui, briefing, yourTurn), briefView(briefing.brief, briefing.idea)),
    );
    if (briefing.messages.length !== shownMessages) {
      shownMessages = briefing.messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (yourTurn && document.activeElement !== input) input.focus();
  };

  const voiceControls = () => {
    const toggle = h('button', { class: `btn small${voice ? ' primary' : ''}`, title: voice ? 'Voice mode is on: the crew speak, and 🎤 sends what you say. Click to turn it off.' : 'Voice mode: the crew say their lines aloud, and you answer by talking' }, voice ? '🔊 Voice on' : '🔈 Voice off');
    toggle.onclick = () => {
      voice?.end();
      voice = voice ? null : new VoiceSession(voicePrefs.keepMicOpen);
      voicePrefs.voiceMode = voice !== null;
      render();
    };
    const keep = h('input', { type: 'checkbox', checked: voicePrefs.keepMicOpen });
    keep.onchange = () => {
      voicePrefs.keepMicOpen = keep.checked;
      voice?.keepMicOpen(keep.checked);
    };
    return h('div', { class: 'row voice-controls' },
      toggle,
      voice
        ? h('label', { title: 'For speakers: saves the glitch each time the mic opens and closes. Leave it off with Bluetooth earphones.' }, keep, ' Keep the mic open between turns')
        : null,
    );
  };

  ui.panels.open({ title, body, accent: LCARS.lilac, wide: true });
  open = true;
  ui.panels.own(() => (open = false));
  ui.panels.own(state.on('briefing', render));
  ui.panels.own(state.on('projects', render));
  render();
}

const numbers = (b: Breakdown) => [b.epic.number, ...b.subIssues.map((s) => s.number)];
const issueUrl = (repo: string, n: number) => `https://github.com/${repo}/issues/${n}`;

function filedLinks(b: Breakdown): HTMLElement {
  const link = (n: number | undefined, label: string) =>
    n === undefined ? null : h('a', { class: 'btn small', href: issueUrl(b.repo, n), target: '_blank', rel: 'noopener', title: label }, `#${n}`);
  return h('div', { class: 'row breakdown-filed' },
    h('span', null, '🧩 Epic'),
    link(b.epic.number, b.epic.title),
    h('span', null, 'Sub-issues'),
    ...b.subIssues.map((s) => link(s.number, s.title)),
  );
}

interface BreakdownEditor {
  el: HTMLElement;
  /** What to file: the titles and bodies as edited, without the sub-issues dropped. */
  edits(): BreakdownEdits;
}

/** The epic and its sub-issues as editable cards. Anything already filed is read-only, with its number. */
function breakdownEditor(b: Breakdown, filing: boolean): BreakdownEditor {
  const card = (number: number | undefined, title: string, body: string) => {
    const t = h('input', { value: title, disabled: filing || number !== undefined });
    const area = h('textarea', { value: body, disabled: filing || number !== undefined });
    return { t, area, fields: [t, area] };
  };
  const tag = (n: number | undefined) => (n === undefined ? null : h('a', { class: 'tag', href: issueUrl(b.repo, n), target: '_blank', rel: 'noopener' }, `#${n} filed`));
  const epic = card(b.epic.number, b.epic.title, b.epic.body);
  const position = new Map(b.subIssues.map((s, i) => [s.key, i + 1]));
  const dropped = new Set<string>();
  const subs = b.subIssues.map((s, i) => {
    const c = card(s.number, s.title, s.body);
    const el = h('div', { class: 'breakdown-card' });
    const drop = h('button', { class: 'btn small', title: 'Leave this one out of the filing' }, '✕ Drop');
    drop.disabled = filing || s.number !== undefined;
    drop.onclick = () => {
      if (dropped.delete(s.key)) drop.textContent = '✕ Drop';
      else {
        dropped.add(s.key);
        drop.textContent = '↩ Keep';
      }
      el.classList.toggle('dropped', dropped.has(s.key));
      for (const f of c.fields) f.disabled = dropped.has(s.key);
    };
    const deps = s.dependsOn.map((k) => {
      const dep = b.subIssues.find((d) => d.key === k)!;
      return dep.number === undefined ? `${position.get(k)}` : `#${dep.number}`;
    });
    fill(el,
      h('div', { class: 'row' }, h('strong', null, `${i + 1}.`), c.t, tag(s.number), drop),
      deps.length ? h('small', { class: 'muted', title: 'Filed with a “Depends on #N” line, so auto-assign waits for it' }, `⛓ Depends on ${deps.join(', ')}`) : null,
      c.area,
    );
    return { s, c, el };
  });
  return {
    el: h('div', null,
      h('p', { class: 'muted' }, `Everything is filed in ${b.repo}. Nothing goes to GitHub until you press File all.`),
      h('div', { class: 'breakdown-card epic' }, h('div', { class: 'row' }, h('strong', null, 'Epic'), epic.t, tag(b.epic.number)), epic.area),
      h('h4', null, `Sub-issues (${b.subIssues.length})`),
      ...subs.map((x) => x.el),
    ),
    edits: () => ({
      epic: { title: epic.t.value, body: epic.area.value },
      subIssues: subs.filter((x) => !dropped.has(x.s.key)).map((x) => ({ key: x.s.key, title: x.c.t.value, body: x.c.area.value })),
    }),
  };
}

function callForm(ui: Ui, projectId?: string): { el: HTMLElement; goals: HTMLElement } {
  const goals = h('div', { class: 'parked-goals' });
  const projects = state.projects.filter((p) => p.repos.length);
  if (!projects.length) return { el: h('div', { class: 'empty' }, 'Connect a repository to a project first: the officer reads its code during the briefing.'), goals };
  const project = h('select', null, ...projects.map((p) => h('option', { value: p.id, selected: p.id === projectId }, p.name)));
  const officer = h('p', { class: 'muted' });
  const showOfficer = () =>
    (officer.textContent = `${plannerFor(project.value).name}, ${state.project(project.value)?.name}'s operations officer, will join you, with ${qaOfficerFor(project.value).name} from QA sitting in.`);
  project.addEventListener('change', showOfficer);
  showOfficer();
  const idea = h('textarea', { placeholder: 'Where do you want to get to? e.g. shoppers find what they saved, on any device', autofocus: true });
  const goal = h('button', { class: 'btn primary', title: 'No plan up front: agree where you’re going, then take one small step at a time' }, '🧭 Set a goal');
  goal.onclick = () => void busy(goal, () => api.callBriefing(project.value, idea.value), ui.error);
  const planned = h('button', { class: 'btn small', title: 'Agree scope and acceptance criteria up front (engineering can lay out options), then wrap up as one issue or an epic with sub-issues' }, '📋 Plan it up front instead');
  planned.onclick = () => void busy(planned, () => api.callBriefing(project.value, idea.value, false), ui.error);
  return {
    el: h('div', { class: 'briefing-call' },
      goals,
      h('p', null, 'For anything bigger or fuzzier than a one-line issue. Agree where you’re going and what’s unknown, with no plan: the officer reads the code and asks a few questions, then proposes one small step at a time, the one that tests the riskiest unknown. Once you file it, the goal is parked while the crew builds it; reconvene to hear what it taught you and pick the next. QA sits in, and tests every step.'),
      h('div', { class: 'field' }, h('label', null, 'Project'), project),
      officer,
      h('div', { class: 'field' }, h('label', null, 'Goal'), withMic(ui, idea)),
      h('div', { class: 'row' }, goal, h('span', { class: 'grow' }), planned),
    ),
    goals,
  };
}

/** How a step stands, in a few words: its PR, and QA's verdict on it. */
const stepStatus = (s: GoalStep) => [STEP_STATE_LABELS[stepState(s)], s.qa && `QA ${s.qa.verdict === 'pass' ? 'passed' : 'failed'}`].filter(Boolean).join(' · ');
const issueLink = (s: { url: string; repo: string; number: number }, from?: string) => h('a', { href: s.url, target: '_blank', rel: 'noopener' }, issueRef(s, from));

/** The goals parked out of the lounge, each with its latest step and a button to reconvene it. */
function parkedGoals(ui: Ui): HTMLElement[] {
  if (!state.goals.length) return [];
  return [
    h('h3', null, '🧭 Goals underway'),
    ...state.goals.map((g) => {
      const officer = plannerFor(g.projectId).name;
      const steps = g.goal?.steps ?? [];
      const latest = steps.at(-1);
      const landed = latest && (latest.outcome === 'merged' || latest.outcome === 'closed');
      const reconvene = h('button', { class: `btn small${landed ? ' primary' : ''}`, title: `${officer} catches up on the latest step and says what it taught you` }, '📣 Reconvene');
      reconvene.onclick = () => void busy(reconvene, () => api.reconveneGoal(g.id), ui.error);
      const drop = h('button', { class: 'btn small' }, '✕ Drop');
      drop.onclick = () => {
        if (confirm(`Drop the goal? ${officer} forgets it. Its issues stay on GitHub.`)) void api.dropGoal(g.id).catch((e: Error) => ui.error(e.message));
      };
      return h('div', { class: 'breakdown-card goal' },
        h('div', { class: 'row' }, h('strong', null, g.brief.summary || g.idea), h('small', { class: 'muted' }, state.project(g.projectId)?.name ?? ''), h('span', { class: 'grow' }), reconvene, drop),
        latest
          ? h('small', null, `Step ${steps.length}: `, issueLink(latest), ` ${latest.title} · ${stepStatus(latest)}`)
          : h('small', { class: 'muted' }, 'Parked before the first step'),
      );
    }),
  ];
}

interface StepEditor {
  el: HTMLElement;
  /** Whether it can be filed now: only while it's your turn. */
  enable(yes: boolean): void;
}

/** The step the officer proposed, editable, with a button to file it. */
function stepEditor(ui: Ui, step: StepProposal): StepEditor {
  const title = h('input', { value: step.title });
  const area = h('textarea', { value: step.body });
  const file = h('button', { class: 'btn primary', title: 'Files it on GitHub, linked to the goal, then parks the goal while the crew builds it' }, '📌 File this step');
  file.onclick = () => void busy(file, () => api.briefingFileStep({ title: title.value, body: area.value }), ui.error);
  return {
    el: h('div', { class: 'breakdown-card step' }, h('div', { class: 'row' }, h('strong', null, 'Step'), title, h('small', { class: 'muted' }, step.repo), file), area),
    enable: (yes) => {
      for (const el of [title, area, file]) el.disabled = !yes;
    },
  };
}

/** A goal's side of the wall screen: where you're going, what's unknown, and the steps so far. */
function goalView(b: Briefing): HTMLElement {
  const { brief, goal } = b;
  const steps = goal?.steps ?? [];
  return h('div', null,
    h('h3', null, brief.summary || b.idea),
    goal?.epic ? h('p', null, '🧭 ', issueLink(goal.epic)) : null,
    section('Why', brief.why ? [brief.why] : [], 'why'),
    section('Who for', brief.who ? [brief.who] : [], 'who'),
    section('Done when', brief.acceptance, 'acceptance'),
    section('Unknowns', brief.openQuestions, 'open'),
    h('div', { class: 'brief-section steps' },
      h('h4', null, 'Steps'),
      steps.length
        ? h('ol', null, ...steps.map((s) => h('li', null, issueLink(s, goal?.epic?.repo), ` ${s.title} `, h('small', { class: 'muted' }, stepStatus(s)))))
        : h('p', { class: 'muted' }, 'None yet. The first tests the riskiest unknown.'),
    ),
  );
}

const bullets = (label: string, items: string[]) => (items.length ? h('div', null, h('em', null, label), h('ul', null, ...items.map((i) => h('li', null, i)))) : null);
const sameOption = (a: EngineeringOption | undefined, b: EngineeringOption) => JSON.stringify(a) === JSON.stringify(b);

/** The engineer's options, recommended one starred, each with a button to pick it as the approach. */
function optionsView(ui: Ui, briefing: Briefing, yourTurn: boolean): HTMLElement | null {
  const report = briefing.engineering;
  if (!report) return null;
  return h('div', { class: 'brief-section options' },
    h('h4', null, `🔧 ${chiefEngineer().name}’s options`),
    ...report.options.map((o, i) => {
      const picked = sameOption(briefing.brief.approach, o);
      const pick = h('button', { class: `btn small${picked ? '' : ' primary'}` }, picked ? '✓ Picked' : 'Pick this one');
      pick.disabled = !yourTurn || picked;
      pick.onclick = () => void busy(pick, () => api.briefingPickApproach(i), ui.error);
      return h('div', { class: `brief-option${i === report.recommended ? ' recommended' : ''}${picked ? ' picked' : ''}` },
        h('div', { class: 'row' }, h('strong', null, `${optionLabel(i)}: ${o.title}`), h('span', { class: 'grow' }), h('small', { class: 'size' }, o.size)),
        i === report.recommended ? h('small', { class: 'star' }, '★ Recommended') : null,
        h('p', null, o.approach),
        bullets('Touches', o.touches),
        bullets('Trade-offs', o.tradeoffs),
        bullets('Risks', o.risks),
        pick,
      );
    }),
    h('p', { class: 'why' }, `★ ${optionLabel(report.recommended)}, because ${report.why.replace(/^./, (c) => c.toLowerCase())}`),
  );
}

const section = (label: string, entries: string[], cls = '') =>
  h('div', { class: `brief-section ${cls}` },
    h('h4', null, label),
    entries.length ? h('ul', null, ...entries.map((e) => h('li', null, e))) : h('p', { class: 'muted' }, '—'),
  );

function briefView(brief: Brief, idea: string): HTMLElement {
  return h('div', null,
    h('h3', null, brief.summary || idea),
    section('Why', brief.why ? [brief.why] : [], 'why'),
    section('Who for', brief.who ? [brief.who] : [], 'who'),
    brief.approach ? section('Approach', [`${brief.approach.title} (${brief.approach.size})`, brief.approach.approach], 'approach') : null,
    section('Scope', brief.scope, 'scope'),
    section('Out of scope', brief.outOfScope, 'out'),
    section('Acceptance criteria', brief.acceptance, 'acceptance'),
    section('Open questions', brief.openQuestions, 'open'),
    brief.diagrams.length ? h('div', { class: 'brief-section diagrams' }, h('h4', null, 'Diagrams'), ...brief.diagrams.map(diagramView)) : null,
  );
}
