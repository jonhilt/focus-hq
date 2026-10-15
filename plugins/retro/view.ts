// The retro on the engineering station (README.md): its card on the overview, and its own view, where the captain
// starts one and decides on its drafts.
import { chiefEngineer } from '../../shared/crew';
import { FIX_SESSIONS, type FixEffect, type FixStatus } from '../../shared/ledger';
import { api } from '../../client/src/net/api';
import { state } from '../../client/src/net/state';
import { type EngineeringGo, pluginState } from '../../client/src/plugins';
import type { Ui } from '../../client/src/ui/context';
import { busy, h, timeAgo } from '../../client/src/ui/dom';
import { frictionBars } from '../../client/src/ui/engineeringPanel';
import { markdownHtml } from '../../client/src/ui/terminal';
import { type FixKind, RETRO, type Retro, type RetroDraft, running, waiting } from './shared';

const KIND: Record<FixKind, string> = { check: 'Check', 'qa-rule': 'QA rule', pointer: 'Pointer', delete: 'Delete' };

/** The latest retro, as the plugin's server part saves it. */
export const latest = (): Retro | undefined => pluginState<Retro>(RETRO);

/** One of the plugin's routes. */
const call = <T>(path: string, body?: unknown) => api.plugin<T>(RETRO, path, body);

// the window outlives re-renders (other plugins' state changes redraw the station), so they don't reset what you typed;
// it starts again from a retro's own window when a new one is saved
let daysInput: { input: HTMLInputElement; seededFrom: number | undefined } | undefined;
function days(): HTMLInputElement {
  const retro = latest();
  if (!daysInput || daysInput.seededFrom !== retro?.startedAt) {
    daysInput = { input: h('input', { type: 'number', min: '1', max: '60', value: String(retro?.days ?? 14), style: 'width:80px' }), seededFrom: retro?.startedAt };
  }
  return daysInput.input;
}

/** The retro beside the overview: whether one's under way or waiting on you, and the frictions it would look at. */
export function retroCard(ui: Ui, go: EngineeringGo): HTMLElement {
  const retro = latest();
  const drafts = waiting(retro);
  const line = running(retro) && retro
    ? retro.activity
    : drafts ? `${drafts} ${drafts === 1 ? 'draft waits' : 'drafts wait'} for you to accept or reject`
      : retro?.status === 'failed' ? `The last retro failed: ${retro.error ?? retro.activity}` : 'Drafts an issue for each friction that keeps coming back';
  const bars = frictionBars(ui, 3);
  return h('div', { class: 'card sc-card' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Retro'), h('button', { class: 'btn small', onclick: () => go(RETRO) }, drafts ? 'Review drafts →' : 'Open →')),
    h('small', { class: 'muted' }, line),
    bars ? h('small', { class: 'lbl' }, 'Most widespread open frictions') : null,
    bars,
  );
}

/** The retro's own view: start or stop one, how it stands, its drafts to decide on, and how the accepted fixes did. */
export function retroView(ui: Ui): HTMLElement {
  const eng = chiefEngineer();
  const retro = latest();
  const start = h('button', { class: 'btn primary' }, retro?.status === 'done' ? 'Start a new retro' : 'Start a retro');
  start.disabled = running(retro);
  start.onclick = () =>
    void busy(start, async () => {
      const window = Number(days().value);
      const { unread, costUsd } = await call<{ unread: number; costUsd: number }>('/preview', { days: window });
      const reading = unread
        ? `${eng.name} first reads the ${unread} sessions of the last ${window} days no one has read yet, for their frictions: roughly $${costUsd.toFixed(2)} of Claude usage, a batch at a time with a pause between. Sessions read before aren’t read again.`
        : `Every session of the last ${window} days has been read already, so this only drafts.`;
      if (!confirm(`Start a retro?\n\n${reading}`)) return;
      await call<Retro>('/start', { days: window });
    }, ui.error);
  const stop = h('button', { class: 'btn' }, 'Stop');
  stop.onclick = () => void busy(stop, () => call<Retro>('/stop').then(() => undefined), ui.error);
  const bars = frictionBars(ui, 5);
  return h('div', null,
    h('div', { class: 'briefing-note' }, `${eng.name} looks over the frictions found in the agents’ sessions in the window, and drafts an issue for each that came up in three or more, with the moments quoted. Accept one and it’s filed; reject it and it isn’t raised again. Nothing changes unless you say so.`),
    bars ? h('section', { class: 'card sc-section', style: '--c:var(--lcars-orange);margin:14px 0 0' }, h('h4', null, 'Most widespread open frictions', h('span', null, 'Sessions they came up in, over 14 days, with no retro decision yet')), bars) : null,
    h('div', { class: 'row', style: 'margin:14px 0' },
      h('span', { class: 'muted' }, 'Look back over the last'), days(), h('span', { class: 'muted' }, 'days'),
      running(retro) ? stop : start,
      h('span', { class: 'grow' }),
      retro?.costUsd ? h('small', { class: 'muted' }, `$${retro.costUsd.toFixed(2)}`) : null,
    ),
    retro && retro.status !== 'idle' ? status(retro) : null,
    retro?.status === 'done' ? findings(ui, retro) : null,
    state.report?.fixes.length ? fixes(state.report.fixes) : null,
  );
}

function status(retro: Retro): HTMLElement {
  const tone = retro.status === 'failed' ? 'bad' : retro.status === 'done' ? 'ok' : 'warn';
  return h('div', { class: 'qa-now' },
    h('span', { class: `chip ${tone}` }, retro.status),
    h('div', { class: 'grow' },
      h('strong', null, retro.status === 'failed' ? (retro.error ?? retro.activity) : retro.activity),
      h('small', null, [
        retro.sessions ? `${retro.sessions} sessions over ${retro.days} days` : `the last ${retro.days} days`,
        retro.startedAt ? `started ${timeAgo(retro.startedAt)}` : '',
      ].filter(Boolean).join(' · ')),
    ),
  );
}

function findings(ui: Ui, retro: Retro): HTMLElement {
  return h('div', { class: 'cards' },
    retro.summary ? h('p', null, retro.summary) : null,
    retro.drafts.length ? h('h3', null, `Drafts (${retro.drafts.length})`) : null,
    ...retro.drafts.map((d, i) => draft(ui, d, i)),
    retro.watch.length ? h('h3', null, 'To watch: seen in two sessions') : null,
    retro.watch.length ? h('ul', null, ...retro.watch.map((w) => h('li', null, w))) : null,
  );
}

/** Where an accepted draft is filed: the last repository picked, kept between drafts and visits. */
const FILE_IN = 'focus.retro.fileIn';

function draft(ui: Ui, d: RetroDraft, i: number): HTMLElement {
  const head = h('div', { class: 'row' }, h('strong', { class: 'grow' }, `${i + 1}. ${d.title}`), h('span', { class: 'chip' }, KIND[d.kind]), h('span', { class: 'chip off' }, `${d.sessions} sessions`));
  const text = h('div', { class: 'markdown' });
  text.innerHTML = markdownHtml(d.body);
  const details = h('details', null, h('summary', null, 'The issue as it would be filed'), text);
  const tags = h('p', null, h('span', { class: 'label' }, 'Measure '), d.measure, h('br'), h('small', { class: 'muted' }, d.signatures.join(' · ')));
  if (d.decision) {
    const issue = d.decision.issue;
    const said = d.decision.accepted
      ? h('span', { class: 'chip ok' }, issue ? h('a', { href: issue.url, target: '_blank' }, `Filed ${issue.repo}#${issue.number}`) : 'Accepted')
      : h('span', { class: 'chip off' }, 'Rejected');
    return h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, said, h('small', { class: 'muted' }, timeAgo(d.decision.at))));
  }
  const repos = state.projects.flatMap((p) => p.repos.map((repo) => ({ projectId: p.id, repo, label: `${repo} (${p.name})` })));
  const pick = h('select', null, ...repos.map((r) => h('option', { value: `${r.projectId} ${r.repo}` }, r.label)));
  const last = localStorage.getItem(FILE_IN);
  if (last && repos.some((r) => `${r.projectId} ${r.repo}` === last)) pick.value = last;
  const accept = h('button', { class: 'btn primary small' }, 'Accept and file');
  const reject = h('button', { class: 'btn small' }, 'Reject');
  accept.disabled = !repos.length;
  accept.onclick = () => {
    const [projectId, repo] = pick.value.split(' ');
    localStorage.setItem(FILE_IN, pick.value);
    void busy(accept, () => call<RetroDraft>('/decide', { id: d.id, accept: true, projectId, repo }).then(() => undefined), ui.error);
  };
  reject.onclick = () => void busy(reject, () => call<RetroDraft>('/decide', { id: d.id, accept: false }).then(() => undefined), ui.error);
  return h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, h('small', { class: 'muted' }, 'File in'), pick, accept, reject));
}

const FIX: Record<FixStatus, { tone: string; label: string }> = {
  waiting: { tone: 'off', label: 'waiting for its fix' },
  'too-early': { tone: 'warn', label: 'too early to tell' },
  stopped: { tone: 'ok', label: 'stopped it' },
  fewer: { tone: 'ok', label: 'fewer' },
  recurring: { tone: 'bad', label: 'still recurring' },
};

const share = (c: { hits: number; sessions: number }) => `${c.hits} of ${c.sessions} sessions`;

/** Each retro fix the captain accepted (the report card's): did its frictions stop coming up once it landed? */
function fixes(list: FixEffect[]): HTMLElement {
  return h('div', { class: 'cards', style: 'margin-top:12px' },
    h('h3', null, 'Retro fixes'),
    ...list.map((f) => {
      const { tone, label } = FIX[f.status];
      const issue = f.issue ? `${f.issue.repo}#${f.issue.number}` : 'not filed';
      const since = f.landed
        ? `since ${f.landed.repo}#${f.landed.pr} merged ${timeAgo(f.landed.at)}: ${share(f.after)}${f.status === 'too-early' ? ` (says once ${FIX_SESSIONS} are in)` : ''}`
        : 'its issue hasn’t been closed by a merge yet';
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, f.title), h('span', { class: `chip ${tone}` }, label)),
        h('small', { class: 'muted' }, `${issue} · before: ${share(f.before)} · ${since}`),
      );
    }),
  );
}
