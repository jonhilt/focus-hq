// What the machines' screen and their close-up say, decided apart from drawing them (client.ts draws): which machine
// is shown, its heading, the tabs to toggle through, and what changes when the screen's drawn again.
import type { MachineRun, MachineStep } from '../../plugin-api/shared';
import { TRAIL_STEPS } from './draw';
import type { Astrometrics, MachineLayout } from './shared';

/** The machine picked, by id, or the first there is. */
export const pickedLayout = (layouts: readonly MachineLayout[], picked: string): MachineLayout | undefined => layouts.find((l) => l.id === picked) ?? layouts[0];

/** A project's runs of `machine`, in the order Ops lists them. */
export const runsOf = (runs: readonly MachineRun[], projectId: string, machine: string): MachineRun[] => runs.filter((r) => r.machine === machine && r.projectId === projectId);

/** What the screen shows of project `projectId`: the machine picked with its runs, or why there's none to show yet. */
export interface ScreenView {
  title: string;
  sub: string;
  layout?: MachineLayout;
  runs: MachineRun[];
  /** Changes whenever what's drawn would: the machine shown, and where the project's runs of it are. */
  version: string;
}

export function screenView(state: Astrometrics | undefined, picked: string, projectId: string): ScreenView {
  const layouts = state?.layouts ?? [];
  const layout = pickedLayout(layouts, picked);
  if (!layout) {
    const why = state?.error ?? 'Laying the machines out…';
    return { title: 'State machines', sub: why, runs: [], version: `none:${why}` };
  }
  const runs = runsOf(state?.runs ?? [], projectId, layout.id);
  const count = `${runs.length} ${layout.runs}${runs.length === 1 ? '' : 's'} here`;
  return {
    title: layout.title,
    sub: `${count} · machine ${layouts.indexOf(layout) + 1} of ${layouts.length} · E to toggle through them`,
    layout,
    runs,
    version: `${layout.id}:${runs.map((r) => `${r.key}@${r.state}`).join(',')}`,
  };
}

/** The close-up's tabs: a machine each, with how many of the project's runs are in it, the one shown on. */
export function tabs(state: Astrometrics | undefined, picked: string, projectId: string): { id: string; label: string; on: boolean }[] {
  const layouts = state?.layouts ?? [];
  const shown = pickedLayout(layouts, picked);
  return layouts.map((l) => ({ id: l.id, label: `${l.title} · ${runsOf(state?.runs ?? [], projectId, l.id).length}`, on: l.id === shown?.id }));
}

/** `w` × `h` fitted inside `box`, centred, never scaled up past 1.4. */
export function fit(w: number, h: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.w / w, box.h / h, 1.4);
  return { x: box.x + (box.w - w * scale) / 2, y: box.y + (box.h - h * scale) / 2, w: w * scale, h: h * scale };
}

/** Whether a screen showing `shown` draws `version` now: it changed, and it isn't still drawing the last. */
export const drawDue = (screen: { shown: string; drawing: boolean }, version: string): boolean => version !== screen.shown && !screen.drawing;

/** The run followed up close, if it's still one of `runs` (it may have gone home, or be in another machine). */
export const followedRun = (runs: readonly MachineRun[], key: string | undefined): MachineRun | undefined => runs.find((r) => r.key === key);

/** A trail's steps as the close-up lists them, numbered as the drawing numbers them, the latest last. */
export function trailSteps(steps: readonly MachineStep[]): (MachineStep & { n: number })[] {
  return steps.slice(-TRAIL_STEPS).map((step, i) => ({ ...step, n: i + 1 }));
}

/**
 * What the close-up draws: the machine shown and its runs, and with a run followed (still in it), only that run, its
 * trail's `steps`; without one, no trail.
 */
export function closeUpView(state: Astrometrics | undefined, picked: string, projectId: string, followed: string | undefined, steps: readonly MachineStep[]): ScreenView & { run?: MachineRun; lit: MachineRun[]; trail: readonly MachineStep[] } {
  const view = screenView(state, picked, projectId);
  const run = followedRun(view.runs, followed);
  return { ...view, run, lit: run ? [run] : view.runs, trail: run ? steps : [] };
}
