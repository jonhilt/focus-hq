import type { Agent, Project } from '../../../shared/types';

/** A goal as stellar cartography shows it: a star, in its project's colour, where its time puts it on the arm. */
export interface GoalStar {
  /** A live goal's lead's id, or a closed goal's record's. */
  id: string;
  projectId: string;
  title: string;
  color: string;
  openedAt: number;
  /** When it closed; a live goal hasn't. */
  closedAt?: number;
  slices: number;
}

/**
 * Every goal on the ship the captain can see, oldest first: each project's closed goals and its leads' live ones,
 * bar hidden projects'. A live goal opened when its first slice started, or else when its lead did.
 */
export function goalStars(projects: Project[], agents: Agent[]): GoalStar[] {
  const shown = new Map(projects.filter((p) => !p.hidden).map((p) => [p.id, p]));
  const stars: GoalStar[] = [];
  for (const project of shown.values()) {
    for (const goal of project.goals ?? []) {
      stars.push({ id: goal.id, projectId: project.id, title: goal.title, color: project.color, openedAt: goal.openedAt, closedAt: goal.closedAt, slices: goal.slices });
    }
  }
  for (const agent of agents) {
    const project = shown.get(agent.projectId);
    if (agent.task !== 'lead' || !agent.lead || !project) continue;
    const { lead } = agent;
    stars.push({ id: agent.id, projectId: project.id, title: lead.title, color: project.color, openedAt: lead.waypoints?.[0]?.startedAt ?? agent.startedAt, slices: lead.slice });
  }
  return stars.sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id));
}

/** A point round the sphere's centre, in its frame: X across, Y up, -Z the way you look from the console. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * The arm the goals lie along: an Archimedean spiral round the sphere's centre, from the newest dead ahead of the
 * console (`inner` out) winding back through time to the oldest (`outer` out), `pitch` further out each turn, a
 * little below eye height (`drop`) and tilted (`tilt`, radians) up ahead of you, over the console, and down behind,
 * so it sweeps round you just over the railing and the stars that come round behind pass under the gantry rather
 * than across it.
 * Neighbours are `spacing` apart along it, closer when there are too many goals to fit.
 */
export const ARM = { inner: 4.5, outer: 9.5, pitch: 2, spacing: 2.2, tilt: 0.35, drop: -0.5 };

/** Where each of `n` goals, oldest first, lies on the arm. */
export function spiral(n: number, arm = ARM): Point[] {
  if (n === 0) return [];
  // the spiral's length from inner to outer, so the oldest lands on the outer edge at the most
  const length = (Math.PI * (arm.outer ** 2 - arm.inner ** 2)) / arm.pitch;
  const spacing = n > 1 ? Math.min(arm.spacing, length / (n - 1)) : 0;
  const points: Point[] = [];
  let turned = 0;
  for (let age = 0; age < n; age++) {
    const r = arm.inner + (arm.pitch * turned) / (2 * Math.PI);
    // dead ahead is -Z, winding anticlockwise seen from above
    const a = -Math.PI / 2 - turned;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    points.push({ x, y: arm.drop - z * Math.tan(arm.tilt), z });
    turned += spacing / r;
  }
  return points.reverse();
}
