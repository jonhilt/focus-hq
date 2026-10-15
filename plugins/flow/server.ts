// The flow plugin (README.md): where each open goal's time has gone so far, and what it's waiting on now, worked out
// as its lead's turns start and end, QA reports and its pull requests land, for the goal's screens. Its scripts
// (`pnpm run flow`, `pnpm run qa-catch`) work whether it's switched on or not. FOCUS_PLUGINS=flow.
import type { FocusPlugin } from '../../server/plugins/contract';
import { Flows } from './flows';
import { FLOW, type FlowPluginState } from './shared';

const flow: FocusPlugin = {
  id: FLOW,
  start(host) {
    // worked out again as the office starts, from the transcripts and the ledger, so there's nothing to save
    const flows = new Flows(host, host.state<FlowPluginState>(() => ({ leads: {} }), { saved: false }));
    void flows.all();
    return {
      turn: (agent, phase) => flows.turn(agent, phase),
      ledgerRecorded: (event) => flows.ledgerRecorded(event),
    };
  },
};

export default flow;
