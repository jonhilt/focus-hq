import { climbingEngineer } from '../../../shared/crew';
import type { Climb } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { h, timeAgo } from './dom';
import { Switch } from './panels';

const OUTCOME: Record<NonNullable<Climb['last']>['outcome'], string> = {
  merged: 'merged',
  closed: 'closed unmerged',
  nothing: 'found nothing to change',
  failed: 'failed',
};

/**
 * Main engineering's climber on the engineering panel (docs/climber.md): the climbing engineer, the captain's Keep
 * climbing switch, the climb under way (what they're doing, its pull request) and how the last one ended.
 */
export function climberView(ui: Ui): HTMLElement {
  const climb = state.climb;
  const engineer = climbingEngineer().name;
  const climber = climb?.agentId ? state.agents.get(climb.agentId) : undefined;
  const keep = new Switch('Keep climbing', !!climb?.keepClimbing, {
    title: 'One climb at a time on the office’s own repo: each opens a pull request that waits for you to merge it',
    changed: (on) => void api.keepClimbing(on).catch((err: Error) => {
      keep.on = !on;
      ui.error(err.message);
    }),
  });
  const pr = climb?.pr ?? climber?.pr;
  const now = climber
    ? h('div', { class: 'row' },
      h('span', { class: 'grow' }, h('strong', null, climber.name), ` · ${climber.activity}`),
      pr ? h('a', { class: 'btn small go', href: pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${pr.number} ↗`) : null,
      h('button', { class: 'btn small', onclick: () => ui.openAgent(climber.id) }, 'Terminal'))
    : pr
      ? h('div', { class: 'row' }, h('span', { class: 'grow' }, 'The climb’s pull request waits for you to merge or close it'), h('a', { class: 'btn small go', href: pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${pr.number} ↗`))
      : null;
  const last = climb?.last
    ? h('small', { class: 'muted' }, `Last climb${climb.last.pr ? ` (PR #${climb.last.pr})` : ''} ${OUTCOME[climb.last.outcome]} ${timeAgo(climb.last.at)} · ${climb.cycles} so far`)
    : null;
  return h('div', { class: 'card climber' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Climber', h('span', { class: 'muted' }, ` · ${engineer}`)), keep.el),
    climb?.stoppedWhy ? h('small', null, h('span', { class: 'chip warn' }, 'stopped'), ' ', climb.stoppedWhy) : null,
    now,
    last,
    !climber && !pr
      ? h('small', { class: 'muted' }, `With Keep climbing on, ${engineer} takes the scorecard’s worst gap in the office’s own repo, fixes it and opens one pull request with its numbers before and after. It never merges by itself: once you merge or close it, the next climb starts, in a fresh session.`)
      : null,
  );
}
