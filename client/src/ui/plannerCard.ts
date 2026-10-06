import { plannerFor, UNIFORM } from '../../../shared/crew';
import type { IssueDraft } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { withMic } from './dictation';
import { busy, fill, h } from './dom';

export interface IssueFields {
  repo: HTMLSelectElement;
  title: HTMLInputElement;
  body: HTMLTextAreaElement;
}

export interface PlannerCard {
  el: HTMLElement;
  /** Re-render for the project currently picked in the form. */
  refresh(): void;
  /** Whether the form holds the planner's draft (so filing it clears the draft). */
  usedDraft(): boolean;
}

/**
 * The room's operations officer, at the top of the New issue form: give them a rough idea and they read the code and
 * write the issue up, with acceptance criteria, into the form's fields. Their draft arrives over the websocket, so it
 * waits at the stand if you close the panel and turns up when you come back.
 */
export function plannerCard(ui: Ui, projectId: () => string, fields: IssueFields): PlannerCard {
  const el = h('div', { class: 'card planner' });
  const activity = h('span', { class: 'planner-activity' });
  /** startedAt of the draft last copied into the fields. */
  let applied = 0;
  let renderedKey = '';

  const apply = (draft: IssueDraft) => {
    if (draft.status !== 'ready' || draft.startedAt === applied) return;
    applied = draft.startedAt;
    if (draft.repo && [...fields.repo.options].some((o) => o.value === draft.repo)) fields.repo.value = draft.repo;
    fields.title.value = draft.title ?? '';
    fields.body.value = draft.body ?? '';
    fields.body.style.minHeight = '320px';
  };

  const render = () => {
    const pid = projectId();
    const project = state.project(pid);
    if (!project) return fill(el);
    const planner = plannerFor(pid);
    const draft = state.drafts.get(pid);
    const briefing = state.briefing?.projectId === pid && state.briefing.status !== 'done' ? state.briefing : null;
    const key = `${pid}|${draft?.status ?? 'none'}|${draft?.startedAt ?? 0}|${briefing ? 'briefing' : ''}`;
    activity.textContent = draft?.status === 'drafting' ? `✻ ${draft.activity}` : '';
    if (draft) apply(draft);
    if (key === renderedKey) return; // only the activity line changed: don't wipe what you're typing
    renderedKey = key;

    const header = h('div', { class: 'planner-head' },
      h('span', { class: 'planner-badge', style: `background:${UNIFORM[planner.avatar.division]}` }, '🖖'),
      h('div', { class: 'grow' },
        h('strong', null, planner.name),
        h('small', null, `Operations · drafts issues for ${project.name}`),
      ),
      draft?.costUsd ? h('small', { class: 'muted' }, `$${draft.costUsd.toFixed(2)}`) : null,
    );
    const briefingButton = (idea: () => string, title: string) => {
      const button = h('button', { class: 'btn small', title }, '📣 Call a briefing');
      button.onclick = () => void busy(button, async () => {
        await api.callBriefing(pid, idea());
        ui.goToLounge();
      }, ui.error);
      return button;
    };
    const discard = () =>
      h('button', { class: 'btn small', onclick: () => void api.discardDraft(pid).catch((e: Error) => ui.error(e.message)) }, draft?.status === 'drafting' ? '✕ Stop' : '✕ Discard draft');

    if (!project.repos.length) {
      fill(el, header, h('p', { class: 'muted' }, 'Connect a repository to this project and I can start drafting.'));
      return;
    }

    if (briefing) {
      fill(el, header,
        h('p', null, `I’m in a briefing in the observation lounge about “${briefing.idea}”. Come and join me, or end it there.`),
        h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => ui.goToLounge() }, '🖖 Join the briefing')),
      );
      return;
    }

    if (draft?.status === 'drafting') {
      fill(el, header,
        draft.idea ? h('p', { class: 'planner-idea' }, `“${draft.idea}”`) : null,
        h('div', { class: 'row' }, activity, h('span', { class: 'grow' }), discard()),
      );
      return;
    }

    if (draft?.status === 'ready') {
      const notes = h('textarea', { class: 'planner-input', placeholder: 'e.g. also cover the empty cart, and leave the checkout page alone' });
      const redraft = h('button', { class: 'btn small primary' }, '↻ Redraft');
      redraft.onclick = () => void busy(redraft, () =>
        api.draftIssue(pid, draft.idea, { repo: fields.repo.value, title: fields.title.value, body: fields.body.value, notes: notes.value }), ui.error);
      const suggestion = draft.tooBig
        ? h('div', { class: 'planner-suggest' },
          h('p', null, `This one might be better as a briefing. ${draft.tooBig}`),
          h('div', { class: 'row' }, briefingButton(() => draft.idea, 'Talk it through in the observation lounge; the draft stays here in case you’d rather use it')),
        )
        : null;
      fill(el, header,
        suggestion,
        h('p', null, 'Draft’s in the form below. Edit it and pin it to the board, or tell me what to change:'),
        withMic(ui, notes),
        h('div', { class: 'row' }, redraft, h('span', { class: 'grow' }), discard()),
      );
      return;
    }

    const idea = h('textarea', { class: 'planner-input', placeholder: 'e.g. let shoppers save items for later from the cart', value: draft?.idea ?? '' });
    const go = h('button', { class: 'btn small primary' }, draft?.status === 'failed' ? '✨ Try again' : '✨ Draft it');
    go.onclick = () => void busy(go, () => api.draftIssue(pid, idea.value), ui.error);
    const brief = briefingButton(() => idea.value, 'Talk it through in the observation lounge first');
    idea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go.click();
    });
    fill(el, header,
      draft?.status === 'failed'
        ? h('p', { class: 'planner-error' }, `I couldn’t finish that draft: ${draft.error ?? 'something went wrong'}`)
        : h('p', null, 'Tell me roughly what you need. I’ll read the code and write it up as an issue with acceptance criteria. Something bigger or fuzzier? Call a briefing and we’ll talk it through in the observation lounge first.'),
      withMic(ui, idea),
      h('div', { class: 'row' }, go, brief, h('small', { class: 'muted' }, 'Ctrl+Enter drafts'), h('span', { class: 'grow' }), draft ? discard() : null),
    );
  };

  ui.panels.own(state.on('draft', (pid) => pid === projectId() && render()));
  ui.panels.own(state.on('briefing', render));
  render();
  return { el, refresh: render, usedDraft: () => applied > 0 && state.drafts.has(projectId()) };
}
