// The flow plugin in the browser (README.md): each open goal's flow as a readout on its card in the goals list, a tag
// on its lines in Comms, and a strip along the bottom of its goal board.
import type { ClientPlugin } from '../../plugin-api/client';
import { flowStrip } from './board';
import { FLOW } from './shared';
import { flowTag } from './tags';

const flow: ClientPlugin = {
  id: FLOW,
  goal: { tag: flowTag, board: flowStrip },
};

export default flow;
