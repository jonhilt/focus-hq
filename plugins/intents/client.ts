// The intents plugin in the browser: an Intents view in each project's goals panel, its compass: what the project's
// work is for and the guardrails for how it's done, and its intents, each changed only by the user's own save.
import { busy, callPlugin, type ClientPlugin, h, pluginState, timeAgo, type Ui } from '../../plugin-api/client';
import { type Compass, type Intent, INTENTS, intentName, type IntentsState } from './shared';
import './intents.css';

/** Project `projectId`'s compass as the browser has it now. */
const compassOf = (projectId: string): Compass => pluginState<IntentsState>(INTENTS)?.compasses[projectId] ?? { intents: [] };

/**
 * What's being written, kept across the panel being drawn again (it is, as the ship changes): intents to add, what
 * the project is for, an intent's new words, or why it's retired. `key` says which; `more` is the guardrails.
 */
interface Draft {
  key: string;
  what: string;
  more: string;
  why: string;
}
let writing: Draft | null = null;

/** When an intent was agreed, and why it last changed. */
export const agreedLine = (i: Pick<Intent, 'why' | 'at'>): string => `${i.why ? `${i.why} · ` : ''}agreed ${timeAgo(i.at)}`;

/** An intent's words, its name (what leads it, up to a colon) in bold. */
function intentWords(what: string): HTMLElement {
  const name = intentName(what);
  return h('div', { class: 'intents-what' }, ...(name ? [h('b', null, name), what.slice(name.length)] : [what]));
}

/** One field of a form: its words kept in the draft as they're typed. */
function field(draft: Draft, name: 'what' | 'more' | 'why', placeholder: string, rows = 0): HTMLInputElement | HTMLTextAreaElement {
  const el = rows ? h('textarea', { class: 'intents-field', rows, placeholder }) : h('input', { class: 'intents-field', placeholder });
  el.value = draft[name];
  el.oninput = () => (draft[name] = el.value);
  return el;
}

/** What a key does in a form's field: Enter saves from a one-line field (a box of several lines takes it as a new line), Esc leaves. */
export const keyAction = (key: string, oneLine: boolean): 'save' | 'cancel' | null =>
  key === 'Escape' ? 'cancel' : key === 'Enter' && oneLine ? 'save' : null;

/**
 * A form for `draft`, saved with `label` (or Enter in a one-line field), left with Esc or Cancel. It's put away as it's
 * sent: the compass can come back changed (and the panel be drawn again) before Focus answers, and only a refusal brings it back.
 */
function form(ui: Ui, projectId: string, draft: Draft, fields: (HTMLInputElement | HTMLTextAreaElement)[], label: string, body: Record<string, unknown>, redraw: () => void): HTMLElement {
  const save = h('button', { class: 'btn small primary' }, label);
  const cancel = h('button', { class: 'btn small' }, 'Cancel');
  save.onclick = () => void busy(save, async () => {
    writing = null;
    try {
      await callPlugin(INTENTS, '/change', { projectId, ...body, what: draft.what, guardrails: draft.more, text: draft.what, why: draft.why });
    } catch (err) {
      writing = draft;
      redraw();
      throw err;
    }
  }, ui.error);
  cancel.onclick = () => ((writing = null), redraw());
  for (const el of fields) {
    el.onkeydown = (e) => {
      const act = keyAction(e.key, el instanceof HTMLInputElement);
      if (act) (act === 'save' ? save : cancel).click();
    };
  }
  setTimeout(() => fields[0]?.focus(), 0);
  return h('div', { class: 'intents-form' }, ...fields, h('div', { class: 'row intents-actions' }, save, cancel));
}

/** A button that starts writing `draft`. */
const opens = (label: string, draft: Draft, redraw: () => void, title?: string) =>
  h('button', { class: 'btn small', ...(title && { title }), onclick: () => ((writing = draft), redraw()) }, label);

/** What the project is for and its guardrails, or a way to say them. */
function aboutCard(ui: Ui, projectId: string, compass: Compass, redraw: () => void): HTMLElement {
  const about = compass.about;
  if (writing?.key === 'about') {
    const d = writing;
    return h('div', { class: 'card intents-about' }, form(ui, projectId, d, [
      field(d, 'what', 'What this project’s work is for, in a line'),
      field(d, 'more', 'Guardrails: how the work is done, whatever it’s for, one a line (never disrupt the live product, say)', 4),
      field(d, 'why', 'Why it changed (optional)'),
    ], 'Agree', { do: 'about' }, redraw));
  }
  const draft = { key: 'about', what: about?.what ?? '', more: about?.guardrails.join('\n') ?? '', why: '' };
  return h('div', { class: 'card intents-about' },
    h('small', { class: 'muted' }, 'What it’s for'),
    about ? h('div', { class: 'intents-what' }, about.what) : h('div', { class: 'muted' }, 'Not said yet'),
    about?.guardrails.length ? h('ul', { class: 'intents-guardrails' }, ...about.guardrails.map((g) => h('li', null, g))) : null,
    about ? h('small', { class: 'muted intents-agreed' }, agreedLine(about)) : null,
    h('div', { class: 'row intents-actions' }, opens(about ? 'Edit' : 'Say what it’s for', draft, redraw, 'What this project’s work is for, and its guardrails')),
  );
}

/** One intent: its words, when it was agreed and why it last changed, and its rewording or retiring. */
function intentRow(ui: Ui, projectId: string, i: Intent, redraw: () => void): HTMLElement {
  const d = writing;
  const editing = d?.key === `edit:${i.id}` ? form(ui, projectId, d, [field(d, 'what', 'What it’s for', 3), field(d, 'why', 'Why it changed (optional)')], 'Agree', { do: 'edit', id: i.id }, redraw) : null;
  const retiring = d?.key === `retire:${i.id}` ? form(ui, projectId, d, [field(d, 'why', 'Why retire it? (done, merged into another, no longer the aim)')], 'Retire', { do: 'retire', id: i.id }, redraw) : null;
  return h('div', { class: 'card intents-row' },
    intentWords(i.what),
    h('small', { class: 'muted intents-agreed' }, agreedLine(i)),
    editing ?? retiring ?? h('div', { class: 'row intents-actions' },
      opens('Edit', { key: `edit:${i.id}`, what: i.what, more: '', why: '' }, redraw),
      opens('Retire', { key: `retire:${i.id}`, what: '', more: '', why: '' }, redraw, 'It no longer says what the work is for: its last words stay in the ledger'),
    ),
  );
}

/** Project `projectId`'s compass: what it's for and its guardrails, then its intents, and adding some. */
export function intentsView(ui: Ui, projectId: string): HTMLElement {
  const view = h('div', { class: 'intents-view' });
  const redraw = () => {
    const compass = compassOf(projectId);
    const d = writing;
    const adding = d?.key === 'add'
      ? form(ui, projectId, d, [field(d, 'what', 'One intent a line: a name, a colon, then what it’s for (Deliver value, reliably: each goal lands as…)', 5), field(d, 'why', 'Why (optional): where they came from, say')], 'Agree', { do: 'add' }, redraw)
      : h('div', { class: 'row intents-actions' }, opens(compass.intents.length ? 'Add intents' : 'Add the first intents', { key: 'add', what: '', more: '', why: '' }, redraw));
    view.replaceChildren(
      aboutCard(ui, projectId, compass, redraw),
      h('h3', null, `Intents (${compass.intents.length})`),
      ...compass.intents.map((i) => intentRow(ui, projectId, i, redraw)),
      adding,
    );
  };
  redraw();
  return h('div', null,
    h('p', { class: 'muted intents-intro' }, 'What this project’s work is for: a few lasting outcomes, not tasks, and the guardrails for how it’s done. Sort for me judges the project’s threads against them. Nothing’s written until you agree it, and each change is a line in the ledger saying why.'),
    view,
  );
}

const intents: ClientPlugin = {
  id: INTENTS,
  about: {
    name: 'Intents',
    summary: 'Keeps each project’s compass: what its work is for, a few lasting intents, and the guardrails for how it’s done, changed only when you agree it.',
    adds: [
      'An Intents view in each project’s goals panel: what the project is for and its guardrails, its intents, and adding, rewording or retiring them, each with why',
      'Threads’ Sort for me judges a project’s threads against its intents, when it has some',
    ],
    cost: 'free',
    costDetail: 'No model calls: it reads the project’s intent lines in the ledger, and writes the ones you agree.',
  },
  project: { label: 'Intents', about: 'An Intents view in the goals panel: what this project’s work is for, its intents and its guardrails, which Sort for me judges threads against.' },
  goalsView: {
    label: 'Intents',
    readout: (projectId) => String(compassOf(projectId).intents.length || ''),
    render: intentsView,
  },
  start() {
    // the ledger as it is now, in case it changed since Focus started
    callPlugin(INTENTS, '/read').catch((err: unknown) => console.error('The intents plugin couldn’t read the ledger', err));
  },
};

export default intents;
