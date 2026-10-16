// The retro in the browser (README.md): its card on the engineering station's overview, its own Retro view, and what
// the chief engineer says at the station while one runs or waits on the captain.
import type { ClientPlugin } from '../../plugin-api/client';
import { RETRO, running, stationLine, waiting } from './shared';
import { latest, retroCard, retroView } from './view';
import './retro.css';

const retro: ClientPlugin = {
  id: RETRO,
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
