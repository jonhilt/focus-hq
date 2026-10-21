// What the scorecard lends the plugins that require it (docs/plugins.md): the one file of it another plugin may import.
// In Focus they reach main's scorecards through what it provides (`host.uses<ScorecardService>('scorecard')`);
// a script of theirs, which runs without a host, reads the saved ones and words a change as the scorecard does.
export { SCORECARD, type Scorecard, type ScorecardNoise, type ScorecardService } from './types';
export { SavedScorecards, scorecardsDir } from './desk';
export { direction, formatValue } from './scorecard';
export { render } from './scripts/scorecardRules';
