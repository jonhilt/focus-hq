// The retro in the browser: its card on the engineering station's overview, its own Retro view, and what
// the chief engineer says at the station while one runs or waits on the captain.
import type { ClientPlugin } from '../../plugin-api/client';
import { RETRO, running, stationLine, waiting } from './shared';
import { latest, retroCard, retroView } from './view';
import './retro.css';

const retro: ClientPlugin = {
  id: RETRO,
  about: {
    name: 'Retro',
    summary: 'The chief engineer looks back over frictions in the agents’ sessions and drafts an issue for each that keeps coming back.',
    adds: [
      'The Retro view on the engineering panel',
      'Draft issues for you to accept or reject',
    ],
    cost: 'on-demand',
    costDetail: 'Reads sessions on Opus when you start a retro: a big read each time, nothing in between.',
  },
  engineering: {
    card: retroCard,
    views: [{
      key: RETRO,
      label: 'Retro',
      readout: () => {
        const drafts = waiting(latest());
        return running(latest()) ? 'LIVE' : drafts ? `${drafts} ${drafts === 1 ? 'DRAFT' : 'DRAFTS'}` : '';
      },
      render: (ui) => [retroView(ui)],
    }],
    station: () => stationLine(latest()),
  },
};

export default retro;
