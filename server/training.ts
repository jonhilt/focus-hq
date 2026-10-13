// The demo ship's training console (docs/studio.md): resets the office to the quiet start the studio films from, and
// readies a scenario's goal for the captain to start and play live.

import { type Scenario, TRAINING, TRAINING_SEED } from '../shared/scenarios';
import { freshClimb, type QueuedGoal, type Snapshot } from '../shared/types';
import type { AgentManager } from './agents/manager';
import type { Hub } from './hub';
import type { Store } from './store';
import { seedRandom } from './util';

/** What a reset reaches in the office. */
export interface TrainingShip {
  store: Store;
  hub: Hub;
  agents: AgentManager;
  /** Puts the demo GitHub back as it started (`demoReset`). */
  resetGitHub: () => void;
  /** Tells the demo runner which scenario the next goal's lead plays. */
  setScenario: (scenario: Scenario) => void;
  refreshBoards: () => Promise<void>;
  snapshot: () => Promise<Snapshot>;
}

/** Clears what a run leaves behind once everyone's gone home: goals, the line for the stations, reviews and the log. */
export function clearForTraining(store: Store): void {
  for (const project of store.projects) {
    project.goalQueue = [];
    project.goals = [];
  }
  store.ledger = [];
  store.reviews.clear();
  store.closedPrs.clear();
  store.climb = freshClimb();
  store.save();
}

/**
 * Sends everyone home, clears the ship, rolls the dice from the top and puts the scenario's goal in line at its
 * project's team stations: the goal, and where it waits.
 */
export async function startTraining(scenario: Scenario, ship: TrainingShip): Promise<{ projectId: string; queued: QueuedGoal }> {
  const training = TRAINING[scenario];
  const project = ship.store.projects.find((p) => p.name === training.project);
  if (!project) throw new Error(`The demo office has no project called ${training.project}`);
  await Promise.all([...ship.store.agents.keys()].map((id) => ship.agents.dismiss(id)));
  // after they've gone: each goes home with a digest of their session in the ledger
  clearForTraining(ship.store);
  ship.resetGitHub();
  seedRandom(TRAINING_SEED);
  ship.setScenario(scenario);
  await ship.refreshBoards();
  const queued = ship.agents.queueGoal(project.id, training.goal, { from: 'the training console' });
  // every browser starts over from the quiet ship, as it does on reconnecting
  ship.hub.send({ type: 'snapshot', snapshot: await ship.snapshot() });
  return { projectId: project.id, queued };
}
