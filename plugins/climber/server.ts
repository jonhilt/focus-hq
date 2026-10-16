// The climber plugin (README.md): main engineering's climbing engineer, who moves the office's own repo up its
// scorecard one pull request at a time while the captain keeps climbing switched on. FOCUS_PLUGINS=climber.
import type { FocusPlugin } from '../../plugin-api/server';
import { CLIMB_ASSIGNMENT, CLIMB_SUMMARY, climbPullRequest } from './climb';
import { Climbs } from './climbs';
import { CLIMBER, isClimbBranch } from './shared';

const DEMO_TITLE = 'Narrow the board’s non-null assertions to checked lookups';

const climber: FocusPlugin = {
  id: CLIMBER,
  // its whole job is moving the scorecard's numbers, and main's history only grows while the scorecard measures merges
  requires: ['scorecard'],
  start(host) {
    const climbs = new Climbs(host);
    return {
      briefs: {
        climb: {
          label: 'Climb',
          icon: '🧗',
          // they stand behind the master systems table in main engineering, not at one of the room's desks
          away: true,
          assignment: CLIMB_ASSIGNMENT,
          summary: CLIMB_SUMMARY,
          brief: (agent) => climbs.brief(agent),
          // the title is the first line of the climber's own write-up
          pullRequest: climbPullRequest,
          demo: {
            title: DEMO_TITLE,
            summary: `# ${DEMO_TITLE}\n\n**Problem**\n\n\`shared/board.ts\` asserted 6 lookups non-null; one crashed the board when a PR's agent had gone home.\n\n**Solution**\n\nChecked lookups with a fallback, and a lint rule that flags new \`!\` in \`shared/\` (it failed first on the old code).\n\n**Before**\n\n- Non-null assertions (x!): 128\n- Gate passes in 74s\n\n**After**\n\n- Non-null assertions (x!): 122 ▲ −6\n- Gate passes in 75s`,
          },
        },
      },
      routes: [{ method: 'post', path: '/keep-climbing', handle: ({ body }) => climbs.keepClimbing(body.on === true) }],
      boardRefreshed: () => climbs.settle(),
      prOpened: (agent, pr) => climbs.opened(agent.id, pr),
      prClosed: (repo, number, merged) => climbs.prClosed(repo, number, merged),
      // a climb never merges by itself, even once its climber has gone home
      captainMerges: (pr) => isClimbBranch(pr.branch),
    };
  },
};

export default climber;
