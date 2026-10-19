// The captain's log in the browser (README.md): J anywhere aboard opens it.
import { openCaptainsLogPanel } from './panel';
import { CAPTAINS_LOG } from './shared';
import './captains-log.css';
import type { ClientPlugin } from '../../plugin-api/client';

const captainsLog: ClientPlugin = {
  id: CAPTAINS_LOG,
  legend: [{ key: 'J', label: 'log' }],
  start({ ui }) {
    return {
      keydown: (e) => {
        if (e.code !== 'KeyJ' || ui.panels.isOpen) return false;
        openCaptainsLogPanel(ui);
        return true;
      },
    };
  },
};

export default captainsLog;
