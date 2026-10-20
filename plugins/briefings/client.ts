// The briefings plugin in the browser (README.md): round a lead's explainer up close, its voice-over, which hears from
// the player's page and talks each beat through.
import { type ClientPlugin, h, leadVoice, office, type ScreenPart, type ScreenView } from '../../plugin-api/client';
import { Narrator } from './narrator';
import { BRIEFINGS } from './shared';
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
    const leadName = () => office.agent(view.leadId)?.name ?? 'The lead';
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

const briefings: ClientPlugin = {
  id: BRIEFINGS,
  project: { label: 'Briefings', about: 'Leads can walk you through a concept with an animated explainer on their station’s screen, narrated in their voice.' },
  screen: (view) => new BriefingScreen(view),
};

export default briefings;
