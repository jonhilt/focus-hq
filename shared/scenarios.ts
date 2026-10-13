// Demo mode's training scenarios (docs/studio.md): which parts of its story a demo goal's lead plays, so a scene can film
// one idea (subagents, workflows) without the rest of the story in the way. Pure, shared by the demo runner and scenes.

/** The scenarios, by name: `full` is the whole story, as `pnpm run demo` plays it. */
export const SCENARIOS = ['full', 'subagents', 'workflow'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** The parts of the lead's slice a scenario can leave out: the rest (looking round, asking, building, shipping) always plays. */
export interface ScenarioParts {
  /** The explainer on the station's screen: how a save travels. */
  explain: boolean;
  /** A helper (an Explore subagent) per repo, mapping it side by side. */
  helpers: boolean;
  /** A probe script, and the dev server and a monitor in the background. */
  background: boolean;
  /** The workflows that review the slice and map the repos, in the transporter rooms. */
  workflows: boolean;
}

const PARTS: Record<Scenario, ScenarioParts> = {
  full: { explain: true, helpers: true, background: true, workflows: true },
  subagents: { explain: false, helpers: true, background: false, workflows: false },
  workflow: { explain: false, helpers: false, background: false, workflows: true },
};

/** What a scenario plays. */
export function scenarioParts(scenario: Scenario): ScenarioParts {
  return PARTS[scenario];
}

/** A scenario by name, or an error naming the ones there are; missing is `full`. */
export function readScenario(value: unknown): Scenario {
  if (value === undefined || value === null || value === '') return 'full';
  if (typeof value === 'string' && (SCENARIOS as readonly string[]).includes(value)) return value as Scenario;
  throw new Error(`The scenario is ${JSON.stringify(value)}: it's one of ${SCENARIOS.join(', ')}`);
}
