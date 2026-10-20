// The chief of staff in the browser (README.md): its switch in a project's settings, and, once the captain has answered
// a lead from Comms, a toast with its own words on that turn, as it wrote them. After, never before, so what the
// captain decides is theirs alone.
import { type ClientPlugin, onPluginState, pluginState } from '../../plugin-api/client';
import { CHIEF_OF_STAFF, type ChiefState, onTurn } from './shared';

const latest = (leadId: string) => pluginState<ChiefState>(CHIEF_OF_STAFF)?.latest[leadId];

const chiefOfStaff: ClientPlugin = {
  id: CHIEF_OF_STAFF,
  project: {
    label: 'Chief of staff (shadow)',
    about: 'Judges where each of a goal lead’s turns would go (carry on, a card for you, interrupt you, back to the lead) and keeps it in the ledger, without acting on it. Once you’ve answered a turn in Comms, it says what it thought',
  },
  start({ ui }) {
    // turns answered before their verdict came in, by lead: said when it does
    const waiting = new Map<string, { status: string; finishedAt?: number }>();
    const say = (why: string) => ui.hud.toast('info', `Chief of staff: ${why}`);
    onPluginState(CHIEF_OF_STAFF, () => {
      for (const [id, lead] of waiting) {
        const verdict = latest(id);
        if (!onTurn(verdict, lead)) continue;
        waiting.delete(id);
        say(verdict.why);
      }
    });
    return {
      answered: (lead) => {
        const verdict = latest(lead.id);
        if (onTurn(verdict, lead)) say(verdict.why);
        else if (lead.status === 'done') waiting.set(lead.id, { status: lead.status, finishedAt: lead.finishedAt });
      },
    };
  },
};

export default chiefOfStaff;
