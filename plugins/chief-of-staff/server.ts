// The chief of staff plugin (README.md): the captain's inbox (what waits on them, answered from Comms, an agent's panel
// or a bot on the API), and, as a goal's lead ends a turn, its judgement of where the turn goes (carry on, a card for
// the captain, interrupt the captain, back to the lead), written in the ledger and filed in the inbox; and as a lead
// ships, whether to raise the lane it merges in (never lower it), holding it back until it has read it. It sends nothing
// itself but where the captain lets it, and the carry-ons the core leaves to it: a QA fail back to the lead, a slice
// that's landed. FOCUS_PLUGINS=chief-of-staff, and switched on per project.
import fs from 'node:fs';
import path from 'node:path';
import type { FocusPlugin } from '../../plugin-api/server';
import { BotHook } from './botHook';
import { Inbox } from './captainsInbox';
import { ChiefOfStaff } from './chief';
import { ClaudeJudge } from './claudeJudge';
import { CREW } from './crew';
import { DemoJudge } from './demoJudge';
import { STANDING_ORDERS } from './judge';
import { inboxRoutes, threadRoute } from './routes';
import { JevRouter } from './jevRouter';
import { AUTO_SEND_EVERY, autoSendFor, CHIEF_OF_STAFF, freshState, jevFor } from './shared';

/** How often the bot hears what changed. */
const BOT_EVERY = 3000;

/** A file's text, or undefined when it isn't there. */
function readIfThere(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

const chiefOfStaff: FocusPlugin = {
  id: CHIEF_OF_STAFF,
  start(host) {
    // a crew file that's wrong stops Focus as it starts, saying which and where, rather than at the first turn it judges
    CREW.check();
    // the captain's standing orders are read afresh for each turn, so editing the file takes effect at once
    const orders = path.join(host.dataDir(), STANDING_ORDERS);
    const settings = host.state(freshState);
    // its words go by themselves only in a project it's on for, and where the captain lets it
    const autoSends = (projectId: string) => host.on(projectId) && autoSendFor(settings.get(), host.projects().find((p) => p.id === projectId));
    // Jev routes only where the captain switched it on, with the TypeSafe key from where Focus starts or, so it reaches
    // no other plugin (Number One's calls take theirs from the environment), from the plugin's own folder
    const typesafeKey = () => process.env.TYPESAFE_API_KEY || readIfThere(path.join(host.dataDir(), 'typesafe.key'))?.trim() || undefined;
    const jev = host.demo ? undefined : { router: new JevRouter(typesafeKey), on: (projectId: string) => host.on(projectId) && jevFor(settings.get(), projectId) };
    const judge = host.demo ? new DemoJudge() : new ClaudeJudge((run) => host.readOnlySession(run));
    const chief = new ChiefOfStaff(host, judge, () => readIfThere(orders), autoSends, jev);
    const inbox = new Inbox(host, autoSends);
    setInterval(() => void inbox.autoSend(), AUTO_SEND_EVERY).unref();
    // a bot speaking for the captain hears what changes in the inbox, and what the leads show, on its webhook, once
    // it has a token and a webhook (the captain sets them in Settings while Focus runs)
    const hook = new BotHook(() => ({ ...inbox.view(), leads: inbox.leads() }), () => host.bot);
    setInterval(() => void hook.tick(), BOT_EVERY).unref();
    const leadsIn = (projectId: string) => host.agents().filter((a) => a.projectId === projectId && a.task === 'lead').map((a) => a.id);
    return {
      turn: (agent, phase) => void chief.turn(agent, phase),
      boardRefreshed: (projectId) => void chief.readShips(projectId),
      mergeHeld: (pr) => chief.mergeHeld(pr),
      leadNoted: (lead, note) => chief.noted(lead, note),
      captainAnswered: (before, answer) => inbox.answered(before, answer),
      routes: [...inboxRoutes(inbox, settings, leadsIn, () => host.bot.publicUrl), threadRoute(host)],
    };
  },
};

export default chiefOfStaff;
