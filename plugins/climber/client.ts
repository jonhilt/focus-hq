import { callPlugin, type ClientPlugin, h, focus, pluginState, Switch, timeAgo, type Ui } from '../../plugin-api/client';
import { climbCard, type ClimbCard } from './card';
import { CLIMBER, climbingEngineer, type Climb } from './shared';
import './climber.css';

/**
 * Main engineering's climber on the engineering panel (README.md): the climbing engineer, the captain's Keep
 * climbing switch, the climb under way (what they're doing, its pull request) and how the last one ended (`climbCard`).
 */
function climberView(ui: Ui): HTMLElement {
  // the plugin's own state, as its server part saves it
  const climb = pluginState<Climb>(CLIMBER);
  const engineer = climbingEngineer().name;
  const card = climbCard(climb, (id) => focus.agent(id), engineer, timeAgo);
  const keep = new Switch('Keep climbing', card.keepClimbing, {
    title: 'One climb at a time on Focus’s own repo: each opens a pull request that waits for you to merge it',
    changed: (on) => void callPlugin<Climb>(CLIMBER, '/keep-climbing', { on }).catch((err: Error) => {
      keep.on = !on;
      ui.error(err.message);
    }),
  });
  return h('div', { class: 'card climber' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Climber', h('span', { class: 'muted' }, ` · ${engineer}`)), keep.el),
    card.stoppedWhy ? h('small', null, h('span', { class: 'chip warn' }, 'stopped'), ' ', card.stoppedWhy) : null,
    card.now ? climbNow(ui, card.now, card.pr) : null,
    muted(card.last),
    muted(card.intro),
  );
}

const muted = (text: string | null) => (text ? h('small', { class: 'muted' }, text) : null);

/** The climber at work, with their pull request and terminal; or the pull request left waiting on the captain. */
function climbNow(ui: Ui, now: NonNullable<ClimbCard['now']>, pr: ClimbCard['pr']): HTMLElement {
  const link = pr ? h('a', { class: 'btn small go', href: pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${pr.number} ↗`) : null;
  return now.kind === 'climbing'
    ? h('div', { class: 'row' }, h('span', { class: 'grow' }, h('strong', null, now.name), ` · ${now.activity}`), link, h('button', { class: 'btn small', onclick: () => ui.openAgent(now.id) }, 'Terminal'))
    : h('div', { class: 'row' }, h('span', { class: 'grow' }, now.line), link);
}

const climber: ClientPlugin = {
  id: CLIMBER,
  about: {
    name: 'Climber',
    summary: 'Main engineering’s climbing engineer moves Focus’s own repo up its scorecard, one pull request at a time.',
    adds: [
      'The climber’s card on the engineering panel, with Keep climbing',
      'Pull requests on Focus’s own repo, each waiting for you to merge',
      'Needs the scorecard plugin',
    ],
    cost: 'background',
    costDetail: 'While Keep climbing is on, it runs a full agent session for each climb, one after another: the most tokens of any plugin. Off, it spends nothing.',
  },
  engineering: { card: climberView },
};

export default climber;
