// The briefings plugin in the browser (README.md): round a lead's explainer up close, its voice-over, which hears from
// the player's page and talks each beat through, and asking the lead about the beat you're on.
import { type ClientPlugin, h, leadVoice, office, type ScreenPart, type ScreenView } from '../../plugin-api/client';
import { BriefingAsk } from './ask';
import { Narrator } from './narrator';
import { BRIEFINGS } from './shared';
import './briefings.css';

/** A briefing up close: its narrator, and (while the goal's open) asking the lead about it, which outlives a new version of it. */
class BriefingScreen implements ScreenPart {
  readonly head: HTMLElement;
  readonly foot?: HTMLElement;
  readonly narrator: Narrator;
  readonly ask?: BriefingAsk;

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
    if (before?.ask) {
      before.ask.narrator = this.narrator;
      this.ask = before.ask;
    } else if (view.live) {
      this.ask = new BriefingAsk(view.ui, view.leadId, view.artifact, this.narrator);
    }
    this.foot = this.ask?.el;
  }

  heard(e: MessageEvent): void {
    this.narrator.heard(e);
  }

  end(): void {
    this.narrator.end();
    this.ask?.end();
  }
}

const briefings: ClientPlugin = {
  id: BRIEFINGS,
  project: { label: 'Briefings', about: 'Leads can walk you through a concept with an animated explainer on their station’s screen, narrated, and answer questions about the beat you’re on.' },
  screen: (view) => new BriefingScreen(view),
};

export default briefings;
