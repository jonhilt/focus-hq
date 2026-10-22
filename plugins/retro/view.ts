// The retro on the engineering station: its card on the overview, and its own view, where the captain
// starts one and decides on its drafts.
import {
  busy, callPlugin, chiefEngineer, type EngineeringGo, FIX_SESSIONS, type FixEffect, type FixStatus, frictionBars, h, markdownHtml, focus, pluginState, timeAgo, type Ui,
} from '../../plugin-api/client';
import { draftDecision, fileInChoices, type FixKind, RETRO, type Retro, retroCardLine, type RetroDraft, type RetroPage, retroPage, retroStanding, startReading, windowInput, type WindowInput } from './shared';

const KIND: Record<FixKind, string> = { check: 'Check', 'qa-rule': 'QA rule', pointer: 'Pointer', delete: 'Delete' };

/** The latest retro, as the plugin's server part saves it. */
export const latest = (): Retro | undefined => pluginState<Retro>(RETRO);

/** One of the plugin's routes. */
const call = <T>(path: string, body?: unknown) => callPlugin<T>(RETRO, path, body);

// the window outlives re-renders (other plugins' state changes redraw the station), so they don't reset what you typed;
// it starts again from a retro's own window when a new one is saved
let daysInput: WindowInput<HTMLInputElement> | undefined;
function days(): HTMLInputElement {
  daysInput = windowInput(daysInput, latest(), (n) => h('input', { type: 'number', min: '1', max: '60', value: String(n), style: 'width:80px' }));
  return daysInput.input;
}

/** The retro beside the overview: whether one's under way or waiting on you, and the frictions it would look at. */
export function retroCard(ui: Ui, go: EngineeringGo): HTMLElement {
  const { line, open } = retroCardLine(latest());
  const bars = frictionBars(ui, 3);
  return h('div', { class: 'card retro-card' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Retro'), h('button', { class: 'btn small', onclick: () => go(RETRO) }, open)),
    h('small', { class: 'muted' }, line),
    bars ? h('small', { class: 'lbl' }, 'Most widespread open frictions') : null,
    bars,
  );
}

/** The retro's own view: start or stop one, how it stands, its drafts to decide on, and how the accepted fixes did. */
export function retroView(ui: Ui): HTMLElement {
  const eng = chiefEngineer();
  const page = retroPage(latest());
  return h('div', null,
    h('div', { class: 'briefing-note' }, `${eng.name} looks over the frictions found in the agents’ sessions in the window, and drafts an issue for each that came up in three or more, with the moments quoted. Accept one and it’s filed; reject it and it isn’t raised again. Nothing changes unless you say so.`),
    frictionSection(frictionBars(ui, 5)),
    controls(ui, eng.name, page),
    page.standing ? status(page.standing) : null,
    page.found ? findings(ui, page.found) : null,
    fixes(focus.report?.fixes),
  );
}

function frictionSection(bars: HTMLElement | null): HTMLElement | null {
  return bars ? h('section', { class: 'card eng-section', style: '--c:var(--lcars-orange);margin:14px 0 0' }, h('h4', null, 'Most widespread open frictions', h('span', null, 'Sessions they came up in, over 14 days, with no retro decision yet')), bars) : null;
}

/** The window to look back over, Start (once the captain confirms what it reads) or Stop, and what it's cost. */
function controls(ui: Ui, engineer: string, page: RetroPage): HTMLElement {
  const start = h('button', { class: 'btn primary' }, page.startLabel);
  start.disabled = page.running;
  start.onclick = () =>
    void busy(start, async () => {
      const window = Number(days().value);
      const { unread, costUsd } = await call<{ unread: number; costUsd: number }>('/preview', { days: window });
      if (!confirm(`Start a retro?\n\n${startReading(engineer, window, unread, costUsd)}`)) return;
      await call<Retro>('/start', { days: window });
    }, ui.error);
  const stop = h('button', { class: 'btn' }, 'Stop');
  stop.onclick = () => void busy(stop, () => call<Retro>('/stop').then(() => undefined), ui.error);
  return h('div', { class: 'row', style: 'margin:14px 0' },
    h('span', { class: 'muted' }, 'Look back over the last'), days(), h('span', { class: 'muted' }, 'days'),
    page.running ? stop : start,
    h('span', { class: 'grow' }),
    page.cost ? h('small', { class: 'muted' }, page.cost) : null,
  );
}

function status(retro: Retro): HTMLElement {
  const { tone, headline, line } = retroStanding(retro, timeAgo);
  return h('div', { class: 'qa-now' },
    h('span', { class: `chip ${tone}` }, retro.status),
    h('div', { class: 'grow' }, h('strong', null, headline), h('small', null, line)),
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
  const text = h('div', { class: 'markdown retro-body' });
  text.innerHTML = markdownHtml(d.body);
  const details = h('details', null, h('summary', null, 'The issue as it would be filed'), text);
  const tags = h('p', null, h('span', { class: 'label' }, 'Measure '), d.measure, h('br'), h('small', { class: 'muted' }, d.signatures.join(' · ')));
  const card = (...row: (HTMLElement | null)[]) => h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, ...row));
  return d.decision ? card(decided(d.decision), h('small', { class: 'muted' }, timeAgo(d.decision.at))) : card(...undecided(ui, d));
}

function decided(decision: NonNullable<RetroDraft['decision']>): HTMLElement {
  const said = draftDecision(decision);
  return h('span', { class: `chip ${said.tone}` }, said.url ? h('a', { href: said.url, target: '_blank' }, said.text) : said.text);
}

/** Where to file it, and Accept and Reject. */
function undecided(ui: Ui, d: RetroDraft): HTMLElement[] {
  const { options, picked } = fileInChoices(focus.projects, localStorage.getItem(FILE_IN));
  const pick = h('select', null, ...options.map((o) => h('option', { value: o.value }, o.label)));
  if (picked) pick.value = picked.value;
  const accept = h('button', { class: 'btn primary small' }, 'Accept and file');
  const reject = h('button', { class: 'btn small' }, 'Reject');
  accept.disabled = !picked;
  accept.onclick = () => {
    const chosen = options.find((o) => o.value === pick.value);
    if (!chosen) return;
    localStorage.setItem(FILE_IN, chosen.value);
    void busy(accept, () => call<RetroDraft>('/decide', { id: d.id, accept: true, projectId: chosen.projectId, repo: chosen.repo }).then(() => undefined), ui.error);
  };
  reject.onclick = () => void busy(reject, () => call<RetroDraft>('/decide', { id: d.id, accept: false }).then(() => undefined), ui.error);
  return [h('small', { class: 'muted' }, 'File in'), pick, accept, reject];
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
function fixes(list: FixEffect[] | undefined): HTMLElement | null {
  if (!list?.length) return null;
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
