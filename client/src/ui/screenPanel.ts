import { ARTIFACT_SIZE, answeredReadout, artifactUrl, latestArtifact, optionUrl, unanswered } from '../../../shared/artifacts';
import type { GoalArtifact, GoalQuestion, GoalRecord } from '../../../shared/types';
import { state } from '../net/state';
import { type ScreenPart, screenParts } from '../plugins';
import { LCARS } from '../world/starship';
import { sound } from '../sound';
import type { Ui } from './context';
import { h } from './dom';
import { SideNav } from './panels';
import { answerLead } from './resume';

/** A question's view's key: `?q1`, which no artifact id can be. */
const asked = (q: GoalQuestion) => `?${q.id}`;

/** One option at a time, or all side by side: the last way you looked, for the next question too. */
let sideBySide = false;

const when = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A station's screen up close. While the lead has shown or asked something (`leadId`'s artifacts and questions), it's
 * each of those, live, one view apiece down the sidebar: the question waiting on your answer first, then what they've
 * shown, then the questions you've answered. With nothing shown or asked, there's nothing to open.
 */
export function openScreenPanel(ui: Ui, leadId?: string): void {
  const work = () => (leadId ? state.agents.get(leadId)?.lead : undefined);
  if (!leadId || (!work()?.artifacts?.length && !work()?.questions?.length)) return;
  openShown(ui, 'On the screen', { leadId, artifacts: () => work()?.artifacts ?? [], questions: () => work()?.questions ?? [], live: true });
}

/** What a closed goal's lead showed and asked, as they left it: to look back at, but not to answer any more. */
export function openClosedGoalShown(ui: Ui, goal: GoalRecord): void {
  openShown(ui, `Shown in “${goal.title}”`, { leadId: goal.id, artifacts: () => goal.artifacts ?? [], questions: () => goal.questions ?? [], live: false });
}

/**
 * What a lead showed and asked (`live`: their goal's still open, so their open question can be answered and new ones
 * turn up), one view apiece down the sidebar.
 */
function openShown(ui: Ui, title: string, shownBy: { leadId: string; artifacts: () => GoalArtifact[]; questions: () => GoalQuestion[]; live: boolean }): void {
  const { leadId, artifacts, questions, live } = shownBy;

  const body = h('div', { class: 'shown-body' });
  // each page at the size it was laid out for, scaled to fit its box: up close, it looks as it does on the screen
  const fit = (stage: Element) => {
    const frame = stage.querySelector('iframe');
    if (!frame) return;
    const scale = Math.min(stage.clientWidth / ARTIFACT_SIZE.w, stage.clientHeight / ARTIFACT_SIZE.h);
    frame.style.transform = `translateX(${(stage.clientWidth - ARTIFACT_SIZE.w * scale) / 2}px) scale(${scale})`;
  };
  const resized = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
  // its own origin (no allow-same-origin): its scripts run, but can't reach Focus
  const stage = (url: string, title: string, cls = '') => {
    const el = h('div', { class: `artifact-stage${cls}` },
      h('iframe', { src: url, title, style: `width:${ARTIFACT_SIZE.w}px;height:${ARTIFACT_SIZE.h}px`, attrs: { sandbox: 'allow-scripts allow-popups' } }));
    // on hover, a button to fill the screen with it (Esc comes back); the fit follows it there, since its box resizes
    el.append(h('button', { class: 'stage-full', title: 'Fill the screen with it (Esc to come back)', onclick: () => toggleFull(el) }, 'Full screen'));
    resized.observe(el);
    return el;
  };
  const toggleFull = (el: HTMLElement) => {
    sound.press();
    if (document.fullscreenElement) void document.exitFullscreen();
    else el.requestFullscreen().catch((e: Error) => ui.error(e.message));
  };
  const open = () => (live ? unanswered(questions()) : undefined);
  let picked = open() ? asked(open()!) : latestArtifact(artifacts())?.id ?? '';
  // what's on show, so a new version (or your answer) redraws it and anything else leaves it be
  let shown = '';
  const nav = new SideNav<string>((key) => {
    sound.press();
    picked = key;
    render();
  });

  // which option of a question you're looking at, and whether you've asked to see them all side by side
  const looking = new Map<string, number>();
  let step: ((by: number) => void) | undefined;
  // the plugins' parts round the page on show (the briefings plugin's voice-over and asking about it), and the page
  // they're for, so a new version of it hands them over to carry on with what should outlast it
  let parts = new Map<string, ScreenPart>();
  let partsOf = '';
  const endParts = () => {
    for (const part of parts.values()) part.end();
    parts = new Map();
  };

  /**
   * A question up close: why the lead asks, then one option at a time, large, with what it trades off and its Pick
   * button beside it. ← and → (or the lettered tabs) step through them; Side by side shows them all at once. Every
   * option's page stays loaded, so stepping is instant and each keeps where you'd scrolled to.
   */
  const questionView = (q: GoalQuestion): HTMLElement[] => {
    const lead = state.agents.get(leadId);
    const note = h('input', { class: 'grow', type: 'text', placeholder: `Anything to add for ${lead?.name ?? 'the lead'}? (optional)` });
    const pick = (option: string) => {
      sound.press();
      void answerLead(leadId, q.id, option, note.value).catch((e: Error) => ui.error(e.message));
    };
    const answer = q.answer;
    const tabs = q.options.map((o, i) => h('button', { class: 'btn small option-tab', title: o.label, onclick: () => show(i, 'one') }, o.id.toUpperCase()));
    const side = h('button', { class: 'btn small switch', title: 'See every option at once, or one at a time' }, 'Side by side');
    side.onclick = () => show(looking.get(q.id) ?? 0, sideBySide ? 'one' : 'all');
    const cards = q.options.map((o) => {
      const chosen = answer?.option === o.id;
      return h('div', { class: `question-option${chosen ? ' picked' : ''}${answer && !chosen ? ' passed' : ''}` },
        stage(optionUrl(leadId, q, o.id, 'html'), o.label, ' option'),
        h('div', { class: 'option-side' },
          h('b', null, `${o.id.toUpperCase()} · ${o.label}`),
          o.detail ? h('p', null, o.detail) : null,
          answer ? (chosen ? h('span', { class: 'chip' }, 'Picked') : null) : live ? h('button', { class: 'btn primary', onclick: () => pick(o.id) }, `Pick ${o.id.toUpperCase()}`) : null,
        ),
      );
    });
    const grid = h('div', { class: 'question-options' }, ...cards);
    const show = (i: number, mode: 'one' | 'all') => {
      const n = q.options.length;
      const at = ((i % n) + n) % n;
      looking.set(q.id, at);
      sideBySide = mode === 'all';
      grid.className = `question-options ${sideBySide ? `all n${n}` : 'one'}`;
      cards.forEach((c, j) => c.classList.toggle('current', j === at));
      tabs.forEach((t, j) => t.classList.toggle('on', !sideBySide && j === at));
      side.classList.toggle('on', sideBySide);
      if (mode === 'one') sound.press();
    };
    step = (by) => show((looking.get(q.id) ?? 0) + by, 'one');
    show(looking.get(q.id) ?? Math.max(0, q.options.findIndex((o) => o.id === answer?.option)), sideBySide ? 'all' : 'one');
    return [
      h('div', { class: 'row artifact-head' },
        h('h3', { class: 'grow' }, q.question),
        h('small', { class: 'muted' }, answer ? `${answer.option ? `You picked ${answer.option.toUpperCase()}` : 'You answered in chat'} at ${when(answer.at)}` : live ? `Asked ${when(q.at)}` : 'Not answered before the goal closed'),
      ),
      q.context ? h('p', { class: 'question-context' }, q.context) : h('span'),
      answer?.note ? h('p', { class: 'muted' }, `${answer.option ? 'You added' : 'You said'}: ${answer.note}`) : h('span'),
      h('div', { class: 'row question-steps' },
        h('button', { class: 'btn small', title: 'The option before (←)', onclick: () => step?.(-1) }, '◀'),
        ...tabs,
        h('button', { class: 'btn small', title: 'The next option (→)', onclick: () => step?.(1) }, '▶'),
        h('small', { class: 'muted grow' }, '← → to step through them'),
        side,
      ),
      grid,
      answer || !live ? h('span') : h('div', { class: 'row question-note' }, note, h('small', { class: 'muted' }, `Your pick goes to ${lead?.name ?? 'the lead'} as a message from you.`)),
    ];
  };

  const render = () => {
    const list = artifacts();
    const qs = questions();
    const waiting = open();
    // answered, or (once the goal's closed) never answered
    const answered = qs.filter((q) => q.answer || !live).reverse();
    const keys = [...(waiting ? [asked(waiting)] : []), ...list.map((a) => a.id), ...answered.map(asked)];
    if (!keys.includes(picked)) picked = keys[0] ?? '';
    const onScreen = waiting ? asked(waiting) : latestArtifact(list)?.id;
    nav.show([
      ...(waiting ? [{ key: asked(waiting), label: waiting.question, readout: 'ASKS YOU' }] : []),
      ...list.map((a) => ({ key: a.id, label: a.title, readout: live && a.id === onScreen ? 'SCREEN' : undefined })),
      ...answered.map((q) => ({ key: asked(q), label: q.question, readout: answeredReadout(q) })),
    ], picked);
    const question = qs.find((q) => asked(q) === picked);
    const artifact = list.find((a) => a.id === picked);
    const key = question ? `${asked(question)}@${question.at}:${question.answer?.at ?? ''}` : artifact ? artifactUrl(leadId, artifact, 'html') : '';
    if (key === shown) return;
    shown = key;
    resized.disconnect();
    step = undefined;
    // a new version of the page on show hands its parts over; anything else ends them
    const replacing = artifact !== undefined && artifact.id === partsOf;
    const before = replacing ? parts : undefined;
    if (!replacing) endParts();
    parts = new Map();
    partsOf = artifact?.id ?? '';
    if (question) {
      body.replaceChildren(...questionView(question));
    } else if (artifact) {
      const url = artifactUrl(leadId, artifact, 'html');
      const shownHere = stage(url, artifact.title);
      parts = screenParts({ ui, leadId, artifact, frame: shownHere.querySelector('iframe')!, live }, before);
      body.replaceChildren(
        h('div', { class: 'row artifact-head' },
          h('h3', { class: 'grow' }, artifact.title),
          ...[...parts.values()].flatMap((p) => p.head ?? []),
          h('small', { class: 'muted' }, `Shown ${when(artifact.at)}`),
          h('button', { class: 'btn small', title: 'Fill the screen with it (Esc to come back)', onclick: () => toggleFull(shownHere) }, 'Full screen'),
          h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open in a tab'),
        ),
        shownHere,
        ...[...parts.values()].flatMap((p) => p.foot ?? []),
      );
    } else {
      body.replaceChildren();
    }
    body.querySelectorAll('.artifact-stage').forEach(fit);
  };
  render();
  ui.panels.open({ title, body, accent: LCARS.orange, wide: true, full: true, nav });
  // the page loads after this, so its first word to the plugins' parts still arrives
  const heard = (e: MessageEvent) => {
    for (const part of parts.values()) part.heard?.(e);
  };
  window.addEventListener('message', heard);
  ui.panels.own(() => {
    window.removeEventListener('message', heard);
    endParts();
  });
  if (live) {
    ui.panels.own(state.on('agent', (agent) => {
      if (agent.id === leadId) render();
    }));
  }
  // the button on a page filling the screen takes you back
  const fullChanged = () => body.querySelectorAll('.stage-full').forEach((b) => {
    b.textContent = b.parentElement === document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });
  document.addEventListener('fullscreenchange', fullChanged);
  ui.panels.own(() => {
    resized.disconnect();
    document.removeEventListener('fullscreenchange', fullChanged);
    if (document.fullscreenElement) void document.exitFullscreen();
  });
  // ← and → step through a question's options, unless you're typing
  const keys = (e: KeyboardEvent) => {
    if (!step || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    step(e.key === 'ArrowLeft' ? -1 : 1);
  };
  window.addEventListener('keydown', keys);
  ui.panels.own(() => window.removeEventListener('keydown', keys));
}
