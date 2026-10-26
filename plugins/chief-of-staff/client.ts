// The chief of staff in the 3D ship (README.md): Comms, a thread per goal (C, the captain's chair on the bridge, the
// pause panel, L away from a holodeck, a project's goals), its badge on the HUD, a toast as a lead's turn comes to the
// captain, and its settings in a project's card (its switch, and whether it sends its words by itself).
import './chief-of-staff.css';
import { agentPanelOpen, callPlugin, type ClientPlugin, focus, h, LCARS, pluginState, type Project, Switch, type Ui } from '../../plugin-api/client';
import { openStream } from './stream';
import { hailing } from './here';
import { type TurnStage, turnNews, turnStage } from './inboxRules';
import { cosMove } from './moveRules';
import { autoSendFor, jevFor } from './cosRules';
import { AUTO_SEND_MS, CHIEF_OF_STAFF, cosStateOf } from './shared';

/** Comms on the HUD: whatever waits on the captain, anywhere on the ship, lit up and counted; C opens Comms to answer it. */
function badge(hails: number): HTMLElement {
  return h('div', { class: `cos-badge${hails ? ' hailing' : ''}`, title: hails ? `${hails} waiting on you: press C` : 'Nobody is waiting on you' },
    h('span', null, 'Comms'), h('b', null, String(hails)), h('kbd', null, 'C'));
}

/** Its say in a project it's on for: whether its words for a lead go by themselves, unless the captain holds them. */
function autoSendSwitch(project: Project, ui: Ui): HTMLElement {
  return new Switch('Auto-send ready words', autoSendFor(cosStateOf(pluginState<unknown>(CHIEF_OF_STAFF)), project), {
    title: `A lead’s turn the chief of staff would send back to the lead gets its words by itself after ${AUTO_SEND_MS / 60_000} minutes, unless you hold them in Comms; it never carries a lead on by itself`,
    changed: (on) => void callPlugin(CHIEF_OF_STAFF, '/auto-send', { projectId: project.id, on }).catch((e: Error) => ui.error(e.message)),
  }).el;
}

/** Its say in a project it's on for: whether Jev picks where a turn goes, the judge only writing the words. */
function jevSwitch(project: Project, ui: Ui): HTMLElement {
  return new Switch('Route with Jev', jevFor(cosStateOf(pluginState<unknown>(CHIEF_OF_STAFF)), project.id), {
    title: 'TypeSafe’s Jev picks where each lead’s turn goes, in under a second, and the chief of staff’s judge writes the words for it. It needs a TypeSafe key; when Jev can’t answer, the judge routes as before',
    changed: (on) => void callPlugin(CHIEF_OF_STAFF, '/jev', { projectId: project.id, on }).catch((e: Error) => ui.error(e.message)),
  }).el;
}

/**
 * A goal's lead's turn coming to the captain, unless they're already looking at the lead: as it ends, or as the chief
 * of staff judges it a card or an interrupt (`turnNews`); what it would carry on or send back stays quiet, in Comms.
 */
function toastTurns(ui: Ui): void {
  const stages = new Map<string, TurnStage>();
  focus.onAgent((a) => {
    if (a.task !== 'lead' || focus.isHidden(a.projectId)) return;
    const news = turnNews(stages.get(a.id), a);
    stages.set(a.id, turnStage(a));
    if (news && !agentPanelOpen(a.id)) ui.hud.toast(news.level, news.text, { label: 'Talk', run: () => ui.openAgent(a.id) });
  });
}

const chiefOfStaff: ClientPlugin = {
  id: CHIEF_OF_STAFF,
  about: {
    name: 'Chief of staff',
    summary: 'Judges each of a goal lead’s turns as it ends, and puts what needs you in Comms, with words ready for you to send.',
    adds: [
      'Comms, a thread per goal (C, the bridge chair)',
      'A badge on the HUD, and toasts',
      'Auto-send, per project: its words go to leads without you',
      'Route with Jev, per project: TypeSafe’s Jev picks the route, the judge writes the words',
    ],
    cost: 'background',
    costDetail: 'A Sonnet call at the end of every lead turn in the projects it’s on for, about 3 cents each: it adds up across busy leads. With Route with Jev, a Jev call too, about a hundredth of a cent.',
  },
  project: {
    label: 'Chief of staff',
    about: 'Judges each of a goal lead’s turns as it ends: a card for you, an interrupt, or words for the lead (carry on, or back to them) ready for you to send from Comms. It sends nothing itself',
    settings: (project, ui) => [autoSendSwitch(project, ui), jevSwitch(project, ui)],
  },
  legend: [{ key: 'C', label: 'comms' }],
  hud: () => {
    const hails = hailing().length;
    return { text: `Comms: ${hails} waiting`, el: badge(hails) };
  },
  panel: { label: 'Comms', open: openStream },
  // L away from a holodeck, and back out of a project's goals
  everyGoal: { label: 'Comms', title: 'Comms: who’s waiting on you, and every goal under way on the ship (C)', open: openStream },
  // its badge and its toasts, in place of the core's plain count and toast
  hails: true,
  chair: { at: 'bridge', label: 'Comms: what needs you', use: openStream },
  // its pill in "whose move" over a goal's pod, lit while it reads the lead's turn or counts down to sending its words; what it leaves the captain it hands them
  goal: { holder: { key: CHIEF_OF_STAFF, label: 'Chief of staff', colour: LCARS.peach }, move: cosMove },
  start({ ui }) {
    toastTurns(ui);
    return {
      keydown: (e) => {
        if (e.code !== 'KeyC' || ui.panels.isOpen) return false;
        openStream(ui);
        return true;
      },
    };
  },
};

export default chiefOfStaff;
