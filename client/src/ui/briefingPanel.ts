import { plannerFor, qaOfficerFor } from '../../../shared/crew';
import type { Brief, Breakdown, BreakdownEdits, WrapUpShape } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { withMic } from './dictation';
import { diagramView } from './diagrams';
import { busy, fill, h } from './dom';

let open = false;
/** Whether the briefing panel is showing (so the office doesn't toast what you can already see). */
export const briefingPanelOpen = () => open;

/**
 * The observation lounge's briefing: the conversation with the project's operations officer on the left, the brief
 * they keep on the wall screen on the right. With no briefing in session, a form to call one.
 */
export function openBriefingPanel(ui: Ui, projectId?: string): void {
  const body = h('div', { class: 'briefing' });
  const title = h('h2');
  // the message box outlives re-renders, so a reply arriving doesn't wipe what you're typing
  const input = h('textarea', { class: 'briefing-input', placeholder: 'Your answer… (Enter to send, Shift+Enter for a new line)' });
  const inputBox = withMic(ui, input);
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

  const render = () => {
    const briefing = state.briefing;
    if (!briefing) {
      shownMessages = -1;
      title.textContent = '🖖 Observation lounge';
      fill(body, callForm(ui, projectId));
      return;
    }
    const officer = plannerFor(briefing.projectId);
    const qa = qaOfficerFor(briefing.projectId);
    const names = { manager: 'You', officer: officer.name, qa: `${qa.name} · QA` };
    const project = state.project(briefing.projectId);
    title.textContent = `🖖 Briefing: ${project?.name ?? 'a project'}`;
    const yourTurn = briefing.status === 'waiting' || briefing.status === 'failed';
    input.disabled = !yourTurn;
    send.disabled = !yourTurn;

    const log = h('div', { class: 'briefing-log' },
      ...briefing.messages.map((m) =>
        m.from === 'system'
          ? h('div', { class: 'briefing-note' }, m.text)
          : h('div', { class: `briefing-msg ${m.from}` },
              h('strong', null, names[m.from]),
              ...m.text.split(/\n{2,}/).map((p) => h('p', null, p)),
            ),
      ),
      briefing.status === 'thinking' || briefing.status === 'wrapping-up'
        ? h('div', { class: 'briefing-msg officer typing' }, h('strong', null, officer.name), h('p', null, `✻ ${briefing.activity}`))
        : null,
      briefing.status === 'qa-checking'
        ? h('div', { class: 'briefing-msg qa typing' }, h('strong', null, names.qa), h('p', null, `✻ ${briefing.activity}`))
        : null,
      briefing.status === 'failed' ? h('div', { class: 'briefing-note error' }, `⚠ ${briefing.error ?? 'Something went wrong'}. Say something to carry on.`) : null,
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

    const controls = briefing.status === 'done'
      ? h('div', { class: 'row' },
          filed ? filedLinks(filed) : h('button', { class: 'btn primary', onclick: () => ui.openNewIssue(briefing.projectId) }, '📝 Open the draft'),
          h('span', { class: 'grow' }),
          end,
        )
      : h('div', null,
          inputBox,
          choosing
            ? h('div', { class: 'row' }, h('strong', null, 'Wrap up as'), one, breakDown, cancel)
            : h('div', { class: 'row' }, send, wrap, cost, h('span', { class: 'grow' }), end),
        );

    fill(body,
      h('div', { class: 'briefing-chat' }, log, controls),
      h('aside', { class: 'briefing-brief' }, briefView(briefing.brief, briefing.idea)),
    );
    if (briefing.messages.length !== shownMessages) {
      shownMessages = briefing.messages.length;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    if (yourTurn && document.activeElement !== input) input.focus();
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

function callForm(ui: Ui, projectId?: string): HTMLElement {
  const projects = state.projects.filter((p) => p.repos.length);
  if (!projects.length) return h('div', { class: 'empty' }, 'Connect a repository to a project first: the officer reads its code during the briefing.');
  const project = h('select', null, ...projects.map((p) => h('option', { value: p.id, selected: p.id === projectId }, p.name)));
  const officer = h('p', { class: 'muted' });
  const showOfficer = () =>
    (officer.textContent = `${plannerFor(project.value).name}, ${state.project(project.value)?.name}'s operations officer, will join you, with ${qaOfficerFor(project.value).name} from QA sitting in.`);
  project.addEventListener('change', showOfficer);
  showOfficer();
  const idea = h('textarea', { placeholder: 'What do you want to talk through? e.g. a wishlist that follows shoppers across devices', autofocus: true });
  const go = h('button', { class: 'btn primary' }, '📣 Call the briefing');
  go.onclick = () => void busy(go, () => api.callBriefing(project.value, idea.value), ui.error);
  return h('div', { class: 'briefing-call' },
    h('p', null, 'For anything bigger or fuzzier than a one-line issue. The officer reads the code, asks you questions one at a time and keeps a brief on the wall screen. QA chips in when the acceptance criteria change, so they can be tested. When you wrap up, they write one issue to the project’s stand, or break it down into an epic and sub-issues for you to check and file.'),
    h('div', { class: 'field' }, h('label', null, 'Project'), project),
    officer,
    h('div', { class: 'field' }, h('label', null, 'Topic'), withMic(ui, idea)),
    go,
  );
}

function briefView(brief: Brief, idea: string): HTMLElement {
  const section = (label: string, entries: string[], cls = '') =>
    h('div', { class: `brief-section ${cls}` },
      h('h4', null, label),
      entries.length ? h('ul', null, ...entries.map((e) => h('li', null, e))) : h('p', { class: 'muted' }, '—'),
    );
  return h('div', null,
    h('h3', null, brief.summary || idea),
    section('Why', brief.why ? [brief.why] : [], 'why'),
    section('Who for', brief.who ? [brief.who] : [], 'who'),
    section('Scope', brief.scope, 'scope'),
    section('Out of scope', brief.outOfScope, 'out'),
    section('Acceptance criteria', brief.acceptance, 'acceptance'),
    section('Open questions', brief.openQuestions, 'open'),
    brief.diagrams.length ? h('div', { class: 'brief-section diagrams' }, h('h4', null, 'Diagrams'), ...brief.diagrams.map(diagramView)) : null,
  );
}
