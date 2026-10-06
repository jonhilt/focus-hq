import { type Agent, EFFORT_LEVELS, type Effort, type GoalNote } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { busy, h } from './dom';

// What the goals panel, a lead's panel and the hand-off buttons (the New issue stand, Number One) share.

/** What each effort level means for a lead, from Anthropic's guidance for the current models. */
export const EFFORT_HINT: Record<Effort, string> = {
  low: 'Quick and cheap, but more likely to stop and check in partway through a slice.',
  medium: 'Quicker and cheaper than high, but more likely to stop and check in partway through a slice.',
  high: 'Right for most slices.',
  xhigh: 'For hard slices: takes longer and costs more, and may run its own review rounds.',
  max: 'For the hardest slices: takes longest and costs most, and may run its own review rounds.',
};

/** Picks a lead's effort: every level, starting at `value`, with what the picked one means beside it. */
export function leadEffortPicker(value: Effort = 'high'): { el: HTMLElement; select: HTMLSelectElement; picked: () => Effort } {
  const select = h('select', { class: 'effort', title: 'How hard the lead thinks' },
    ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === value }, `🧠 ${e}`)),
  );
  const picked = () => EFFORT_LEVELS.find((e) => e === select.value) ?? value;
  const hint = h('small', { class: 'muted' }, EFFORT_HINT[picked()]);
  select.addEventListener('change', () => (hint.textContent = EFFORT_HINT[picked()]));
  return { el: h('span', { class: 'row' }, select, hint), select, picked };
}

/** The goal's note as its lead keeps it: what done looks like, this slice's checklist, what we learned, what's next. */
export function noteView(note: GoalNote | undefined, compact = false): HTMLElement | null {
  if (!note || (!note.done && !note.slice.length && !note.learned.length && !note.next.length)) return null;
  const list = (items: string[]) => h('ul', { class: 'goal-list' }, ...items.map((t) => h('li', null, t)));
  const ticked = note.slice.filter((i) => i.done).length;
  return h('div', { class: 'goal-note' },
    note.done ? h('div', null, h('strong', null, 'Done looks like: '), note.done) : null,
    note.slice.length
      ? h('div', null,
        h('strong', null, `This slice (${ticked}/${note.slice.length}):`),
        h('ul', { class: 'goal-list checklist' }, ...note.slice.map((i) => h('li', { class: i.done ? 'ticked' : '' }, `${i.done ? '☑' : '☐'} ${i.text}`))),
      )
      : null,
    !compact && note.learned.length ? h('div', null, h('strong', null, 'Learned:'), list(note.learned)) : null,
    !compact && note.next.length ? h('div', null, h('strong', null, 'Next:'), list(note.next)) : null,
  );
}

/** Closes the goal, asking first if that would throw work away or leave pull requests behind. */
export async function closeGoal(lead: Agent): Promise<boolean> {
  const title = lead.lead?.title ?? 'this goal';
  const first = await api.closeGoal(lead.id);
  if ('closed' in first) return true;
  if (!confirm(`Close “${title}”?\n\n${first.warn.join('\n')}`)) return false;
  await api.closeGoal(lead.id, true);
  return true;
}

/** The goal a piece of work goes to: a new one, or one already under way in the room. */
export function goalTarget(projectId: string): { el: HTMLSelectElement; picked: () => Agent | undefined } {
  const leads = state.leadsIn(projectId);
  const el = h('select', { class: 'effort', style: 'max-width:240px', title: 'Start a new goal with it, or hand it to a goal under way' },
    h('option', { value: '' }, '🧭 as a new goal'),
    ...leads.map((a) => h('option', { value: a.id }, `→ ${a.lead?.title ?? a.name}`)),
  );
  return { el, picked: () => (el.value ? state.agents.get(el.value) : undefined) };
}

/**
 * Hands `idea` to a goal: as the captain's next words to a goal's lead, or as the first words of a new goal (which waits
 * in line if every team station is taken). Opens wherever it went.
 */
export async function handToGoal(ui: Ui, projectId: string, idea: string, to: Agent | undefined, from: string): Promise<void> {
  if (to) {
    await api.message(to.id, idea);
    return ui.openAgent(to.id);
  }
  const started = await api.startGoal(projectId, idea, { from });
  if ('agent' in started) ui.openAgent(started.agent.id);
  else ui.openGoals(projectId);
}

/** A hand-off control: where the work goes, and the button that sends it. */
export function handOffControl(ui: Ui, projectId: string, idea: () => string, from: string, title: string, primary = false): HTMLElement {
  const target = goalTarget(projectId);
  const go = h('button', { class: `btn small${primary ? ' primary' : ''}`, title }, '🧭 To a goal');
  go.onclick = () =>
    void busy(go, async () => {
      if (!idea().trim()) return ui.openGoals(projectId);
      await handToGoal(ui, projectId, idea(), target.picked(), from);
    }, ui.error);
  return state.leadsIn(projectId).length ? h('span', { class: 'row', style: 'gap:4px' }, go, target.el) : go;
}
