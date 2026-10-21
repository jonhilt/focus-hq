// The briefings plugin in the browser: round a lead's explainer up close, its voice-over, which hears from
// the player's page and talks each beat through; and on the engineering panel, the captain's setting for the writer.
import { callPlugin, type ClientPlugin, h, leadVoice, focus, pluginState, type ScreenPart, type ScreenView, Switch, type Ui } from '../../plugin-api/client';
import { EFFORT_LEVELS } from '../../plugin-api/shared';
import { Narrator } from './narrator';
import { BRIEFINGS, type BriefingsState, freshBriefings, hasFast, WRITER_MODELS, type WriterSetting, writtenHow } from './shared';
import './briefings.css';

/** A briefing up close: its narrator, and what a new version of it changed. */
class BriefingScreen implements ScreenPart {
  readonly head: HTMLElement;
  readonly narrator: Narrator;

  constructor(view: ScreenView) {
    const before = view.before instanceof BriefingScreen ? view.before : undefined;
    // a new version of the briefing: what it was, to tell which beat changed
    before?.narrator.end();
    const updated = h('span', { class: 'chip updated', hidden: true });
    this.head = updated;
    const leadName = () => focus.agent(view.leadId)?.name ?? 'The lead';
    this.narrator = new Narrator(view.frame, leadVoice(view.leadId), before ? {
      beats: before.narrator.beats,
      updated: (beat) => {
        updated.hidden = false;
        updated.textContent = beat >= 0 ? `Updated · beat ${beat + 1} changed` : 'Updated';
        updated.title = beat >= 0 ? `${leadName()} explained it again: it's waiting at the beat that changed, to play from there` : `${leadName()} explained it again`;
      },
    } : undefined);
  }

  heard(e: MessageEvent): void {
    this.narrator.heard(e);
  }

  end(): void {
    this.narrator.end();
  }
}

/** The writer's card: which model writes a lead's brief up, how hard it thinks, and fast mode, where the model has it. */
function writerCard(ui: Ui): HTMLElement {
  const state = pluginState<BriefingsState>(BRIEFINGS) ?? freshBriefings();
  const w = state.writer;
  const set = (patch: Partial<WriterSetting>) => void callPlugin<BriefingsState>(BRIEFINGS, '/writer', patch).catch((err: Error) => ui.error(err.message));
  const model = h('select', { title: 'The model that writes a lead’s brief up as an explainer' },
    ...WRITER_MODELS.map((m) => h('option', { value: m.id, selected: m.id === w.model }, m.label)));
  model.onchange = () => set({ model: model.value });
  const effort = h('select', { title: 'How hard the writer thinks' },
    h('option', { value: '', selected: !w.effort }, 'leads’ effort'),
    ...EFFORT_LEVELS.map((e) => h('option', { value: e, selected: e === w.effort }, `${e} effort`)));
  effort.onchange = () => set({ effort: EFFORT_LEVELS.find((e) => e === effort.value) ?? '' });
  const fast = new Switch('Fast', w.fast, { title: 'Fast mode: quicker briefings at twice the price per token. Only Opus has it: on another model it’s left off.', changed: (on) => set({ fast: on }) });
  // the leads' own model may be Opus, so fast is only out of reach once another model's picked
  fast.el.disabled = w.model !== '' && !hasFast(w.model);
  return h('div', { class: 'card briefings-writer' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Briefings', h('span', { class: 'muted' }, ' · writer')), fast.el),
    h('div', { class: 'row' }, model, effort),
    h('small', { class: 'muted' }, state.last ? `Last brief: ${writtenHow(state.last)}.` : 'Leads send a brief and the writer writes the explainer, or they write it themselves.'),
  );
}

const briefings: ClientPlugin = {
  id: BRIEFINGS,
  project: { label: 'Briefings', about: 'Leads can walk you through a concept with an animated explainer on their station’s screen, narrated in their voice.' },
  screen: (view) => new BriefingScreen(view),
  engineering: { card: writerCard },
};

export default briefings;
