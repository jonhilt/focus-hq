import './tricorder.css';
import { state } from '../net/state';
import { h } from '../ui/dom';
import { Actions, morph } from './actions';
import { agentView, type View } from './agentView';
import { home, type HomeContext, prCardId, projectKey } from './home';

// The Tricorder: Focus on a phone, at /tricorder. No three.js and nothing from world/, so it stays small.

const app = ((): HTMLElement => {
  const el = document.getElementById('app');
  if (!el) throw new Error('The page has no #app to show the Tricorder in');
  return el;
})();

const agentInHash = () => {
  const m = /^#agent\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};

let pending: ReturnType<typeof setTimeout> | undefined;
/** Agents report progress several times a second; one redraw per burst is plenty. */
const schedule = () => {
  pending ??= setTimeout(() => {
    pending = undefined;
    view.update();
  }, 150);
};

const actions = new Actions(schedule);
const ctx: HomeContext = {
  actions,
  expanded: new Map(),
  highlight: null,
  showPr: (projectId, pr) => {
    ctx.expanded.set(projectKey(projectId), true);
    ctx.highlight = prCardId(projectId, pr);
    view.update();
    document.querySelector(`.card.pr[data-key="${CSS.escape(ctx.highlight)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      ctx.highlight = null;
      schedule();
    }, 2000);
  },
};

const statusBar = () =>
  h('header', { class: 'top' },
    h('span', { class: 'elbow' }, 'Focus'),
    h('span', { class: 'bar-fill' }, 'Tricorder'),
    h('span', { class: `pill link-state ${state.connected ? 'on' : 'off'}` }, state.connected ? '● live' : '○ offline'),
  );

function homeView(): View {
  const el = h('div', { class: 'screen' }, statusBar(), home(ctx));
  return { el, update: () => morph(el, h('div', null, statusBar(), home(ctx))), dispose: () => undefined };
}

let view: View = homeView();
let route = '';
let homeScroll = 0;

/**
 * Shows the screen the URL asks for: an agent's drill-down (#agent/<id>) or the home screen. `tapped`: the hash just
 * changed, rather than a snapshot catching up with a hash the page opened on.
 */
function navigate(tapped = false): void {
  const hashed = agentInHash();
  // before the first snapshot nobody is known yet; the snapshot calls back here
  const id = hashed && state.agents.has(hashed) ? hashed : null;
  const next = id ? `agent:${id}` : 'home';
  if (next === route) return;
  const fromHome = tapped && route === 'home';
  if (fromHome) homeScroll = window.scrollY;
  view.dispose();
  // back the way we came, so Back and the swipe-back gesture agree; a drill-down opened from a link goes home instead
  view = id ? agentView(id, actions, fromHome ? () => history.back() : () => (location.hash = '')) : homeView();
  route = next;
  app.replaceChildren(view.el);
  window.scrollTo(0, next === 'home' ? homeScroll : 0);
}

window.addEventListener('hashchange', () => navigate(true));
state.on('snapshot', () => {
  navigate();
  schedule();
});
state.on('agent-removed', (a) => {
  if (agentInHash() === a.id) location.hash = '';
  schedule();
});
// a plugin's state too: what its strips show (the chief of staff's word on a turn, pressed) can live there
for (const event of ['agent', 'board', 'review', 'projects', 'info', 'browser', 'connection', 'plugin'] as const) state.on(event, schedule);
// what the plugins' sections count down, or wait out, moves on without Ops saying anything
setInterval(schedule, 10_000);

// iOS Safari drops the socket while the page is in the background, sometimes without a close event, so after any real
// time away start a fresh one; its snapshot brings everything up to date.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (!state.connected || Date.now() - hiddenAt > 3000) state.connect();
});
window.addEventListener('pageshow', (e) => e.persisted && state.connect());

navigate();
state.connect();
