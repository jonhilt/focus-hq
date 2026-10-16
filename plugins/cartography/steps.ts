// A view's scenario, checked against the code (README.md): its steps, written or found in a recorded run's call chains,
// each with what backs it on the map. A step is backed by a recorded run's message from its part to the next, a recorded
// call from one to the other, or an import between the two either way (one part calling the other, or reading from it).
// One with nothing behind it is said to be unbacked, never left out. Pure.
import { namesLabel } from './draw';
import { ownerOf } from './graph';
import type { MapView, PartTrace, RepoMap, ViewStep } from './shared';

/** What backs a step, in a sentence: its cited line, a recorded message or call, or an import one way or the other. */
export interface Evidence {
  kind: 'cite' | 'flow' | 'call' | 'import';
  sentence: string;
}

/** A line of code as evidence: trimmed, and cut short past `max` characters. */
const quote = (text: string, max = 100): string => (text.trim().length > max ? `${text.trim().slice(0, max - 1)}…` : text.trim());

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A step's cite checked against the code: it has to be in the code of one of its two parts, and name, within a couple
 * of lines, something that part uses of the other (or the other of it), or a message between them. The line is the
 * evidence; a cite that doesn't hold is the step's problem. With nothing on the map between the two (a language the
 * map can't read), a cite in the right part is taken as it is.
 */
export function checkCite(map: RepoMap, step: ViewStep): { evidence?: Evidence; problem?: string } {
  if (!step.cite) return {};
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  const read = map.cited?.[step.cite];
  if (!read) return {};
  if ('missing' in read) return { problem: `Its cite, ${step.cite}, doesn't check out: ${read.missing}.` };
  const owner = map.model && ownerOf(read.file, map.model);
  if (owner !== step.from && owner !== step.to)
    return { problem: `Its cite, ${step.cite}, is ${owner ? `${label(owner)}'s code` : 'in no part'}, not ${label(step.from)}'s or ${label(step.to)}'s.` };
  const other = owner === step.from ? step.to : step.from;
  const between = (a: string, b: string) => map.connections.filter((c) => c.from === a && c.to === b).flatMap((c) => c.names);
  const messages = (map.flows ?? []).filter((f) => (f.from === owner && f.to === other) || (f.from === other && f.to === owner)).flatMap((f) => f.names);
  // a name the code uses stands as a word; a message's (an event's type, a route) only as a string, since `agent` is any variable's
  const words = [...new Set([...between(owner, other), ...between(other, owner)])].filter((n) => /\w/.test(n) && n !== 'default');
  const matchers = [
    ...words.map((n) => ({ name: n, re: new RegExp(`(^|[^\\w$])${escapeRe(n)}($|[^\\w$])`) })),
    ...[...new Set(messages)].map((n) => ({ name: n, re: new RegExp(`['"\`]${escapeRe(n.replace(/^[A-Z]+ /, ''))}['"\`]`) })),
  ];
  const names = matchers.map((m) => m.name);
  const at = (i: number) => `${read.file}:${read.first + i}`;
  if (!names.length) {
    const own = quote(read.lines[read.line - read.first] ?? '');
    return { evidence: { kind: 'cite', sentence: `${step.cite}: ${own} (in ${label(owner)}'s code; nothing on the map says what it reaches)` } };
  }
  // the cited line first, then out from it a line at a time: a name of the other part's on it, or a member reached
  // through a class of the other part's it extends (`this.update(…)` in `class GoalTools extends Part`)
  const inherited = read.inherits.find((n) => words.includes(n));
  const near = read.lines.map((text, i) => ({ text, i })).sort((a, b) => Math.abs(a.i + read.first - read.line) - Math.abs(b.i + read.first - read.line));
  for (const { text, i } of near) {
    const name = matchers.find((m) => m.re.test(text))?.name;
    if (name) return { evidence: { kind: 'cite', sentence: `${at(i)}: ${quote(text)} (${name}, of ${label(other)})` } };
    if (inherited && /\b(this|super)\.[\w$]+\s*\(/.test(text)) return { evidence: { kind: 'cite', sentence: `${at(i)}: ${quote(text)} (a member of ${inherited}, of ${label(other)})` } };
  }
  return { problem: `Its cite, ${step.cite}, names nothing of ${label(other)}'s within ${read.lines.length} lines: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}.` };
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
  /** What's wrong with it: a cite that doesn't hold. */
  problem?: string;
}

const times = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each of `view`'s steps with what on `map` backs it: its cited line, its recorded messages and calls, then its imports. */
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
    // the call the step says first, then the busiest others
    const own = (fn: string) => (step.says === `calls ${fn}` ? 1 : 0);
    const calls = [...called].sort((a, b) => own(b[0]) - own(a[0]) || b[1] - a[1]).slice(0, 3).map(([fn, n]): Evidence => ({ kind: 'call', sentence: `Calls ${fn}: ${times(n, 'time')} in the recorded run` }));
    const cite = checkCite(map, step);
    return { ...step, evidence: [...(cite.evidence ? [cite.evidence] : []), ...flows, ...calls, ...imports], ...(cite.problem ? { problem: cite.problem } : {}) };
  });
}

/** A checked step as its numbered line says it: who reaches whom, and what happens. */
export const stepSentence = (map: RepoMap, step: ViewStep): string => {
  const label = (id: string) => map.model?.parts.find((p) => p.id === id)?.label ?? id;
  return `${label(step.from)} → ${label(step.to)}: ${step.says}`;
};
