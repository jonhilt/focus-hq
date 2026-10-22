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
  return h('div', { class: 'card climber' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Climber', h('span', { class: 'muted' }, ` · ${engineer}`)), keepClimbing(ui, card.keepClimbing)),
    card.stoppedWhy ? h('small', null, h('span', { class: 'chip warn' }, 'stopped'), ' ', card.stoppedWhy) : null,
    card.now ? climbNow(ui, card.now, card.pr) : null,
    muted(card.last),
    muted(card.intro),
  );
}

/** The captain's Keep climbing switch: while it's on, the climber climbs, one pull request at a time. */
function keepClimbing(ui: Ui, on: boolean): HTMLElement {
  const keep = new Switch('Keep climbing', on, {
    title: 'One climb at a time on Focus’s own repo: each opens a pull request that waits for you to merge it',
    changed: (now) => void callPlugin<Climb>(CLIMBER, '/keep-climbing', { on: now }).catch((err: Error) => {
      keep.on = !now;
      ui.error(err.message);
    }),
  });
  return keep.el;
}

/** Keep climbing in the Plugins tab, with what it spends. */
function climberSettings(ui: Ui): HTMLElement[] {
  const card = climbCard(pluginState<Climb>(CLIMBER), (id) => focus.agent(id), climbingEngineer().name, timeAgo);
  return [
    h('div', { class: 'row' }, keepClimbing(ui, card.keepClimbing)),
    h('small', { class: 'muted' }, 'Each climb is a full agent session. Switch it off to stop spending: the climb under way finishes first.'),
  ];
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
      'The climber’s card on the engineering panel, and Keep climbing, there and here',
      'Pull requests on Focus’s own repo, each waiting for you to merge',
    ],
    cost: 'background',
    costDetail: 'While Keep climbing is on, it runs a full agent session for each climb, one after another: the most tokens of any plugin. Off, it spends nothing.',
  },
  engineering: { card: climberView },
  settings: climberSettings,
};

export default climber;
