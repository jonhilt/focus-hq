// The chief of staff plugin (README.md): as a goal's lead ends a turn, it judges where the turn goes (carry on, a card
// for the captain, interrupt the captain, back to the lead), writes that in the ledger, and hands it to the captain's
// inbox, which files the turn by it. It sends nothing itself, but for the carry-ons the core leaves to it: a QA fail back
// to the lead, a slice that's landed. FOCUS_PLUGINS=chief-of-staff, and switched on per project.
import fs from 'node:fs';
import path from 'node:path';
import type { FocusPlugin } from '../../plugin-api/server';
import { ChiefOfStaff } from './chief';
import { ClaudeJudge } from './claudeJudge';
import { DemoJudge } from './demoJudge';
import { STANDING_ORDERS } from './judge';
import { CHIEF_OF_STAFF } from './shared';

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
    const chief = new ChiefOfStaff(host, host.demo ? new DemoJudge() : new ClaudeJudge((run) => host.readOnlySession(run)), () => readIfThere(orders));
    return { judgesTurns: (agent) => chief.judges(agent), turn: (agent, phase) => void chief.turn(agent, phase), leadNoted: (lead, note) => chief.noted(lead, note) };
  },
};

export default chiefOfStaff;
