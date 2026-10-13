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

/** What the training console (docs/studio.md) says of each scenario, and the goal it readies for the captain to start. */
export interface Training {
  label: string;
  blurb: string;
  /** The demo project the goal goes to: Sock Shop has two repos, so its lead has two to hand out. */
  project: string;
  goal: string;
}

export const TRAINING: Record<Scenario, Training> = {
  subagents: {
    label: 'Subagents',
    blurb: 'The lead hands each repo to a helper with a fresh context of its own, and only the answers come back',
    project: 'Sock Shop',
    goal: 'Shoppers can save items for later and find them again on any device',
  },
  workflow: {
    label: 'Workflow',
    blurb: 'The lead reviews its slice with workflows, their away teams beaming into the transporter rooms',
    project: 'Sock Shop',
    goal: 'Show how many of each sock are left in stock on the product page',
  },
  full: {
    label: 'Full story',
    blurb: 'All of it: the explainer, helpers, a probe and background jobs, and the workflows',
    project: 'Sock Shop',
    goal: 'Shoppers can save items for later and find them again on any device',
  },
};

/** The training console's dice: every run of a scenario casts the same crew and rolls the same waits. */
export const TRAINING_SEED = 7;

/** What a scenario plays. */
export function scenarioParts(scenario: Scenario): ScenarioParts {
  return PARTS[scenario];
}

/**
 * Whether the captain's message asks for a workflow in their own words, as real Claude Code needs before its Workflow
 * tool runs ("run a workflow", "use a workflow", ultracode): a demo lead then runs its workflows whatever the scenario.
 */
export function asksForWorkflow(message: string): boolean {
  return /\b(run|use|start|try)\s+(a|the)\s+workflows?\b|\bultracode\b/i.test(message);
}

/** What a scenario plays for a turn the captain's `message` started: asking for a workflow brings the workflows in. */
export function turnParts(scenario: Scenario, message: string): ScenarioParts {
  const parts = scenarioParts(scenario);
  return asksForWorkflow(message) ? { ...parts, workflows: true } : parts;
}

/** A scenario by name, or an error naming the ones there are; missing is `full`. */
export function readScenario(value: unknown): Scenario {
  if (value === undefined || value === null || value === '') return 'full';
  if (typeof value === 'string' && (SCENARIOS as readonly string[]).includes(value)) return value as Scenario;
  throw new Error(`The scenario is ${JSON.stringify(value)}: it's one of ${SCENARIOS.join(', ')}`);
}
