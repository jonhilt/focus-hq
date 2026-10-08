import { ARTIFACT_SIZE, artifactUrl, latestArtifact, openQuestion, optionUrl } from '../../../shared/artifacts';
import type { GoalArtifact, GoalQuestion } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { type PanePrefs, screenPrefs } from '../world/screenPanes';
import { LCARS } from '../world/starship';
import { sound } from '../sound';
import type { Ui } from './context';
import { h } from './dom';
import { SideNav } from './panels';

/** The panes view's key: artifact ids are lowercase letters, digits and dashes, so it can't be one of theirs. */
const PANES = ':panes';
/** A question's view's key: `?q1`, which no artifact id can be either. */
const asked = (q: GoalQuestion) => `?${q.id}`;

const when = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A station's screen up close. While the lead has shown or asked something (`leadId`'s artifacts and questions), it's
 * each of those, live, one view apiece down the sidebar: the question waiting on your answer first, then what they've
 * shown, then the questions you've answered. What the screen shows is the last view; with nothing shown, it's just that.
 */
export function openScreenPanel(ui: Ui, leadId?: string): void {
  const work = () => (leadId ? state.agents.get(leadId)?.lead : undefined);
  const artifacts = (): GoalArtifact[] => work()?.artifacts ?? [];
  const questions = (): GoalQuestion[] => work()?.questions ?? [];
  if (!artifacts().length && !questions().length) {
    ui.panels.open({ title: 'What this screen shows', body: panesView(), accent: LCARS.periwinkle });
    return;
  }

  const body = h('div');
  // each page at the size it was laid out for, scaled to fit its box: up close, it looks as it does on the screen
  const fit = (stage: Element) => {
    const frame = stage.querySelector('iframe');
    if (!frame) return;
    const scale = Math.min(stage.clientWidth / ARTIFACT_SIZE.w, stage.clientHeight / ARTIFACT_SIZE.h);
    frame.style.transform = `translateX(${(stage.clientWidth - ARTIFACT_SIZE.w * scale) / 2}px) scale(${scale})`;
  };
  const resized = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
  // its own origin (no allow-same-origin): its scripts run, but can't reach the office
  const stage = (url: string, title: string, cls = '') => {
    const el = h('div', { class: `artifact-stage${cls}` },
      h('iframe', { src: url, title, style: `width:${ARTIFACT_SIZE.w}px;height:${ARTIFACT_SIZE.h}px`, attrs: { sandbox: 'allow-scripts allow-popups' } }));
    resized.observe(el);
    return el;
  };
  const open = () => openQuestion({ lead: work() });
  let picked = open() ? asked(open()!) : latestArtifact(artifacts())?.id ?? PANES;
  // what's on show, so a new version (or your answer) redraws it and anything else leaves it be
  let shown = '';
  const nav = new SideNav<string>((key) => {
    sound.press();
    picked = key;
    render();
  });

  const questionView = (q: GoalQuestion): HTMLElement[] => {
    const lead = state.agents.get(leadId!);
    const note = h('input', { class: 'grow', type: 'text', placeholder: `Anything to add for ${lead?.name ?? 'the lead'}? (optional)` });
    const pick = (option: string) => {
      sound.press();
      void api.answer(leadId!, q.id, option, note.value).catch((e: Error) => ui.error(e.message));
    };
    const answer = q.answer;
    return [
      h('div', { class: 'row artifact-head' },
        h('h3', { class: 'grow' }, q.question),
        h('small', { class: 'muted' }, answer ? `You picked ${answer.option.toUpperCase()} at ${when(answer.at)}` : `Asked ${when(q.at)}`),
      ),
      answer
        ? (answer.note ? h('p', { class: 'muted' }, `You added: ${answer.note}`) : h('span'))
        : h('div', { class: 'row question-note' }, note, h('small', { class: 'muted' }, `Your pick goes to ${lead?.name ?? 'the lead'} as a message from you.`)),
      h('div', { class: `question-options n${q.options.length}` }, ...q.options.map((o) => {
        const url = optionUrl(leadId!, q, o.id, 'html');
        const chosen = answer?.option === o.id;
        return h('div', { class: `question-option${chosen ? ' picked' : ''}${answer && !chosen ? ' passed' : ''}` },
          h('div', { class: 'row' },
            h('b', { class: 'grow' }, `${o.id.toUpperCase()} · ${o.label}`),
            h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open'),
            answer ? (chosen ? h('span', { class: 'chip' }, 'Picked') : null) : h('button', { class: 'btn small primary', onclick: () => pick(o.id) }, `Pick ${o.id.toUpperCase()}`),
          ),
          stage(url, o.label, ' option'),
        );
      })),
    ];
  };

  const render = () => {
    const list = artifacts();
    const qs = questions();
    const waiting = open();
    const answered = qs.filter((q) => q.answer).reverse();
    const keys = [...(waiting ? [asked(waiting)] : []), ...list.map((a) => a.id), ...answered.map(asked)];
    if (picked !== PANES && !keys.includes(picked)) picked = keys[0] ?? PANES;
    const onScreen = waiting ? asked(waiting) : latestArtifact(list)?.id;
    nav.show([
      ...(waiting ? [{ key: asked(waiting), label: waiting.question, readout: 'ASKS YOU' }] : []),
      ...list.map((a) => ({ key: a.id, label: a.title, readout: a.id === onScreen ? 'SCREEN' : undefined })),
      ...answered.map((q) => ({ key: asked(q), label: q.question, readout: `PICKED ${q.answer!.option.toUpperCase()}` })),
      { key: PANES, label: 'Screen panes' },
    ], picked);
    const question = qs.find((q) => asked(q) === picked);
    const artifact = list.find((a) => a.id === picked);
    const key = question ? `${asked(question)}@${question.at}:${question.answer?.at ?? ''}` : artifact ? artifactUrl(leadId!, artifact, 'html') : PANES;
    if (key === shown) return;
    shown = key;
    resized.disconnect();
    if (question) {
      body.replaceChildren(...questionView(question));
    } else if (artifact) {
      const url = artifactUrl(leadId!, artifact, 'html');
      body.replaceChildren(
        h('div', { class: 'row artifact-head' },
          h('h3', { class: 'grow' }, artifact.title),
          h('small', { class: 'muted' }, `Shown ${when(artifact.at)}`),
          h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open in a tab'),
        ),
        stage(url, artifact.title),
      );
    } else {
      body.replaceChildren(panesView());
    }
    body.querySelectorAll('.artifact-stage').forEach(fit);
  };
  render();
  ui.panels.open({ title: 'On the screen', body, accent: LCARS.orange, wide: true, nav });
  ui.panels.own(state.on('agent', (agent) => {
    if (agent.id === leadId) render();
  }));
  ui.panels.own(() => resized.disconnect());
}

/**
 * What a station's screen shows beside the terminal, chosen at the screen itself: a picture of it, its panes laid out
 * as the screen lays them out, each one a switch. The choice is this viewer's, and every station screen follows it.
 */
function panesView(): HTMLElement {
  const pane = (key: keyof PanePrefs, label: string, what: string) => {
    const reading = h('small');
    const button = h('button', { class: 'screen-pane', title: `Show ${what} on the screen` }, label, reading);
    const paint = () => {
      const on = screenPrefs.current[key];
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      reading.textContent = on ? 'On' : 'Off';
    };
    button.onclick = () => {
      sound.press();
      screenPrefs.set(key, !screenPrefs.current[key]);
      paint();
    };
    paint();
    return button;
  };

  return h('div', null,
    h('p', null, 'Press a pane to show or hide it. The terminal always shows.'),
    h('div', { class: 'screen-map' },
      h('div', { class: 'screen-pane fixed on' }, 'Terminal', h('small', null, 'Always on')),
      h('div', { class: 'screen-stack' },
        pane('artifacts', 'Artifacts', 'what the lead has shown you'),
        pane('browser', 'Browser', 'the page the agent has up'),
      ),
      h('div', { class: 'screen-stack' },
        pane('note', 'Goal', "the lead's goal note"),
        pane('tasks', 'Tasks', "Claude's own task list"),
      ),
    ),
    h('small', { class: 'muted', style: 'display:block' },
      'Just for you, kept in this browser. Every station screen follows it, the laptops at desks too. A pane only shows while it has something in it, what the lead has shown takes the browser’s place, and a laptop fits two at most.'),
  );
}
