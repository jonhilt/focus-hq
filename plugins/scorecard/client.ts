// The scorecard in the browser (README.md): its overview on the engineering station, the code's numbers and the office's
// in views of their own, and its board on main engineering's MSD.
import type { ClientPlugin, EngineeringGo } from '../../client/src/plugins';
import { drawScorecard } from './msd';
import { formatValue, glance } from './scorecard';
import { SCORECARD, type ScorecardSection } from './types';
import { type Go, scorecardHead, scorecardOverview, scorecards, scorecardSections } from './view';
import './scorecard.css';

/** Which of the plugin's views each section's numbers live in. */
const VIEW_OF: Record<ScorecardSection, string> = { gate: 'code', fence: 'code', effect: 'code', tests: 'code', office: 'office' };

/** To a section's numbers on the engineering station, with `key` opened. */
const toSection = (go: EngineeringGo): Go => (section, key) => go(VIEW_OF[section], { key, anchor: `sc-${section}` });

const now = () => glance(scorecards()?.history ?? []);

const scorecard: ClientPlugin = {
  id: SCORECARD,
  engineering: {
    readout: () => {
      const g = now();
      return g?.compared ? `▲${g.better} ▼${g.worse}` : '';
    },
    overview: (ui, cards, go) => scorecardOverview(ui, toSection(go), cards),
    views: [
      {
        key: 'code',
        label: 'Code',
        readout: () => {
          const gate = now()?.gate;
          return gate ? (gate.pass ? 'PASS' : 'FAIL') : '';
        },
        standby: () => !now(),
        render: (ui, _go, open) => [scorecardHead(ui), ...scorecardSections(['gate', 'fence', 'effect', 'tests'], open)],
      },
      {
        key: 'office',
        label: 'Office',
        readout: () => {
          const office = now()?.tiles.find((t) => t.section === 'office')?.hero.metric;
          return office ? formatValue(office.value, office.format) : '';
        },
        render: (ui, _go, open) => [scorecardHead(ui), ...scorecardSections(['office'], open)],
      },
    ],
  },
  msd: (ctx, box) => drawScorecard(ctx, box, scorecards()),
};

export default scorecard;
