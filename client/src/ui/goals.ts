import { type Agent, type ClaudeTask, EFFORT_LEVELS, type Effort, type GoalNote } from '../../../shared/types';
import type { contextLevel } from '../../../shared/agentStatus';
import { LCARS } from '../world/starship';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { confirmDialog } from './confirmDialog';
import { busy, h } from './dom';
import { messageAgent } from './resume';

// What the goals panel, a lead's panel and the hand-off buttons (the Ops station, a plugin's crew) share.

/** What each effort level means for a lead, from Anthropic's guidance for the current models. */
export const EFFORT_HINT: Record<Effort, string> = {
  low: 'Quick and cheap, but more likely to stop and check in partway through a slice.',
  medium: 'Quicker and cheaper than high, but more likely to stop and check in partway through a slice.',
  high: 'Right for most slices.',
  xhigh: 'For hard slices: takes longer and costs more, and may run its own review rounds.',
  max: 'For the hardest slices: takes longest and costs most, and may run its own review rounds.',
};

/** How full an agent's context reads: sky while it's fine, gold as it fills, red when it's nearly full. */
export const CONTEXT_TONE: Record<ReturnType<typeof contextLevel>, string> = { ok: LCARS.sky, filling: LCARS.gold, full: LCARS.red };

/** Picks a lead's effort: every level, starting at `value`, with what the picked one means beside it. */
export function leadEffortPicker(value: Effort = 'high'): { el: HTMLElement; select: HTMLSelectElement; picked: () => Effort } {
  const select = h('select', { class: 'effort', title: 'How hard the lead thinks' },
    ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === value }, `${e} effort`)),
  );
  const picked = () => EFFORT_LEVELS.find((e) => e === select.value) ?? value;
  const hint = h('small', { class: 'muted' }, EFFORT_HINT[picked()]);
  select.addEventListener('change', () => (hint.textContent = EFFORT_HINT[picked()]));
  return { el: h('span', { class: 'row' }, select, hint), select, picked };
}

/**
 * Whether the lead shapes the goal with the captain before building it (`LeadWork.shaping`): they work out what to build
 * in rounds, showing something real each time and keeping ./spec.md. Off by default, for goals that need it.
 */
export function shapingToggle(on = false): { el: HTMLElement; picked: () => boolean } {
  const box = h('input', { type: 'checkbox', checked: on });
  const el = h('label', { class: 'row', title: 'The lead works out what to build with you in rounds, showing you something real each time, before building it' },
    box, h('span', null, 'Shape it with me first'));
  return { el, picked: () => box.checked };
}

/** The goal's note as its lead's brief has it: what done looks like, what we learned, what's next. */
export function noteView(note: GoalNote | undefined, compact = false): HTMLElement | null {
  if (!note || (!note.done && !note.learned.length && !note.next.length)) return null;
  const list = (items: string[]) => h('ul', { class: 'goal-list' }, ...items.map((t) => h('li', null, t)));
  return h('div', { class: 'goal-note' },
    note.done ? h('div', null, h('h4', null, 'Done looks like'), note.done) : null,
    !compact && note.learned.length ? h('div', null, h('h4', null, 'Learned'), list(note.learned)) : null,
    !compact && note.next.length ? h('div', null, h('h4', null, 'Next'), list(note.next)) : null,
  );
}

/** The task list an agent keeps for itself with Claude Code's task tools: done, what it's doing now, what's left. */
export function tasksView(tasks: ClaudeTask[] | undefined): HTMLElement | null {
  if (!tasks?.length) return null;
  const done = tasks.filter((t) => t.status === 'completed').length;
  return h('div', { class: 'goal-note' },
    h('div', null,
      h('h4', null, "Claude's tasks", h('b', null, `${done}/${tasks.length}`)),
      h('ul', { class: 'goal-list checklist' },
        ...tasks.map((t) =>
          t.status === 'completed'
            ? h('li', { class: 'ticked' }, t.subject)
            : t.status === 'in_progress'
              ? h('li', { class: 'doing' }, t.activeForm || t.subject)
              : h('li', null, t.subject)),
      ),
    ),
  );
}

/** A pull request a goal's lead shipped, as a link that says what became of it. */
export const prLink = (p: { repo: string; number: number; url: string; outcome?: string; branch?: string }) =>
  h('a', { class: `btn small${p.outcome ? '' : ' go'}`, href: p.url, target: '_blank', rel: 'noreferrer', title: p.branch ? `From ${p.branch}` : undefined },
    `${p.repo.split('/')[1]} #${p.number} · ${p.outcome ?? 'open'} ↗`);

/** The goal's own QA reviewer, while they're on one of its pull requests. */
export function reviewing(lead: Agent): HTMLElement | null {
  const reviewer = state.reviewersIn(lead.projectId).find((r) => r.reviewFor === lead.id && !['done', 'error', 'stopped'].includes(r.status));
  return reviewer ? h('small', { class: 'muted', style: 'display:block' }, `${reviewer.name} is reviewing ${reviewer.repo.split('/')[1]} #${reviewer.issue.number}: ${reviewer.activity}`) : null;
}

/** Closes the goal, asking first if that would leave work only on this machine, leave pull requests behind, or ship nothing. */
export async function closeGoal(lead: Agent): Promise<boolean> {
  const title = lead.lead?.title ?? 'this goal';
  const first = await api.closeGoal(lead.id);
  if ('closed' in first) return true;
  const ok = await confirmDialog({ title: 'Close goal', message: `Close “${title}”?\n\n${first.warn.join('\n')}`, confirmLabel: 'Close goal', danger: true });
  if (!ok) return false;
  await api.closeGoal(lead.id, true);
  return true;
}

/** The goal a piece of work goes to: a new one, or one already under way in the room. */
export function goalTarget(projectId: string): { el: HTMLSelectElement; picked: () => Agent | undefined } {
  const leads = state.leadsIn(projectId);
  const el = h('select', { class: 'effort', style: 'max-width:240px', title: 'Start a new goal with it, or hand it to a goal under way' },
    h('option', { value: '' }, 'as a new goal'),
    ...leads.map((a) => h('option', { value: a.id }, `to “${a.lead?.title ?? a.name}”`)),
  );
  return { el, picked: () => (el.value ? state.agents.get(el.value) : undefined) };
}

/** Hands `idea` to a goal: as the user's next words to a goal's lead, or as the first words of a new goal. Opens wherever it went. */
export async function handToGoal(ui: Ui, projectId: string, idea: string, to: Agent | undefined, from: string): Promise<void> {
  if (to) {
    if (await messageAgent(to.id, to.name, idea)) ui.openAgent(to.id);
    return;
  }
  const { agent } = await api.startGoal(projectId, idea, { from });
  ui.openAgent(agent.id);
  goalStarted(ui, agent);
}

/** Tells the user a goal's lead has taken it on, with a button to go to them. */
export function goalStarted(ui: Ui, lead: Agent): void {
  ui.hud.toast('success', `${lead.name} leads “${lead.lead?.title ?? lead.issue.title}”`, { label: 'Go there', run: () => ui.goToAgent(lead.id) });
}

/** A hand-off control: where the work goes, and the button that sends it. */
export function handOffControl(ui: Ui, projectId: string, idea: () => string, from: string, title: string, primary = false): HTMLElement {
  const target = goalTarget(projectId);
  const go = h('button', { class: `btn small${primary ? ' primary' : ''}`, title }, 'To a goal');
  go.onclick = () =>
    void busy(go, async () => {
      if (!idea().trim()) return ui.openGoals(projectId);
      await handToGoal(ui, projectId, idea(), target.picked(), from);
    }, ui.error);
  return state.leadsIn(projectId).length ? h('span', { class: 'row', style: 'gap:4px' }, go, target.el) : go;
}
