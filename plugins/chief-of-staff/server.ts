// The chief of staff plugin (README.md), in shadow mode: as a goal's lead ends a turn, it judges where the turn would
// go (carry on, a card for the captain, interrupt the captain, back to the lead) and writes that in the ledger, acting
// on none of it. FOCUS_PLUGINS=chief-of-staff, and switched on per project.
import fs from 'node:fs';
import path from 'node:path';
import type { FocusPlugin } from '../../plugin-api/server';
import { ChiefOfStaff } from './chief';
import { ClaudeJudge } from './claudeJudge';
import { DemoJudge } from './demoJudge';
import { STANDING_ORDERS } from './judge';
import { CHIEF_OF_STAFF, freshChief } from './shared';

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
    // the captain's standing orders are read afresh for each turn, so editing the file takes effect at once
    const orders = path.join(host.dataDir(), STANDING_ORDERS);
    // each lead's latest verdict, for the browser to show once the captain has answered that turn: in memory only, as
    // it matters only until then
    const latest = host.state(freshChief, { saved: false });
    const chief = new ChiefOfStaff(host, host.demo ? new DemoJudge() : new ClaudeJudge((run) => host.readOnlySession(run)), () => readIfThere(orders),
      (leadId, verdict) => latest.set({ latest: { ...latest.get().latest, [leadId]: verdict } }));
    return { turn: (agent, phase) => void chief.turn(agent, phase) };
  },
};

export default chiefOfStaff;
