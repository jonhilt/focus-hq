// A view's scenario, checked against the code (README.md): each step someone wrote, with what backs it on the map. A step
// is backed by a recorded run's message from its part to the next, or an import between the two either way (one part
// calling the other, or reading from it). One with nothing behind it is said to be unbacked, never left out. Pure.
import { namesLabel } from './draw';
import type { MapView, RepoMap, ViewStep } from './shared';

/** What backs a step, in a sentence: a recorded message, or an import one way or the other. */
export interface Evidence {
  kind: 'flow' | 'import';
  sentence: string;
}

export interface CheckedStep extends ViewStep {
  evidence: Evidence[];
}

const times = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each of `view`'s steps with what on `map` backs it: its recorded messages first, then its imports. */
export function checkSteps(map: RepoMap, view: MapView): CheckedStep[] {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  return (view.steps ?? []).map((step) => {
    const flows = (map.flows ?? [])
      .filter((f) => f.from === step.from && f.to === step.to)
      .map((f): Evidence => {
        const what = f.names.slice(0, 4).join(', ') + (f.names.length > 4 ? ` +${f.names.length - 4}` : '');
        return { kind: 'flow', sentence: f.via === 'ws' ? `Sends ${what} over the WebSocket: ${times(f.count, 'event')} in the recorded run` : `Calls ${what}: ${times(f.count, 'request')} in the recorded run` };
      });
    const imports = map.connections
      .filter((c) => (c.from === step.from && c.to === step.to) || (c.from === step.to && c.to === step.from))
      .map((c): Evidence => ({ kind: 'import', sentence: `${label(c.from)} imports ${namesLabel(c, 6)} from ${label(c.to)} (${times(c.imports, 'import')})` }));
    return { ...step, evidence: [...flows, ...imports] };
  });
}

/** A checked step as its numbered line says it: who reaches whom, and what happens. */
export const stepSentence = (map: RepoMap, step: ViewStep): string => {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  return `${label(step.from)} → ${label(step.to)}: ${step.says}`;
};
