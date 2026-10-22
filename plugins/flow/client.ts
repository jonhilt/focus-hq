// The flow plugin in the browser (README.md): each open goal's flow as a readout on its card in the goals list, a tag
// on its lines in Comms, and a strip along the bottom of its goal board.
import type { ClientPlugin } from '../../plugin-api/client';
import { flowStrip } from './board';
import { FLOW } from './shared';
import { flowTag } from './tags';

const flow: ClientPlugin = {
  id: FLOW,
  about: {
    name: 'Flow',
    summary: 'Shows where each open goal’s time has gone so far, and what it’s waiting on now.',
    adds: [
      'A readout on each goal’s card, a tag in Comms',
      'A strip along the bottom of each goal board',
    ],
    cost: 'free',
    costDetail: 'No model calls: it works from the ledger and the goals’ turns.',
  },
  goal: { tag: flowTag, board: flowStrip },
};

export default flow;
