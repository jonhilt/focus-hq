// A view's scenario, checked against the code (README.md): its steps, written or found in a recorded run's call chains,
// each with what backs it on the map. A step is backed by a recorded run's message from its part to the next, a recorded
// call from one to the other, or an import between the two either way (one part calling the other, or reading from it).
// One with nothing behind it is said to be unbacked, never left out. Pure.
import { namesLabel } from './draw';
import type { MapView, PartTrace, RepoMap, ViewStep } from './shared';

/** What backs a step, in a sentence: a recorded message or call, or an import one way or the other. */
export interface Evidence {
  kind: 'flow' | 'call' | 'import';
  sentence: string;
}

/**
 * A recorded function's name as a step says it: the method's own (V8 names it after the object it was called on, which
 * may be a subclass), or nothing for an anonymous one or a framework's internals (`~effect/Effect/args`).
 */
export const shortFn = (fn: string): string | undefined => {
  const name = fn.split('.').pop();
  return name && /^[\w$]+$/.test(name) ? name : undefined;
};

/**
 * The recorded chain a view's `trace` picks: of those that sent its message, through its part if it names one, the one
 * through the most parts (a chain cut short where it awaited is busier, but tells less), then the busiest.
 */
export function pickTrace(map: RepoMap, view: MapView): PartTrace | undefined {
  const t = view.trace;
  const matching = t ? (map.traces ?? []).filter((c) => c.name === t.message && (!t.through || c.hops.some((h) => h.part === t.through))) : [];
  return matching.sort((a, b) => b.hops.length - a.hops.length || b.count - a.count)[0];
}

/** Steps found in a recorded call chain: one per hop from part to part, saying what it called, or what it sent. */
export function tracedSteps(chain: PartTrace): ViewStep[] {
  const last = chain.hops.length - 2;
  return chain.hops.slice(1).map((hop, i) => {
    const from = chain.hops[i].part;
    const fn = hop.fn && shortFn(hop.fn);
    // the last hop is the message itself, to whoever receives it
    const says = i === last ? (chain.via === 'ws' ? `sends "${chain.name}" over /ws` : `requests ${chain.name}`) : fn ? `calls ${fn}` : 'calls back into it';
    return { from, to: hop.part, says };
  });
}

/** A view's steps: the ones written, or else the ones its trace finds in the recorded run (none when it finds none). */
export const scenarioSteps = (map: RepoMap, view: MapView): ViewStep[] => {
  if (view.steps?.length) return view.steps;
  const chain = pickTrace(map, view);
  return chain ? tracedSteps(chain) : [];
};

export interface CheckedStep extends ViewStep {
  evidence: Evidence[];
}

const times = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each of `view`'s steps with what on `map` backs it: its recorded messages first, then its imports. */
export function checkSteps(map: RepoMap, view: MapView): CheckedStep[] {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  return scenarioSteps(map, view).map((step) => {
    const flows = (map.flows ?? [])
      .filter((f) => f.from === step.from && f.to === step.to)
      .map((f): Evidence => {
        const what = f.names.slice(0, 4).join(', ') + (f.names.length > 4 ? ` +${f.names.length - 4}` : '');
        return { kind: 'flow', sentence: f.via === 'ws' ? `Sends ${what} over the WebSocket: ${times(f.count, 'event')} in the recorded run` : `Calls ${what}: ${times(f.count, 'request')} in the recorded run` };
      });
    const imports = map.connections
      .filter((c) => (c.from === step.from && c.to === step.to) || (c.from === step.to && c.to === step.from))
      .map((c): Evidence => ({ kind: 'import', sentence: `${label(c.from)} imports ${namesLabel(c, 6)} from ${label(c.to)} (${times(c.imports, 'import')})` }));
    // each function the recorded run saw `from` call in `to`, and how often, over every chain that went that way
    const called = new Map<string, number>();
    for (const chain of map.traces ?? [])
      chain.hops.forEach((hop, i) => {
        const before = chain.hops[i - 1];
        const fn = (hop.fn && shortFn(hop.fn)) ?? 'a callback';
        // the last hop is the message landing with its receiver, which the flows say, not a call
        if (before?.part === step.from && hop.part === step.to && i < chain.hops.length - 1) called.set(fn, (called.get(fn) ?? 0) + chain.count);
      });
    const calls = [...called].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([fn, n]): Evidence => ({ kind: 'call', sentence: `Calls ${fn}: ${times(n, 'time')} in the recorded run` }));
    return { ...step, evidence: [...flows, ...calls, ...imports] };
  });
}

/** A checked step as its numbered line says it: who reaches whom, and what happens. */
export const stepSentence = (map: RepoMap, step: ViewStep): string => {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  return `${label(step.from)} → ${label(step.to)}: ${step.says}`;
};
