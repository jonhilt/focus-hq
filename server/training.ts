// The demo ship's training console (docs/studio.md): resets the office to the quiet start the studio films from, and
// readies a scenario's goal for the captain to start and play live.

import { type Scenario, TRAINING, TRAINING_SEED, TRAINING_SPEED } from '../shared/scenarios';
import { SHOWCASE } from '../shared/showcase';
import { readScene, type Scene } from '../shared/studio';
import { DEFAULT_STEPS, type TrainingStep } from '../shared/trainingSteps';
import type { Project, QueuedGoal, Snapshot } from '../shared/types';
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
  /** Sets how fast the demo's pretend agents go. */
  setSpeed: (speed: number) => void;
  refreshBoards: () => Promise<void>;
  snapshot: () => Promise<Snapshot>;
  /** The scene scripts in scenes/, by file name, as parsed from their YAML. */
  scenes: () => Promise<SceneFile[]>;
}

/** A scene script as it was read from scenes/: its name, and its YAML, parsed but not yet checked. */
export interface SceneFile {
  name: string;
  raw: unknown;
}

/** The first scene that plays `scenario`, by file name, read and checked; scenes that don't read are passed over. */
export function sceneFor(scenario: Scenario, files: SceneFile[]): { name: string; scene: Scene } | undefined {
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const scene = readScene(file.raw);
      if (scene.scenario === scenario) return { name: file.name, scene };
    } catch {
      // a scene that doesn't read is the recorder's to complain about
    }
  }
  return undefined;
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
  store.plugins = {};
  store.save();
}

/**
 * Sends everyone home, clears the ship, rolls the dice from the top and puts the scenario's goal in line at its
 * project's team stations: the goal, where it waits, the captain's moves for `]` to make, and the demo's pace. A scene
 * that plays the scenario brings its goal, project, seed, steps and speed in place of the console's own.
 */
export async function startTraining(scenario: Scenario, ship: TrainingShip): Promise<{ projectId: string; queued: QueuedGoal; steps: TrainingStep[]; speed: number }> {
  const found = sceneFor(scenario, await ship.scenes());
  const training = found ? found.scene : TRAINING[scenario];
  const project = ship.store.projects.find((p) => p.name === training.project);
  if (!project) throw new Error(`The demo office has no project called ${training.project}`);
  await Promise.all([...ship.store.agents.keys()].map((id) => ship.agents.dismiss(id)));
  // after they've gone: each goes home with a digest of their session in the ledger
  clearForTraining(ship.store);
  ship.resetGitHub();
  seedRandom(found?.scene.seed ?? TRAINING_SEED);
  ship.setScenario(scenario);
  // the scene's pace, slow enough to narrate over, which the captain changes as they play
  const speed = found?.scene.speed ?? TRAINING_SPEED;
  ship.setSpeed(speed);
  await ship.refreshBoards();
  const queued = ship.agents.queueGoal(project.id, training.goal, { from: 'the training console' });
  // every browser starts over from the quiet ship, as it does on reconnecting
  ship.hub.send({ type: 'snapshot', snapshot: await ship.snapshot() });
  return { projectId: project.id, queued, steps: found?.scene.steps ?? DEFAULT_STEPS, speed };
}

/** What the showcase does to the ship besides a training reset: makes the project it fills, and sets how far a lead goes alone. */
export interface ShowcaseShip extends Omit<TrainingShip, 'setScenario' | 'scenes'> {
  /** The project called `name`, made with `repos` (and every plugin on) if the ship has none yet. */
  project: (name: string) => Project;
}

/**
 * The busy ship (shared/showcase.ts): sends everyone home, clears the ship as a training reset does, and starts a goal at
 * every team station in the Focus holodeck, each lead set to ship without asking, so each plays its one thing over and
 * over for a walk round to film.
 */
export async function startShowcase(ship: ShowcaseShip): Promise<{ projectId: string; steps: TrainingStep[]; speed: number }> {
  await Promise.all([...ship.store.agents.keys()].map((id) => ship.agents.dismiss(id)));
  clearForTraining(ship.store);
  ship.resetGitHub();
  seedRandom(TRAINING_SEED);
  ship.setSpeed(1);
  const project = ship.project(SHOWCASE.project);
  ship.store.save();
  await ship.refreshBoards();
  for (const room of SHOWCASE.rooms) {
    const started = ship.agents.startGoal(project.id, room.goal, { station: room.station, from: 'the training console' });
    if ('agent' in started) ship.agents.setAutonomy(started.agent.id, 'auto');
  }
  ship.hub.send({ type: 'snapshot', snapshot: await ship.snapshot() });
  return { projectId: project.id, steps: [], speed: 1 };
}
